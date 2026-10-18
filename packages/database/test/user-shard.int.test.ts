import { IdGenerator, publicId } from '@buku/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabaseClient,
  createDirectoryClient,
  createUserShardClient,
  ShardClients,
  ShardRouter,
  shardUrl,
  type Database,
  type DirectoryClient,
  type UserShardClient,
} from '../src/index.js';
import { applyShardAccess } from '../src/apply-access.js';
import { provisionShards } from '../src/provision.js';
import { asService, ensureServiceRoles, passwords } from './service-roles.js';
import { testEnv } from './int-env.js';

/**
 * User shards (docs/DATABASE.md DB-010, §9.2) made real: provisioned from the registry, migrated,
 * partitioned, locked down, and used end to end (a sign-up placed, its email claimed globally,
 * its row written on the right shard, found again by email). Two throwaway shards of 2 people each
 * (buku_test_user_pk_1 and _2) are rebuilt for every run.
 */

const PATTERN = 'buku_test_{entity}_{region}_{shard}';
const SHARDS = ['buku_test_user_pk_1', 'buku_test_user_pk_2'];
const env = { ...process.env, BUKU_DB_CLUSTER_TEST: testEnv.cluster };

let directory: DirectoryClient; // the schema owner: sets up the registry
let app: DirectoryClient; // what services sign in as
let server: Database; // the admin, on the cluster's `postgres` database
let router: ShardRouter;
let users: ShardClients<UserShardClient>;
let shard1: UserShardClient;
let owner1: Database; // the migrator (schema owner) on shard 1
const ids = new IdGenerator(3);

const adminOn = (database: string) =>
  createDatabaseClient({
    url: `postgresql://${testEnv.admin.user}:${encodeURIComponent(testEnv.admin.password)}@${new URL(testEnv.cluster).host}/${database}`,
    applicationName: 'user-shard-int-test',
    maxConnections: 2,
  });

beforeAll(async () => {
  directory = createDirectoryClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'user-shard-int-test',
  });
  server = adminOn('postgres');
  // Last run's shards go first: a fresh registry must not find old data.
  for (const name of SHARDS) {
    await server.$executeRawUnsafe(
      `SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'partman:${name}'`,
    );
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  }
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
      entity: 'user',
      description: 'test people',
      defaultRowLimit: 2n,
      databasePattern: PATTERN,
      placedBy: ['buku_app'],
    },
  });
  for (let i = 0; i < 2; i++)
    await directory.$queryRaw`SELECT shard_no FROM registry.add_shard('user', 0::smallint, 3::smallint)`;
  // Signing up claims an email: the tests' role may write that kind (services: auth only).
  await directory.$executeRaw`UPDATE lookup.handle_kinds SET writers = array_append(writers, 'buku_app')
    WHERE name = 'user.email' AND NOT ('buku_app' = ANY (writers))`;

  const made = await provisionShards({
    directoryUrl: testEnv.directoryMigratorUrl,
    admin: testEnv.admin,
    migrator: testEnv.migrator,
    env,
    families: ['user'],
  });
  expect(made.map((s) => [s.databaseName, s.created])).toEqual(SHARDS.map((n) => [n, true]));

  app = createDirectoryClient({ url: testEnv.directoryAppUrl, applicationName: 'user-shard-int-test' });
  router = new ShardRouter(app);
  await router.refresh();
  users = new ShardClients(router, 'user', (s) =>
    createUserShardClient({ url: shardUrl(s, testEnv.app, env), applicationName: 'user-shard-int-test' }),
  );
  const [first] = await directory.shard.findMany({
    where: { entity: 'user', shardNo: 1 },
    include: { cluster: true },
  });
  shard1 = users.forShard({
    entity: 'user',
    region: 0,
    shardNo: 1,
    status: first!.status,
    minId: 1n,
    maxId: null,
    lastId: null,
    clusterId: 3,
    databaseName: SHARDS[0]!,
    dsnSecret: 'BUKU_DB_CLUSTER_TEST',
  });
  owner1 = createDatabaseClient({
    url: shardUrl(
      { databaseName: SHARDS[0]!, dsnSecret: 'BUKU_DB_CLUSTER_TEST' } as never,
      testEnv.migrator,
      env,
    ),
    applicationName: 'user-shard-int-test',
  });
});

afterAll(async () => {
  await users?.close();
  await owner1?.$disconnect();
  await server?.$disconnect();
  await directory?.$disconnect();
  await app?.$disconnect();
});

/** A valid new person (only what's required). */
const person = (extra: Record<string, unknown> = {}) => ({
  id: ids.next(),
  publicId: publicId(),
  name: 'Test Person',
  ...extra,
});

describe('provisioning shards from the registry', () => {
  it('makes every registered shard a migrated database, once, and schedules its upkeep', async () => {
    const again = await provisionShards({
      directoryUrl: testEnv.directoryMigratorUrl,
      admin: testEnv.admin,
      migrator: testEnv.migrator,
      env,
      families: ['user'],
    });
    expect(again.map((s) => s.created)).toEqual([false, false]);
    const jobs = await server.$queryRaw<{ jobname: string; username: string }[]>`
      SELECT jobname, username FROM cron.job WHERE jobname LIKE 'partman:buku_test_user_%' ORDER BY jobname`;
    expect(jobs).toEqual(SHARDS.map((n) => ({ jobname: `partman:${n}`, username: 'buku_migrator' })));
    // Each database knows which shard it is.
    const tag = await owner1.$queryRaw<{ shard: string }[]>`SELECT current_setting('buku.shard') AS shard`;
    expect(tag[0]!.shard).toBe('user:0:1');
  });

  it('partitions exist ahead: sessions two years out, messages three months', async () => {
    const parts = await owner1.$queryRaw<{ parent: string; n: bigint; last: string }[]>`
      SELECT p.relname AS parent, count(*) AS n, max(c.relname) FILTER (WHERE c.relname NOT LIKE '%default') AS last
      FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class p ON p.oid = i.inhparent
      WHERE c.relkind = 'r' GROUP BY p.relname ORDER BY p.relname`;
    const byName = Object.fromEntries(parts.map((p) => [p.parent, p]));
    const monthsAhead = (n: number) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + n);
      return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}01`;
    };
    expect(byName.refresh_tokens!.last).toBe(`refresh_tokens_p${monthsAhead(25)}`);
    expect(byName.notifications!.last).toBe(`notifications_p${monthsAhead(3)}`);
    expect(Object.keys(byName).sort()).toEqual([
      'audit_logs',
      'notifications',
      'outbox_events',
      'processed_events',
      'refresh_tokens',
    ]);
    // A row goes to its month's partition.
    const u = await shard1.user.create({ data: person() });
    await shard1.notification.create({
      data: { id: ids.next(), userId: u.id, type: 'test', channel: 'in_app', title: 't', body: 'b' },
    });
    const where = await owner1.$queryRaw<{ part: string }[]>`
      SELECT tableoid::regclass::text AS part FROM notifications WHERE user_id = ${u.id}`;
    expect(where[0]!.part).toBe(`notifications_p${monthsAhead(0)}`);
  });
});

describe('who may do what on a user shard (DB-023)', () => {
  it('nothing is granted by default: the app role reaches parents only, never a partition', async () => {
    await expect(shard1.$queryRawUnsafe('SELECT count(*) FROM notifications_default')).rejects.toThrow(
      /permission denied/,
    );
    await owner1.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS scratch_table (id int)');
    await expect(shard1.$queryRawUnsafe('SELECT * FROM scratch_table')).rejects.toThrow(/permission denied/);
    await owner1.$executeRawUnsafe('DROP TABLE scratch_table');
    expect(await shard1.user.count()).toBeGreaterThanOrEqual(0);
  });

  it('the audit log is append-only, even for the schema owner', async () => {
    const id = ids.next();
    await shard1.auditLog.create({ data: { id, action: 'test.entry', resourceType: 'test' } });
    await expect(shard1.auditLog.updateMany({ where: { id }, data: { action: 'x' } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(owner1.$executeRaw`DELETE FROM audit_logs WHERE id = ${id}`).rejects.toThrow(
      /can't be changed or deleted/,
    );
  });
});

describe('a person’s rows keep their shape', () => {
  it('refuses malformed people', async () => {
    const bad = [
      person({ publicId: 'too-short' }),
      person({ role: 'god' }),
      person({ status: 'zombie' }),
      person({ name: '   ' }),
      person({ locale: 'english please' }),
      // An employee login needs both its business and a username, in the allowed form.
      person({ username: 'ali' }),
      person({ managedByBusinessId: 5n }),
      person({ managedByBusinessId: 5n, username: 'Ali Khan' }),
      // Blind indexes are 16 bytes, and come with the encrypted value.
      person({ emailHash: Buffer.alloc(32), emailEnc: Buffer.alloc(40) }),
      person({ emailHash: Buffer.alloc(16) }),
      person({ purgedAt: new Date() }),
    ];
    for (const data of bad)
      await expect(
        shard1.user.create({ data }),
        JSON.stringify(data, (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v)),
      ).rejects.toThrow();
    const ok = await shard1.user.create({
      data: person({
        managedByBusinessId: 5n,
        username: 'ali.khan',
        emailHash: Buffer.alloc(16, 7),
        emailEnc: Buffer.alloc(40),
      }),
    });
    expect(ok.username).toBe('ali.khan');
    // A closed employee account gives its username back, and keeps its business.
    const closed = await shard1.user.create({
      data: person({ managedByBusinessId: 5n, deletedAt: new Date() }),
    });
    expect(closed.username).toBeNull();
  });

  it('one appointment at a time per person, across every business; back to back is fine', async () => {
    const u = await shard1.user.create({ data: person() });
    const at = (h: number) => new Date(Date.UTC(2027, 0, 10, h));
    const hold = (start: number, end: number, extra: Record<string, unknown> = {}) =>
      shard1.userTimeReservation.create({
        data: {
          id: ids.next(),
          userId: u.id,
          businessId: 9n,
          startAt: at(start),
          endAt: at(end),
          expiresAt: new Date(Date.now() + 120_000),
          ...extra,
        },
      });
    await hold(10, 11);
    await expect(hold(10, 12)).rejects.toThrow();
    await hold(11, 12);
    // Booked (an appointment exists) means no expiry; held means one.
    await expect(hold(13, 14, { appointmentId: 1n })).rejects.toThrow();
    await hold(13, 14, { appointmentId: 1n, expiresAt: null });
    // Someone else, same time: fine.
    const other = await shard1.user.create({ data: person() });
    await shard1.userTimeReservation.create({
      data: {
        id: ids.next(),
        userId: other.id,
        businessId: 9n,
        startAt: at(10),
        endAt: at(11),
        expiresAt: new Date(),
      },
    });
  });

  it('one queue at a time per person', async () => {
    const u = await shard1.user.create({ data: person() });
    const ticket = { userId: u.id, ticketCreatedAt: new Date(), businessId: 9n, sessionId: 1n };
    await shard1.userActiveTicket.create({ data: { ...ticket, ticketId: 1n } });
    await expect(shard1.userActiveTicket.create({ data: { ...ticket, ticketId: 2n } })).rejects.toThrow();
  });

  it('an event redelivered on another day is still caught (partitioned by its own time, DB-019)', async () => {
    const event = {
      consumer: 'test-consumer',
      eventId: 'evt-1',
      occurredAt: new Date(Date.now() - 86_400_000),
    };
    expect((await shard1.processedEvent.createMany({ data: [event], skipDuplicates: true })).count).toBe(1);
    expect((await shard1.processedEvent.createMany({ data: [event], skipDuplicates: true })).count).toBe(0);
    expect(
      (
        await shard1.processedEvent.createMany({
          data: [{ ...event, consumer: 'another' }],
          skipDuplicates: true,
        })
      ).count,
    ).toBe(1);
  });
});

describe('a sign-up, end to end', () => {
  const emailKey = (n: number) => Buffer.alloc(16, n);
  type Claim = { claimed: boolean; previous_owner: bigint | null };

  /** What auth-service will do (D3): make the ID, place it, claim the email, write the row. */
  async function signUp(email: number) {
    const id = ids.next();
    const shard = await router.place('user', id);
    const [c] = await app.$queryRaw<
      Claim[]
    >`SELECT * FROM lookup.claim('user.email', ${emailKey(email)}, ${id}::bigint)`;
    if (!c!.claimed) return { id, shard, taken: true };
    await users.forShard(shard).user.create({
      data: {
        id,
        publicId: publicId(),
        name: `Person ${email}`,
        emailHash: emailKey(email),
        emailEnc: Buffer.alloc(40),
      },
    });
    return { id, shard, taken: false };
  }

  it('places people on the open shard until it is full, then the next; each is found again by email', async () => {
    // Shards hold 2 people here; earlier tests wrote to shard 1 directly, without placing.
    const a = await signUp(21);
    const b = await signUp(22);
    const c = await signUp(23);
    expect([a.shard.shardNo, b.shard.shardNo, c.shard.shardNo]).toEqual([1, 1, 2]);

    // Signing in: the email's handle gives the ID, the router the shard, the shard the row.
    const [found] = await app.$queryRaw<
      { id: bigint }[]
    >`SELECT lookup.find('user.email', ${emailKey(23)}) AS id`;
    expect(found!.id).toBe(c.id);
    const row = await (await users.forId(found!.id)).user.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.name).toBe('Person 23');
    // It is on shard 2 and nowhere else.
    expect(await shard1.user.findUnique({ where: { id: c.id } })).toBeNull();
  });

  it('an email already in use is refused, whichever shard its owner is on', async () => {
    const first = await signUp(31);
    const second = await signUp(31);
    expect(second.taken).toBe(true);
    expect(first.taken).toBe(false);
  });
});

describe('indexes', () => {
  it('every foreign key has an index that starts with it (DB-007)', async () => {
    const missing = await owner1.$queryRaw<{ fk: string }[]>`
      SELECT c.conname AS fk FROM pg_constraint c
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND c.conparentid = 0
        AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1])`;
    expect(missing).toEqual([]);
  });
});

describe('each service’s rights on a user shard (D2d)', () => {
  let booking: Database;
  let notification: Database;
  beforeAll(async () => {
    await ensureServiceRoles();
    await applyShardAccess(testEnv.adminUrl(SHARDS[0]!), 'user', passwords);
    booking = asService('booking', SHARDS[0]!);
    notification = asService('notification', SHARDS[0]!);
  });
  afterAll(async () => {
    await booking?.$disconnect();
    await notification?.$disconnect();
  });

  it('booking reads who a person is, never their credentials, and claims their time', async () => {
    const u = await shard1.user.create({ data: person({ passwordHash: '$argon2id$test' }) });
    const seen = await booking.$queryRawUnsafe<{ name: string }[]>(
      `SELECT name FROM users WHERE id = ${u.id}`,
    );
    expect(seen[0]!.name).toBe('Test Person');
    await expect(
      booking.$queryRawUnsafe(`SELECT password_hash FROM users WHERE id = ${u.id}`),
    ).rejects.toThrow(/permission denied/);
    await expect(booking.$executeRawUnsafe(`UPDATE users SET name = 'x' WHERE id = ${u.id}`)).rejects.toThrow(
      /permission denied/,
    );
    await booking.$executeRawUnsafe(
      `INSERT INTO user_time_reservations (id, user_id, business_id, start_at, end_at, expires_at)
       VALUES (${ids.next()}, ${u.id}, 9, '2027-05-01 10:00Z', '2027-05-01 10:30Z', now() + interval '2 minutes')`,
    );
  });

  it('notification may switch a device off, and change nothing else about it', async () => {
    const u = await shard1.user.create({ data: person() });
    const token = await shard1.pushToken.create({
      data: { id: ids.next(), userId: u.id, platform: 'web', token: `t-${u.id}` },
    });
    await notification.$executeRawUnsafe(`UPDATE push_tokens SET is_active = false WHERE id = ${token.id}`);
    await expect(
      notification.$executeRawUnsafe(`UPDATE push_tokens SET token = 'stolen' WHERE id = ${token.id}`),
    ).rejects.toThrow(/permission denied/);
  });

  it('search and analytics have nothing on a user shard: no connection', async () => {
    for (const service of ['search', 'analytics'] as const) {
      const db = asService(service, SHARDS[0]!);
      try {
        await expect(db.$queryRawUnsafe('SELECT 1'), service).rejects.toThrow(/CONNECT|permission denied/);
      } finally {
        await db.$disconnect();
      }
    }
  });
});
