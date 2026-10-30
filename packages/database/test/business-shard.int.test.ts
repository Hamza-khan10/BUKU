import { IdGenerator, publicId } from '@buku/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createBusinessShardClient,
  createDatabaseClient,
  createDirectoryClient,
  forAllBusinesses,
  forBusiness,
  shardUrl,
  type BusinessShardClient,
  type Database,
  type DirectoryClient,
} from '../src/index.js';
import { directoryAccessStatements } from '../src/access-sql.js';
import { applyShardAccess, applyStatements } from '../src/apply-access.js';
import { DataPlane } from '../src/data-plane.js';
// Events are @buku/kafka's; tested here, where a shard is at hand.
import {
  createEvent,
  enqueueShardEvent,
  OutboxRelay,
  processOnceOnShard,
  type EventProducer,
} from '../../kafka/src/index.js';
import { dropDatabase, provisionShards, waitForReferenceCopy } from '../src/provision.js';
import { asService, ensureServiceRoles, passwords } from './service-roles.js';
import { testEnv } from './int-env.js';

/**
 * A business shard (docs/DATABASE.md DB-010, §9.3): provisioned from the registry, one business
 * at a time (row-level security, DB-020), its rows consistent with each other (composite keys),
 * and the booking rules held by the database itself (DB-024): no double booking of an employee,
 * a resource or a customer, codes unique within a business across every month, an appointment's
 * time fixed. A throwaway shard, buku_test_business_pk_1, is rebuilt for every run.
 */

const SHARD = 'buku_test_business_pk_1';
const env = { ...process.env, BUKU_DB_CLUSTER_TEST: testEnv.cluster };
const info = { databaseName: SHARD, dsnSecret: 'BUKU_DB_CLUSTER_TEST' } as never;
const ids = new IdGenerator(4);

let directory: DirectoryClient;
let server: Database; // the admin, on the cluster's `postgres` database
let app: BusinessShardClient; // a service-like role: row-level security applies
let owner: Database; // the schema owner: not subject to it
let placer: DirectoryClient; // places new businesses, as a service does (registry.place)

beforeAll(async () => {
  directory = createDirectoryClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'business-shard-int-test',
  });
  server = createDatabaseClient({
    url: `postgresql://${testEnv.admin.user}:${encodeURIComponent(testEnv.admin.password)}@${new URL(testEnv.cluster).host}/postgres`,
    applicationName: 'business-shard-int-test',
  });
  // Last run's shard, its reference copy first (global setup does this too).
  await dropDatabase({
    serverUrl: testEnv.adminUrl('postgres'),
    database: SHARD,
    publisherUrl: testEnv.adminUrl('buku_directory_test'),
  });
  await directory.region.createMany({
    data: [{ region: 0, code: 'pk', name: 'Pakistan' }],
    skipDuplicates: true,
  });
  await directory.cluster.createMany({
    data: [{ clusterId: 3, region: 0, name: 'test-shards', dsnSecret: 'BUKU_DB_CLUSTER_TEST' }],
    skipDuplicates: true,
  });
  await directory.entity.create({
    data: {
      entity: 'business',
      description: 'test businesses',
      defaultRowLimit: 1000n,
      databasePattern: 'buku_test_{entity}_{region}_{shard}',
      placedBy: ['buku_app'],
    },
  });
  await directory.$queryRaw`SELECT shard_no FROM registry.add_shard('business', 0::smallint, 3::smallint)`;
  const made = await provisionShards({
    directoryUrl: testEnv.directoryMigratorUrl,
    admin: testEnv.admin,
    migrator: testEnv.migrator,
    env,
    families: ['business'],
    reference: {
      conninfo: testEnv.referenceSource,
      replicator: testEnv.replicator,
      publisherUrl: testEnv.adminUrl('buku_directory_test'),
    },
  });
  expect(made).toEqual([expect.objectContaining({ databaseName: SHARD, created: true })]);
  app = createBusinessShardClient({
    url: shardUrl(info, testEnv.app, env),
    applicationName: 'business-shard-int-test',
  });
  owner = createDatabaseClient({
    url: shardUrl(info, testEnv.migrator, env),
    applicationName: 'business-shard-int-test',
  });
  placer = createDirectoryClient({
    url: testEnv.directoryAppUrl,
    applicationName: 'business-shard-int-test',
  });
});

afterAll(async () => {
  await app?.$disconnect();
  await owner?.$disconnect();
  await server?.$disconnect();
  await directory?.$disconnect();
  await placer?.$disconnect();
});

type Tx = Parameters<Parameters<BusinessShardClient['$transaction']>[0]>[0];
/** One unit of work for one business, as a service does it. */
const asBusiness = <T>(businessId: bigint, work: (tx: Tx) => Promise<T>) =>
  app.$transaction(async (tx) => {
    await forBusiness(tx, businessId);
    return work(tx);
  });

const day = (d: number, h: number, m = 0) => new Date(Date.UTC(2027, 2, d, h, m));
const code = () =>
  `BK-${Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('')}`;

/** A business with one service (30 minutes + 10 of clean-up), two employees and a chair. */
async function aBusiness(name: string) {
  const id = ids.next();
  await placer.$queryRaw`SELECT shard_no FROM registry.place('business', ${id}::bigint)`;
  return asBusiness(id, async (tx) => {
    await tx.business.create({
      data: {
        id,
        ownerUserId: 1n,
        categoryId: 1n,
        publicId: publicId(),
        slug: `${name}-${id}`,
        name,
        country: 'PK',
        currency: 'PKR',
        city: 'Lahore',
      },
    });
    const service = await tx.service.create({
      data: {
        id: ids.next(),
        businessId: id,
        priceMinor: 150000n,
        durationMinutes: 30,
        bufferMinutes: 10,
        currency: 'PKR',
        name: 'Haircut',
      },
    });
    const [ali, sara] = await Promise.all(
      ['Ali', 'Sara'].map((displayName) =>
        tx.staff.create({ data: { id: ids.next(), businessId: id, displayName } }),
      ),
    );
    const chair = await tx.resource.create({
      data: { id: ids.next(), businessId: id, name: 'Chair 1', type: 'chair' },
    });
    return { id, service: service.id, ali: ali!.id, sara: sara!.id, chair: chair.id };
  });
}
type Biz = Awaited<ReturnType<typeof aBusiness>>;

/** Book: start at `start`, 30 minutes, blocked 10 more. */
const book = (b: Biz, start: Date, extra: Record<string, unknown> = {}) =>
  asBusiness(b.id, (tx) =>
    tx.appointment.create({
      data: {
        id: ids.next(),
        startAt: start,
        endAt: new Date(start.getTime() + 30 * 60_000),
        blockedUntil: new Date(start.getTime() + 40 * 60_000),
        businessId: b.id,
        userId: 500n,
        serviceId: b.service,
        staffId: b.ali,
        priceMinor: 150000n,
        currency: 'PKR',
        publicId: publicId(),
        code: code(),
        status: 'confirmed',
        ...extra,
      },
    }),
  );

describe('provisioning a business shard', () => {
  it('is made, migrated, partitioned ahead and kept tidy', async () => {
    const parts = await owner.$queryRaw<
      { parent: string; retention: string | null; keep: boolean; archive: string | null }[]
    >`
      SELECT parent_table AS parent, retention, retention_keep_table AS keep, retention_schema AS archive
      FROM partman.part_config ORDER BY parent_table`;
    expect(parts.find((p) => p.parent === 'public.appointments')).toEqual({
      parent: 'public.appointments',
      retention: '25 months',
      keep: true,
      archive: 'archive',
    });
    // Bookings open up to two years ahead: their months already exist.
    const ahead = new Date();
    ahead.setUTCMonth(ahead.getUTCMonth() + 24, 1);
    const month = `${ahead.getUTCFullYear()}${String(ahead.getUTCMonth() + 1).padStart(2, '0')}01`;
    const found = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_class WHERE relname = ${`appointments_p${month}`}`;
    expect(found[0]!.n).toBe(1n);
    const job = await server.$queryRaw<
      { n: bigint }[]
    >`SELECT count(*) AS n FROM cron.job WHERE jobname = ${`partman:${SHARD}`}`;
    expect(job[0]!.n).toBe(1n);
  });

  it('every table holding a business’s rows has row-level security (a new one must too)', async () => {
    const unguarded = await owner.$queryRaw<{ name: string }[]>`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('public', 'ai') AND c.relkind IN ('r', 'p') AND NOT c.relispartition
        AND (EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'business_id' AND NOT a.attisdropped)
             OR c.relname = 'businesses')
        AND NOT c.relrowsecurity`;
    expect(unguarded).toEqual([]);
  });

  it('every foreign key has an index that starts with it (DB-007)', async () => {
    const missing = await owner.$queryRaw<{ fk: string }[]>`
      SELECT c.conname AS fk FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace IN ('public'::regnamespace, 'ai'::regnamespace)
        AND c.conparentid = 0
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`;
    expect(missing).toEqual([]);
  });
});

describe('one business at a time (DB-020)', () => {
  it('a session sees and writes only the business it set; with none set, nothing', async () => {
    const a = await aBusiness('fade-studio');
    const b = await aBusiness('glow-salon');
    expect(await app.business.count()).toBe(0);
    expect(await asBusiness(a.id, (tx) => tx.business.count())).toBe(1);
    expect(await asBusiness(a.id, (tx) => tx.service.findMany({ select: { businessId: true } }))).toEqual([
      { businessId: a.id },
    ]);
    // Writing another business's row from A's session is refused.
    await expect(
      asBusiness(a.id, (tx) =>
        tx.resource.create({ data: { id: ids.next(), businessId: b.id, name: 'Sneaky', type: 'chair' } }),
      ),
    ).rejects.toThrow(/row-level security/);
    // Updating it finds nothing to update.
    const changed = await asBusiness(a.id, (tx) =>
      tx.service.updateMany({ where: { id: b.service }, data: { name: 'x' } }),
    );
    expect(changed.count).toBe(0);
  });

  it('only members of buku_all_businesses see across businesses', async () => {
    await aBusiness('third-place');
    await server.$executeRawUnsafe('GRANT buku_all_businesses TO buku_app WITH INHERIT TRUE');
    try {
      // A fresh connection: membership is checked as each query runs.
      expect(await app.business.count()).toBeGreaterThanOrEqual(3);
    } finally {
      await server.$executeRawUnsafe('REVOKE buku_all_businesses FROM buku_app');
    }
    expect(await app.business.count()).toBe(0);
  });
});

describe('a business’s rows point only at its own (composite keys)', () => {
  it('an appointment can’t be with another business’s employee, nor a service in another’s group', async () => {
    const a = await aBusiness('north');
    const b = await aBusiness('south');
    // Even the schema owner, past row-level security, is stopped by the keys.
    await expect(
      owner.$executeRaw`INSERT INTO appointments (id, start_at, business_id, user_id, service_id, staff_id, price_minor,
        end_at, blocked_until, updated_at, public_id, code, currency)
        VALUES (${ids.next()}, ${day(1, 9)}, ${a.id}, 1, ${a.service}, ${b.ali}, 0, ${day(1, 10)}, ${day(1, 10)}, now(),
                ${publicId()}, ${code()}, 'PKR')`,
    ).rejects.toThrow(/foreign key/);
    const group = await asBusiness(b.id, (tx) =>
      tx.serviceGroup.create({ data: { id: ids.next(), businessId: b.id, name: 'Colour' } }),
    );
    await expect(
      owner.$executeRaw`UPDATE services SET group_id = ${group.id} WHERE id = ${a.service}`,
    ).rejects.toThrow(/foreign key/);
  });
});

describe('the booking rules, held by the database (DB-024)', () => {
  it('an employee can’t be booked twice at once, including the clean-up time; back to back is fine', async () => {
    const b = await aBusiness('double-check');
    await book(b, day(2, 10));
    // 10:20 overlaps the visit; 10:35 overlaps its clean-up (until 10:40).
    await expect(book(b, day(2, 10, 20), { userId: 501n })).rejects.toThrow(/appointment_index_staff_free/);
    await expect(book(b, day(2, 10, 35), { userId: 501n })).rejects.toThrow(/appointment_index_staff_free/);
    await book(b, day(2, 10, 40), { userId: 501n });
    // Someone else on the team, same time: fine.
    await book(b, day(2, 10, 20), { userId: 502n, staffId: b.sara });
  });

  it('a cancelled appointment frees its time', async () => {
    const b = await aBusiness('freed');
    const first = await book(b, day(3, 9));
    await asBusiness(b.id, (tx) =>
      tx.appointment.update({
        where: { id_startAt: { id: first.id, startAt: first.startAt } },
        data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: 'user' },
      }),
    );
    await book(b, day(3, 9), { userId: 501n });
  });

  it('a resource can’t be booked twice; a customer can’t be in two places at one business', async () => {
    const b = await aBusiness('one-chair');
    await book(b, day(4, 11), { resourceId: b.chair });
    await expect(
      book(b, day(4, 11, 15), { staffId: b.sara, userId: 501n, resourceId: b.chair }),
    ).rejects.toThrow(/appointment_index_resource_free/);
    await expect(book(b, day(4, 11, 15), { staffId: b.sara })).rejects.toThrow(
      /appointment_index_customer_free/,
    );
  });

  it('a code is unique within its business across every month; public IDs everywhere', async () => {
    const a = await aBusiness('codes-a');
    const b = await aBusiness('codes-b');
    const shared = code();
    await book(a, day(5, 9), { code: shared });
    // Another month, so another partition: still refused.
    await expect(book(a, new Date(Date.UTC(2027, 7, 5, 9)), { code: shared, userId: 501n })).rejects.toThrow(
      /Unique constraint|unique/,
    );
    // Another business may have the same code.
    await book(b, day(5, 9), { code: shared });
    const taken = publicId();
    await book(a, day(6, 9), { publicId: taken });
    await expect(book(b, day(6, 9), { publicId: taken })).rejects.toThrow(/Unique constraint|unique/);
  });

  it('the index finds an appointment by its code, and nobody writes the index directly', async () => {
    const b = await aBusiness('desk');
    const appt = await book(b, day(7, 15));
    const found = await asBusiness(b.id, async (tx) => {
      const ref = await tx.appointmentIndex.findUniqueOrThrow({
        where: { businessId_code: { businessId: b.id, code: appt.code } },
      });
      return tx.appointment.findUniqueOrThrow({
        where: { id_startAt: { id: ref.appointmentId, startAt: ref.startAt } },
      });
    });
    expect(found.id).toBe(appt.id);
    await expect(
      asBusiness(b.id, (tx) => tx.appointmentIndex.deleteMany({ where: { appointmentId: appt.id } })),
    ).rejects.toThrow(/permission denied/);
  });

  it('an appointment’s time and customer never change (moving it makes a new one)', async () => {
    const b = await aBusiness('fixed-time');
    const appt = await book(b, day(8, 9));
    await expect(
      asBusiness(b.id, (tx) =>
        tx.appointment.update({
          where: { id_startAt: { id: appt.id, startAt: appt.startAt } },
          data: { startAt: day(8, 12) },
        }),
      ),
    ).rejects.toThrow(/never change/);
    await expect(
      asBusiness(b.id, (tx) =>
        tx.appointment.update({
          where: { id_startAt: { id: appt.id, startAt: appt.startAt } },
          data: { userId: 999n },
        }),
      ),
    ).rejects.toThrow(/never change/);
    // A status change is fine, and lands in its month's partition, where it stays.
    await asBusiness(b.id, (tx) =>
      tx.appointment.update({
        where: { id_startAt: { id: appt.id, startAt: appt.startAt } },
        data: { status: 'completed', version: 2 },
      }),
    );
    const where = await owner.$queryRaw<
      { part: string }[]
    >`SELECT tableoid::regclass::text AS part FROM appointments WHERE id = ${appt.id}`;
    expect(where[0]!.part).toBe('appointments_p20270301');
  });

  it('refuses malformed appointments', async () => {
    const b = await aBusiness('strict');
    for (const extra of [
      { code: 'BK-0O1IL5' }, // look-alike characters are never issued
      { status: 'maybe' },
      { priceMinor: -1n },
      { blockedUntil: day(9, 9, 10) }, // before the end
      { status: 'cancelled' }, // without when
    ])
      await expect(
        book(b, day(9, 9), extra),
        JSON.stringify(extra, (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v)),
      ).rejects.toThrow();
  });
});

describe('the rest of a business’s day', () => {
  it('an employee is on one shift at a time', async () => {
    const b = await aBusiness('shifts');
    const shift = (startedAt: Date, endedAt: Date | null = null) =>
      asBusiness(b.id, (tx) =>
        tx.staffShift.create({
          data: { id: ids.next(), startedAt, businessId: b.id, staffId: b.ali, endedAt },
        }),
      );
    const first = await shift(day(10, 9));
    await expect(shift(day(10, 13))).rejects.toThrow();
    await asBusiness(b.id, (tx) =>
      tx.staffShift.update({
        where: { id_startedAt: { id: first.id, startedAt: first.startedAt } },
        data: { endedAt: day(10, 12) },
      }),
    );
    await shift(day(10, 13));
    const open = await asBusiness(b.id, (tx) => tx.staffOpenShift.findMany());
    expect(open.map((o) => o.startedAt)).toEqual([day(10, 13)]);
  });

  it('queue tickets: one number per session, one live ticket per person, the session’s own date', async () => {
    const b = await aBusiness('queue');
    const sessionDate = new Date(Date.UTC(2027, 2, 11));
    const session = await asBusiness(b.id, (tx) =>
      tx.queueSession.create({ data: { id: ids.next(), businessId: b.id, sessionDate } }),
    );
    const ticket = (n: number, extra: Record<string, unknown> = {}) =>
      asBusiness(b.id, (tx) =>
        tx.queueTicket.create({
          data: {
            id: ids.next(),
            sessionDate,
            sessionId: session.id,
            businessId: b.id,
            ticketNumber: n,
            userId: 700n + BigInt(n),
            ...extra,
          },
        }),
      );
    await ticket(1);
    await expect(ticket(1, { userId: 800n })).rejects.toThrow();
    await expect(ticket(2, { userId: 701n })).rejects.toThrow(); // 701 is already waiting
    await asBusiness(b.id, (tx) =>
      tx.queueTicket.updateMany({ where: { userId: 701n }, data: { status: 'completed' } }),
    );
    await ticket(2, { userId: 701n });
    // A ticket must carry its session's date.
    await expect(ticket(3, { sessionDate: new Date(Date.UTC(2027, 2, 12)) })).rejects.toThrow();
  });

  it('a business’s rating and count follow its visible reviews; its place follows lat/lng', async () => {
    const b = await aBusiness('rated');
    let hour = 9;
    const review = async (rating: number) => {
      const visit = await book(b, day(12, hour++), { status: 'completed' });
      return asBusiness(b.id, (tx) =>
        tx.review.create({
          data: {
            id: ids.next(),
            appointmentId: visit.id,
            appointmentStartAt: visit.startAt,
            businessId: b.id,
            userId: visit.userId,
            overallRating: rating,
          },
        }),
      );
    };
    await review(5);
    const two = await review(2);
    // A review is of a real visit: its appointment, here, by the same customer (D3d).
    const visit = await book(b, day(12, hour++), { status: 'completed' });
    const wrong = (data: Record<string, unknown>) =>
      asBusiness(b.id, (tx) =>
        tx.review.create({
          data: {
            id: ids.next(),
            appointmentId: visit.id,
            appointmentStartAt: visit.startAt,
            businessId: b.id,
            userId: visit.userId,
            overallRating: 1,
            ...data,
          },
        }),
      );
    await expect(wrong({ appointmentId: ids.next() })).rejects.toThrow(/does not match its appointment/);
    await expect(wrong({ userId: visit.userId + 1n })).rejects.toThrow(/does not match its appointment/);
    await expect(wrong({ appointmentStartAt: day(13, 9) })).rejects.toThrow(/does not match its appointment/);
    let biz = await asBusiness(b.id, (tx) => tx.business.findUniqueOrThrow({ where: { id: b.id } }));
    expect([biz.reviewCount, biz.avgRating.toString()]).toEqual([2, '3.5']);
    await asBusiness(b.id, (tx) =>
      tx.review.update({
        where: { id: two.id },
        data: { isVisible: false, hiddenAt: new Date(), hiddenReason: 'abuse' },
      }),
    );
    biz = await asBusiness(b.id, (tx) =>
      tx.business.update({ where: { id: b.id }, data: { lat: 31.5204, lng: 74.3587 } }),
    );
    expect([biz.reviewCount, biz.avgRating.toString()]).toEqual([1, '5']);
    const place = await owner.$queryRaw<{ wkt: string }[]>`
      SELECT extensions.ST_AsText(location::extensions.geometry) AS wkt FROM businesses WHERE id = ${b.id}`;
    expect(place[0]!.wkt).toBe('POINT(74.3587 31.5204)');
  });

  it('a webhook never gets one event twice; one trial and one open plan request per business', async () => {
    const b = await aBusiness('integrations');
    const hook = await asBusiness(b.id, (tx) =>
      tx.webhook.create({
        data: {
          id: ids.next(),
          businessId: b.id,
          url: 'https://example.org/hook',
          secretEnc: Buffer.alloc(40),
          events: ['bookings.created'],
        },
      }),
    );
    const delivery = {
      webhookId: hook.id,
      businessId: b.id,
      eventId: 42n,
      eventAt: new Date(),
      eventType: 'bookings.created',
      payload: {},
    };
    await asBusiness(b.id, (tx) => tx.webhookDelivery.create({ data: { id: ids.next(), ...delivery } }));
    await expect(
      asBusiness(b.id, (tx) => tx.webhookDelivery.create({ data: { id: ids.next(), ...delivery } })),
    ).rejects.toThrow();
    await expect(
      asBusiness(b.id, (tx) =>
        tx.webhook.create({
          data: {
            id: ids.next(),
            businessId: b.id,
            url: 'http://plain.example',
            secretEnc: Buffer.alloc(1),
            events: [],
          },
        }),
      ),
    ).rejects.toThrow();

    const trial = { businessId: b.id, planId: 1n, provider: 'trial', status: 'trialing' };
    await asBusiness(b.id, (tx) => tx.subscription.create({ data: { id: ids.next(), ...trial } }));
    await expect(
      asBusiness(b.id, (tx) => tx.subscription.create({ data: { id: ids.next(), ...trial } })),
    ).rejects.toThrow();
    const request = { businessId: b.id, planId: 2n, requestedById: 1n, message: 'Enterprise, please' };
    await asBusiness(b.id, (tx) => tx.planRequest.create({ data: { id: ids.next(), ...request } }));
    await expect(
      asBusiness(b.id, (tx) => tx.planRequest.create({ data: { id: ids.next(), ...request } })),
    ).rejects.toThrow();
  });
});

describe('the reference data on a business shard (DB-015)', () => {
  const COUNT = 'SELECT count(*) AS n FROM reference.categories';
  const count = async (rows: Promise<{ n: bigint }[]>) => (await rows)[0]!.n;

  it('arrives by itself, follows every change on the directory, and is read-only here', async () => {
    const shardAdmin = createDatabaseClient({
      url: testEnv.adminUrl(SHARD),
      applicationName: 'business-shard-int-test',
    });
    try {
      await waitForReferenceCopy(shardAdmin, SHARD);
    } finally {
      await shardAdmin.$disconnect();
    }
    expect(await count(owner.$queryRawUnsafe(COUNT))).toBe(await count(directory.$queryRawUnsafe(COUNT)));
    expect(await app.plan.count()).toBe(8);

    // A kind added and renamed on the directory shows up here.
    const id = ids.next();
    await directory.$executeRaw`INSERT INTO reference.categories (id, parent_id, depth, slug, name)
      VALUES (${id}, 1, 1, ${`test-kind-${id}`}, 'Test kind')`;
    await expect
      .poll(() => app.category.findUnique({ where: { id } }).then((c) => c?.name), { timeout: 20_000 })
      .toBe('Test kind');
    await directory.$executeRaw`UPDATE reference.categories SET name = 'Renamed kind' WHERE id = ${id}`;
    await expect
      .poll(() => app.category.findUnique({ where: { id } }).then((c) => c?.name), { timeout: 20_000 })
      .toBe('Renamed kind');
    await directory.$executeRaw`DELETE FROM reference.categories WHERE id = ${id}`;
    await expect.poll(() => app.category.count({ where: { id } }), { timeout: 20_000 }).toBe(0);

    // Nobody changes the copy itself.
    await expect(
      app.$executeRawUnsafe(`UPDATE reference.plans SET name = 'Free for all' WHERE code = 'business_free'`),
    ).rejects.toThrow(/permission denied/);
  });

  it('has exactly the directory’s columns (a change must be made to both)', async () => {
    const COLUMNS = `SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable AS c
      FROM information_schema.columns WHERE table_schema = 'reference' ORDER BY table_name, ordinal_position`;
    const columns = async (rows: Promise<{ c: string }[]>) => (await rows).map((r) => r.c);
    const source = await columns(directory.$queryRawUnsafe(COLUMNS));
    expect(source.length).toBeGreaterThan(50);
    expect(await columns(owner.$queryRawUnsafe(COLUMNS))).toEqual(source);
  });
});

describe('each service’s rights on a business shard (D2d)', () => {
  let booking: Database;
  let notification: Database;
  beforeAll(async () => {
    await ensureServiceRoles();
    await applyShardAccess(testEnv.adminUrl(SHARD), 'business', passwords);
    booking = asService('booking', SHARD);
    notification = asService('notification', SHARD);
  });
  afterAll(async () => {
    await booking?.$disconnect();
    await notification?.$disconnect();
  });
  const inBusiness = (db: Database, businessId: bigint, sql: string) =>
    db.$transaction(async (tx) => {
      await forBusiness(tx, businessId);
      return tx.$executeRawUnsafe(sql);
    });

  it('booking writes its own tables, for the business it set, and nothing else', async () => {
    const b = await aBusiness('rights-own');
    await inBusiness(
      booking,
      b.id,
      `INSERT INTO services (id, business_id, price_minor, duration_minutes, currency, name, updated_at)
       VALUES (${ids.next()}, ${b.id}, 50000, 30, 'PKR', 'Beard trim', now())`,
    );
    // The profile is the business service's; the index its trigger's; the copy replication's.
    await expect(
      inBusiness(booking, b.id, `UPDATE businesses SET name = 'x' WHERE id = ${b.id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(booking.$executeRawUnsafe('DELETE FROM appointment_index')).rejects.toThrow(
      /permission denied/,
    );
    await expect(booking.$executeRawUnsafe(`UPDATE reference.plans SET name = 'x'`)).rejects.toThrow(
      /permission denied/,
    );
  });

  it('notification sees every business only after switching to its cross-business role, and still only reads', async () => {
    const a = await aBusiness('rights-one');
    const c = await aBusiness('rights-two');
    await book(a, day(20, 9));
    await book(c, day(20, 9));
    const count = `SELECT count(*) AS n FROM appointments WHERE business_id IN (${a.id}, ${c.id})`;
    const plain = await notification.$queryRawUnsafe<{ n: bigint }[]>(count);
    expect(plain[0]!.n).toBe(0n);
    const all = await notification.$transaction(async (tx) => {
      await forAllBusinesses(tx, 'notification');
      return tx.$queryRawUnsafe<{ n: bigint }[]>(count);
    });
    expect(all[0]!.n).toBe(2n);
    await expect(
      notification.$transaction(async (tx) => {
        await forAllBusinesses(tx, 'notification');
        await tx.$executeRawUnsafe(`UPDATE appointments SET notes = 'x' WHERE business_id = ${a.id}`);
      }),
    ).rejects.toThrow(/permission denied/);
    // Another service can't borrow it.
    await expect(booking.$transaction((tx) => forAllBusinesses(tx, 'notification'))).rejects.toThrow(
      /permission denied to set role/,
    );
  });

  it('a service publishes only its own events, from its cross-business role too', async () => {
    const event = (source: string) =>
      `INSERT INTO outbox_events (id, aggregate_id, aggregate_type, source, topic, partition_key, payload)
       VALUES (${ids.next()}, 1, 'test', '${source}', 'test.topic', '1', '{}')`;
    await booking.$executeRawUnsafe(event('booking-service'));
    await expect(booking.$executeRawUnsafe(event('queue-service'))).rejects.toThrow(/row-level security/);
    await booking.$transaction(async (tx) => {
      await forAllBusinesses(tx, 'booking');
      await tx.$executeRawUnsafe(event('booking-service'));
    });
  });

  it('a service with nothing here can’t connect', async () => {
    const analytics = asService('analytics', SHARD);
    try {
      await expect(analytics.$queryRawUnsafe('SELECT 1')).rejects.toThrow(/CONNECT|permission denied/);
    } finally {
      await analytics.$disconnect();
    }
  });
});

describe('a service’s data plane on business shards (D3a)', () => {
  const planeFor = (service: 'notification' | 'analytics') => {
    const url = new URL(testEnv.cluster);
    url.username = `buku_svc_${service}`;
    url.password = encodeURIComponent(passwords[service]);
    url.pathname = '/buku_test';
    return DataPlane.start({
      service,
      databaseUrl: url.toString(),
      directoryUrl: (() => {
        const d = new URL(url.toString());
        d.pathname = '/buku_directory_test';
        return d.toString();
      })(),
      instance: `plane-test-${service}`,
      env,
    });
  };
  beforeAll(async () => {
    await ensureServiceRoles();
    await applyStatements(
      testEnv.adminUrl('buku_directory_test'),
      directoryAccessStatements('buku_directory_test', passwords),
    );
    await applyShardAccess(testEnv.adminUrl(SHARD), 'business', passwords);
  });

  it('scopes work to one business, or visits every shard through the cross-business role', async () => {
    const a = await aBusiness('plane-one');
    const c = await aBusiness('plane-two');
    await book(a, day(22, 9));
    await book(c, day(22, 9));
    await book(c, day(22, 11));
    const plane = await planeFor('notification');
    try {
      expect(await plane.inBusiness(a.id, (tx) => tx.appointment.count())).toBe(1);
      expect(await plane.inBusiness(c.id, (tx) => tx.appointment.count())).toBe(2);
      const all = await plane.acrossBusinesses((tx) =>
        tx.appointment.count({ where: { businessId: { in: [a.id, c.id] } } }),
      );
      expect(all.reduce((n, x) => n + x, 0)).toBe(3);
      const id = plane.id();
      expect(plane.id() > id).toBe(true);
    } finally {
      await plane.close();
    }
    // A service with no cross-business role can't sweep.
    const analytics = await planeFor('analytics').catch((err: unknown) => err);
    if (analytics instanceof DataPlane) {
      try {
        await expect(analytics.acrossBusinesses(() => Promise.resolve(0))).rejects.toThrow(
          /no cross-business role/,
        );
      } finally {
        await analytics.close();
      }
    }
  });

  it('an event written with its change is published from the shard, and handled once', async () => {
    const b = await aBusiness('plane-events');
    const published: string[] = [];
    const producer = {
      publishMany: (messages: { event: { id: string } }[]) => {
        for (const m of messages) published.push(m.event.id);
        return Promise.resolve();
      },
    } as unknown as EventProducer;
    const eventId = ids.next();
    const event = createEvent({
      id: eventId.toString(),
      type: 'bookings.created',
      source: 'buku-app-service',
      subject: b.id.toString(),
      data: { test: true },
    });
    await asBusiness(b.id, (tx) => enqueueShardEvent(tx, ids.next(), event, 'business'));
    const relay = new OutboxRelay({ db: app, producer, source: 'buku-app-service' });
    expect(await relay.runOnce()).toBe(1);
    expect(published).toEqual([eventId.toString()]);
    expect(await relay.runOnce()).toBe(0);
    // A consumer handles it once, even if it comes again days later.
    const first = await app.$transaction((tx) => processOnceOnShard(tx, 'plane-test', event));
    const again = await app.$transaction((tx) => processOnceOnShard(tx, 'plane-test', event));
    expect([first, again]).toEqual([true, false]);
  });

  it('an event goes out only if its change commits; a handler that fails leaves it to be handled again', async () => {
    const b = await aBusiness('plane-rollback');
    const published: string[] = [];
    const producer = {
      publishMany: (messages: { event: { id: string } }[]) => {
        for (const m of messages) published.push(m.event.id);
        return Promise.resolve();
      },
    } as unknown as EventProducer;
    const event = (id: bigint) =>
      createEvent({
        id: id.toString(),
        type: 'bookings.created',
        source: 'buku-app-service',
        subject: b.id.toString(),
        data: { test: true },
      });
    const kept = event(ids.next());
    const dropped = event(ids.next());
    await asBusiness(b.id, (tx) => enqueueShardEvent(tx, ids.next(), kept, 'business'));
    await expect(
      asBusiness(b.id, async (tx) => {
        await enqueueShardEvent(tx, ids.next(), dropped, 'business');
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');
    const relay = new OutboxRelay({ db: app, producer, source: 'buku-app-service' });
    while ((await relay.runOnce()) > 0);
    expect(published).toContain(kept.id);
    expect(published).not.toContain(dropped.id);

    // The mark that it was handled is written with the handler's work: if that fails, so does the mark.
    await expect(
      app.$transaction(async (tx) => {
        await processOnceOnShard(tx, 'plane-test', kept);
        throw new Error('the side effect failed');
      }),
    ).rejects.toThrow('the side effect failed');
    expect(await app.$transaction((tx) => processOnceOnShard(tx, 'plane-test', kept))).toBe(true);
  });
});
