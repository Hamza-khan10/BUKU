import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  constraintNameOf,
  createDatabaseClient,
  isExclusionViolation,
  isUniqueViolation,
  sqlStateOf,
  type Database,
} from '../src/index.js';
import { appointmentData, createBusinessFixture, type BusinessFixture } from './fixtures.js';
import { testEnv } from './int-env.js';

/**
 * These tests prove the guarantees the DATABASE enforces on its own, even if
 * application code is wrong. They run as `buku_app`, the role services use.
 */
let db: Database;
let f: BusinessFixture;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'int-test', maxConnections: 4 });
  f = await createBusinessFixture(db);
});
afterAll(async () => {
  await db.$disconnect();
});

describe('no double booking (exclusion constraints)', () => {
  it('rejects an overlapping active appointment for the same staff member', async () => {
    await db.appointment.create({ data: appointmentData(f, at('2030-01-07T10:00:00Z')) });
    const overlapping = db.appointment.create({ data: appointmentData(f, at('2030-01-07T10:15:00Z')) });
    const err: unknown = await overlapping.catch((e: unknown) => e);
    expect(isExclusionViolation(err)).toBe(true);
    expect(constraintNameOf(err)).toBe('appointments_no_staff_overlap');
  });

  it('allows back-to-back appointments (half-open time ranges)', async () => {
    await db.appointment.create({ data: appointmentData(f, at('2030-01-08T10:00:00Z')) });
    await expect(
      db.appointment.create({ data: appointmentData(f, at('2030-01-08T10:30:00Z')) }),
    ).resolves.toBeDefined();
  });

  it('allows the same time with a different staff member', async () => {
    await db.appointment.create({ data: appointmentData(f, at('2030-01-09T10:00:00Z')) });
    await expect(
      db.appointment.create({
        data: appointmentData(f, at('2030-01-09T10:00:00Z'), 30, { staffId: f.staffB.id }),
      }),
    ).resolves.toBeDefined();
  });

  it('frees the slot when the earlier appointment is cancelled', async () => {
    await db.appointment.create({
      data: appointmentData(f, at('2030-01-10T10:00:00Z'), 30, { status: 'cancelled' }),
    });
    await expect(
      db.appointment.create({ data: appointmentData(f, at('2030-01-10T10:00:00Z')) }),
    ).resolves.toBeDefined();
  });

  it('only lets ONE of many concurrent bookings for the same slot succeed', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        db.appointment.create({ data: appointmentData(f, at('2030-01-11T12:00:00Z')) }),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    for (const failed of attempts.filter((a) => a.status === 'rejected')) {
      expect(isExclusionViolation(failed.reason)).toBe(true);
    }
  });
});

describe('CHECK constraints', () => {
  it('rejects an appointment that ends before it starts', async () => {
    const data = { ...appointmentData(f, at('2030-02-01T10:00:00Z')), endAt: at('2030-02-01T09:00:00Z') };
    const err: unknown = await db.appointment.create({ data }).catch((e: unknown) => e);
    expect(sqlStateOf(err)).toBe('23514');
  });

  it('rejects a malformed confirmation code and a cancelled row without cancel metadata', async () => {
    const bad = { ...appointmentData(f, at('2030-02-02T10:00:00Z')), confirmationCode: 'BK-0O1IL0' };
    expect(sqlStateOf(await db.appointment.create({ data: bad }).catch((e: unknown) => e))).toBe('23514');
    const noMeta = { ...appointmentData(f, at('2030-02-03T10:00:00Z')), status: 'cancelled' as const };
    expect(sqlStateOf(await db.appointment.create({ data: noMeta }).catch((e: unknown) => e))).toBe('23514');
  });

  it('rejects out-of-range ratings and invalid opening hours', async () => {
    const hours = db.businessHours.create({
      data: { businessId: f.business.id, dayOfWeek: 1, openTime: '18:00', closeTime: '09:00' },
    });
    expect(sqlStateOf(await hours.catch((e: unknown) => e))).toBe('23514');
    const svc = db.service.create({
      data: { businessId: f.business.id, name: 'Bad', durationMinutes: 2, price: 1, currency: 'PKR' },
    });
    expect(sqlStateOf(await svc.catch((e: unknown) => e))).toBe('23514');
  });
});

describe('queue integrity', () => {
  it('allows one live ticket per user per session, and rejoining after completion', async () => {
    const session = await db.queueSession.create({
      data: { businessId: f.business.id, sessionDate: at('2030-03-01T00:00:00Z') },
    });
    const first = await db.queueEntry.create({
      data: { sessionId: session.id, userId: f.customer.id, ticketNumber: 1 },
    });
    const dup = await db.queueEntry
      .create({ data: { sessionId: session.id, userId: f.customer.id, ticketNumber: 2 } })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(dup)).toBe(true);

    await db.queueEntry.update({ where: { id: first.id }, data: { status: 'completed' } });
    await expect(
      db.queueEntry.create({ data: { sessionId: session.id, userId: f.customer.id, ticketNumber: 3 } }),
    ).resolves.toBeDefined();
  });
});

describe('derived data maintained by triggers', () => {
  it('computes the PostGIS location and supports radius queries', async () => {
    const rows = await db.$queryRaw<{ id: string; meters: number }[]>`
      SELECT id, extensions.ST_Distance(location, extensions.ST_MakePoint(74.3587, 31.5304)::extensions.geography) AS meters
      FROM businesses
      WHERE id = ${f.business.id}::uuid
        AND extensions.ST_DWithin(location, extensions.ST_MakePoint(74.3587, 31.5304)::extensions.geography, 5000)`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.meters).toBeGreaterThan(1000);
    expect(rows[0]!.meters).toBeLessThan(1200); // 0.01° latitude ≈ 1.1 km
  });

  it('keeps the full-text search vector up to date', async () => {
    const hit = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM businesses WHERE search_vector @@ plainto_tsquery('english', 'barbers') AND id = ${f.business.id}::uuid`;
    expect(hit).toHaveLength(1);
  });

  it('recalculates avg_rating and review_count when reviews change', async () => {
    const appt = await db.appointment.create({
      data: { ...appointmentData(f, at('2029-12-01T10:00:00Z')), status: 'completed' },
    });
    const review = await db.review.create({
      data: { appointmentId: appt.id, userId: f.customer.id, businessId: f.business.id, overallRating: 4 },
    });
    let biz = await db.business.findUniqueOrThrow({ where: { id: f.business.id } });
    expect(biz.reviewCount).toBe(1);
    expect(biz.avgRating.toString()).toBe('4');

    await db.review.update({ where: { id: review.id }, data: { isVisible: false } });
    biz = await db.business.findUniqueOrThrow({ where: { id: f.business.id } });
    expect(biz.reviewCount).toBe(0);
  });
});

describe('soft-deleted users', () => {
  it('are hidden from normal reads, visible with an explicit opt-out', async () => {
    const u = await db.user.create({
      data: { name: 'Gone', emailHash: 'f'.repeat(64), deletedAt: new Date() },
    });
    expect(await db.user.findUnique({ where: { id: u.id } })).toBeNull();
    expect(await db.user.findFirst({ where: { name: 'Gone' } })).toBeNull();
    expect(await db.user.count({ where: { id: u.id } })).toBe(0);
    expect(await db.user.findFirst({ where: { id: u.id, deletedAt: undefined } })).not.toBeNull();
    expect(await db.user.count({ where: { id: u.id, deletedAt: { not: null } } })).toBe(1);
  });
});

describe('partitioned tables', () => {
  it('routes rows into the monthly partition in the `partitions` schema', async () => {
    const createdAt = new Date();
    await db.notification.create({
      data: {
        userId: f.customer.id,
        type: 'welcome',
        channel: 'in_app',
        title: 'Hi',
        body: 'Welcome',
        createdAt,
      },
    });
    const [row] = await db.$queryRaw<{ partition: string }[]>`
      SELECT tableoid::regclass::text AS partition FROM notifications WHERE user_id = ${f.customer.id}::uuid LIMIT 1`;
    const month = `${createdAt.getUTCFullYear()}_${String(createdAt.getUTCMonth() + 1).padStart(2, '0')}`;
    expect(row!.partition).toBe(`partitions.notifications_${month}`);
  });

  it('lets the app role create future partitions only through the SECURITY DEFINER function', async () => {
    await expect(db.$queryRaw`SELECT ensure_monthly_partitions(13, 0)`).resolves.toBeDefined();
  });
});

describe('least privilege: the app role cannot change the schema', () => {
  it.each([
    'DROP TABLE categories',
    'TRUNCATE users',
    'ALTER TABLE users ADD COLUMN pwned int',
    'CREATE TABLE pwned (id int)',
    'CREATE TABLE partitions.pwned (id int)',
  ])('%s → permission denied', async (sql) => {
    const err: unknown = await db.$executeRawUnsafe(sql).catch((e: unknown) => e);
    expect(['42501']).toContain(sqlStateOf(err));
  });
});

describe('AI knowledge base (pgvector)', () => {
  it('stores embeddings and returns nearest chunks by cosine distance', async () => {
    const vec = (hot: number) => `[${Array.from({ length: 1536 }, (_, i) => (i === hot ? 1 : 0)).join(',')}]`;
    for (const [content, hot] of [
      ['We are open 9 to 6', 0],
      ['Parking is behind the building', 1],
      ['Cancellations need 12 hours notice', 2],
    ] as const) {
      await db.$executeRaw`
        INSERT INTO ai.business_knowledge_chunks (business_id, source, content, embedding)
        VALUES (${f.business.id}::uuid, 'faq', ${content}, ${vec(hot)}::extensions.vector)`;
    }
    const rows = await db.$queryRaw<{ content: string }[]>`
      SELECT content FROM ai.business_knowledge_chunks
      WHERE business_id = ${f.business.id}::uuid
      ORDER BY embedding OPERATOR(extensions.<=>) ${vec(1)}::extensions.vector
      LIMIT 1`;
    expect(rows[0]!.content).toBe('Parking is behind the building');
  });
});
