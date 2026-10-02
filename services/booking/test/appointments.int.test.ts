import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  Readiness,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import { createS3Storage, MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { givePlan, withBilling } from '../../../packages/billing/test/helpers.js';
import { buildBookingApp } from '../src/app.js';
import { addDays, toInstant, wallClock } from '../src/availability/time.js';

/**
 * Availability and booking against the real database: the database's
 * no-overlap rules are part of what is being tested.
 */

const TZ = 'Asia/Karachi';
let app: Express;
let db: Database;
let redis: Redis;
let signer: JwtSigner;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const hex64 = () => randomBytes(32).toString('hex');
type Person = Awaited<ReturnType<typeof person>>;

async function person(role: Role = 'user', name = `Customer ${randomUUID().slice(0, 6)}`) {
  const user = await db.user.create({ data: { name, emailHash: hex64(), role } });
  const { token } = await signer.sign({ sub: user.id, role, sid: randomUUID() });
  return { id: user.id, name, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

/** A day two days from now (comfortably beyond the default 60-minute notice). */
const DAY = () => addDays(wallClock(new Date(), TZ).date, 2);
const at = (date: string, time: string) => toInstant(date, time, TZ)!.toISOString();

/**
 * A salon open every day 09:00–17:00 with `staffCount` people who all do a
 * 30-minute haircut (+ `buffer` minutes clean-up).
 */
async function salon(
  opts: { staffCount?: number; buffer?: number; settings?: Record<string, unknown> } = {},
) {
  const owner = await person();
  const suffix = randomUUID().slice(-12);
  const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const b = await db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Salon ${suffix}`,
      slug: `salon-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: TZ,
      currency: 'PKR',
    },
  });
  const service = await db.service.create({
    data: {
      businessId: b.id,
      name: 'Haircut',
      durationMinutes: 30,
      bufferMinutes: opts.buffer ?? 0,
      price: 800,
      currency: 'PKR',
    },
  });
  const staff = [];
  for (let i = 0; i < (opts.staffCount ?? 1); i++) {
    const s = await db.staff.create({ data: { businessId: b.id, displayName: `Stylist ${i + 1}` } });
    await db.staffService.create({ data: { staffId: s.id, serviceId: service.id } });
    await db.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        businessId: b.id,
        staffId: s.id,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '17:00',
      })),
    });
    staff.push(s);
  }
  if (opts.settings) await db.bookingSettings.create({ data: { businessId: b.id, ...opts.settings } });
  const member = async (role: 'manager' | 'front_desk' | 'staff') => {
    const p = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: p.id, role } });
    return p;
  };
  return { owner, b, service, staff, member, base: `/v1/businesses/${b.id}` };
}

type Salon = Awaited<ReturnType<typeof salon>>;

const book = (who: Person, s: Salon, startAt: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post('/v1/appointments')
    .set(who.auth)
    .send({ businessId: s.b.id, serviceId: s.service.id, startAt, ...extra });

beforeAll(async () => {
  db = createDatabaseClient({
    url: testEnv.appUrl,
    applicationName: 'booking-appt-test',
    maxConnections: 10,
  });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'booking-appt-test' });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
  signer = await createJwtSigner({
    ...jwt,
    keyId: 'k1',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const verifier = await createJwtVerifier({
    ...jwt,
    keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
  });
  const storage = createS3Storage({
    endpoint: testEnv.s3.endpoint,
    publicEndpoint: testEnv.s3.endpoint,
    region: 'us-east-1',
    accessKeyId: testEnv.s3.accessKeyId,
    secretAccessKey: testEnv.s3.secretAccessKey,
    forcePathStyle: true,
  });
  ({ app } = buildBookingApp({
    db,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    mediaLinks: new MediaLinks(storage, {
      mediaBucket: testEnv.s3.mediaBucket,
      privateBucket: testEnv.s3.privateBucket,
    }),
    http: {
      service: 'booking-test',
      logger: createLogger({ service: 'booking-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
});

describe('Availability', () => {
  it('lists free start times in the business’s timezone, for one or several days', async () => {
    const s = await salon({ staffCount: 2 });
    const res = await request(app).get(`/v1/businesses/${s.b.slug}/availability`).query({
      serviceId: s.service.id,
      date: DAY(),
      days: 2,
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.timezone).toBe(TZ);
    expect(res.body.data.days.map((d: { date: string }) => d.date)).toEqual([DAY(), addDays(DAY(), 1)]);
    const slots = res.body.data.days[0].slots;
    expect(slots[0]).toEqual({
      startAt: at(DAY(), '09:00'),
      endAt: at(DAY(), '09:30'),
      time: '09:00',
      staffIds: s.staff.map((x) => x.id).sort(),
    });
    expect(slots.at(-1).time).toBe('16:30');
  });

  it('a booked time disappears for that employee, including the clean-up buffer', async () => {
    const s = await salon({ buffer: 15 });
    expect((await book(await person(), s, at(DAY(), '10:00'))).status).toBe(201);
    const slots = (
      await request(app)
        .get(`/v1/businesses/${s.b.id}/availability`)
        .query({ serviceId: s.service.id, date: DAY() })
    ).body.data.days[0].slots.map((x: { time: string }) => x.time);
    // 10:00–10:30 + 15 min clean-up: nothing may start from 09:30 (it would run into 10:00) to 10:30.
    expect(slots).toContain('09:15');
    expect(slots).not.toContain('09:30');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('10:45');
  });

  it('unknown or archived services are not found; past dates have no times', async () => {
    const s = await salon();
    const q = (serviceId: string, date: string) =>
      request(app).get(`/v1/businesses/${s.b.id}/availability`).query({ serviceId, date });
    expect((await q(randomUUID(), DAY())).status).toBe(404);
    expect((await q(s.service.id, addDays(DAY(), -10))).body.data.days[0].slots).toEqual([]);
    await db.service.update({ where: { id: s.service.id }, data: { isActive: false } });
    expect((await q(s.service.id, DAY())).status).toBe(404);
  });
});

describe('Booking', () => {
  it('automatic mode: confirmed at once, with a receipt (code + QR content) — nothing else stored', async () => {
    const s = await salon();
    const me = await person();
    const res = await book(me, s, at(DAY(), '11:00'), { notes: 'Short on the sides' });
    expect(res.status).toBe(201);
    const r = res.body.data;
    expect(r.code).toMatch(/^BK-[A-Z2-9]{6}$/);
    expect(r).toMatchObject({
      qr: r.code,
      status: 'confirmed',
      staff: { id: s.staff[0]!.id, displayName: 'Stylist 1' },
      service: { name: 'Haircut', durationMinutes: 30 },
      local: { date: DAY(), startTime: '11:00', endTime: '11:30', timezone: TZ },
      price: '800.00',
      currency: 'PKR',
      payment: 'pay_at_venue',
      notes: 'Short on the sides',
      policy: { canCancel: true, canReschedule: true },
    });
    const history = await db.appointmentStatusHistory.findMany({ where: { appointmentId: r.id } });
    expect(history.map((h) => [h.fromStatus, h.toStatus, h.actorType])).toEqual([
      [null, 'confirmed', 'user'],
    ]);
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: r.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.topic)).toEqual(['bookings.created', 'bookings.confirmed']);
    expect(JSON.stringify(events)).not.toContain(me.name); // events carry ids, not names
  });

  it('manual mode: pending until the business confirms; front desk may, staff may not', async () => {
    const s = await salon({ settings: { confirmationMode: 'manual' } });
    const res = await book(await person(), s, at(DAY(), '12:00'));
    expect(res.body.data.status).toBe('pending');
    const path = `${s.base}/appointments/${res.body.data.id}`;
    expect(
      (
        await request(app)
          .post(`${path}/confirm`)
          .set((await s.member('staff')).auth)
      ).status,
    ).toBe(403);
    const ok = await request(app)
      .post(`${path}/confirm`)
      .set((await s.member('front_desk')).auth);
    expect(ok.body.data.status).toBe('confirmed');
    expect((await request(app).post(`${path}/confirm`).set(s.owner.auth)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('a declined request is cancelled with reason "declined"', async () => {
    const s = await salon({ settings: { confirmationMode: 'manual' } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '12:30'));
    const declined = await request(app)
      .post(`${s.base}/appointments/${res.body.data.id}/decline`)
      .set(s.owner.auth)
      .send({ reason: 'Fully booked that day' });
    expect(declined.body.data).toMatchObject({
      status: 'cancelled',
      cancellation: { reasonCode: 'declined', cancelledBy: 'business' },
    });
    const receipt = await request(app).get(`/v1/appointments/${res.body.data.id}`).set(me.auth);
    expect(receipt.body.data.cancellation).toMatchObject({
      reasonCode: 'declined',
      reason: 'Fully booked that day',
    });
  });

  it('"anyone available" goes to the least-booked person; a taken person is refused', async () => {
    const s = await salon({ staffCount: 2 });
    const [one, two] = [
      await book(await person(), s, at(DAY(), '09:00')),
      await book(await person(), s, at(DAY(), '09:00')),
    ];
    expect(new Set([one.body.data.staff.id, two.body.data.staff.id]).size).toBe(2);
    const third = await book(await person(), s, at(DAY(), '09:00'));
    expect([third.status, third.body.error.code]).toEqual([409, 'SLOT_UNAVAILABLE']);
    // Chosen person, already busy at 09:00:
    const chosen = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[0]!.id });
    expect(chosen.status).toBe(409);
  });

  it('ten people racing for the last slot: exactly one gets it', async () => {
    const s = await salon();
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const results = await Promise.all(people.map((p) => book(p, s, at(DAY(), '15:00'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE'),
    ).toBe(true);
  });

  it('a customer can’t hold two overlapping appointments, even at different businesses (D-036)', async () => {
    const [a, b] = [await salon(), await salon()];
    const me = await person();
    expect((await book(me, a, at(DAY(), '13:00'))).status).toBe(201);
    const clash = await book(me, b, at(DAY(), '13:15'));
    expect([clash.status, clash.body.error.code]).toEqual([409, 'APPOINTMENT_OVERLAP']);
  });

  it('caps future bookings per customer per business (D-037), even when sent at once', async () => {
    const s = await salon({ staffCount: 3, settings: { maxFutureBookingsPerCustomer: 2 } });
    const me = await person();
    const results = await Promise.all(
      ['09:00', '10:00', '11:00', '12:00'].map((t) => book(me, s, at(DAY(), t))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'LIMIT_REACHED')).toBe(
      true,
    );
  });

  it('only offered times can be booked: outside hours, off-step, too soon, too far, in the past', async () => {
    const s = await salon({ settings: { bookingHorizonDays: 30 } });
    const me = await person();
    const code = async (startAt: string): Promise<string> =>
      ((await book(me, s, startAt)).body as { error: { code: string } }).error.code;
    expect(await code(at(DAY(), '08:00'))).toBe('SLOT_UNAVAILABLE');
    expect(await code(at(DAY(), '10:07'))).toBe('SLOT_UNAVAILABLE');
    expect(await code(new Date(Date.now() + 10 * 60_000).toISOString())).toBe('SLOT_TOO_SOON');
    expect(await code(at(addDays(DAY(), 40), '10:00'))).toBe('SLOT_TOO_FAR_AHEAD');
    expect(await code(new Date(Date.now() - 3_600_000).toISOString())).toBe('SLOT_IN_PAST');
  });

  it('employee accounts can’t book; requests must be signed in and well-formed', async () => {
    const s = await salon();
    const employee = await person('staff');
    const res = await book(employee, s, at(DAY(), '10:00'));
    expect([res.status, res.body.error.code]).toEqual([403, 'BOOKING_NOT_ALLOWED']);
    expect((await request(app).post('/v1/appointments').send({})).status).toBe(401);
    expect((await book(await person(), s, at(DAY(), '10:00'), { price: 1 })).status).toBe(400);
    expect((await book(await person(), s, 'tomorrow at ten')).status).toBe(400);
  });
});

describe('My appointments (receipts)', () => {
  it('only the customer sees their receipt; lists split upcoming and past', async () => {
    const s = await salon();
    const me = await person();
    const res = await book(me, s, at(DAY(), '14:00'));
    expect(
      (
        await request(app)
          .get(`/v1/appointments/${res.body.data.id}`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
    const upcoming = await request(app).get('/v1/appointments').set(me.auth);
    expect(upcoming.body.data.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);
    expect(upcoming.body.meta).toMatchObject({ total: 1 });
    expect((await request(app).get('/v1/appointments?scope=past').set(me.auth)).body.data).toEqual([]);
  });

  it('cancelling: reason, "book later" reminder, late flag inside the window; the time is free again', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 168 } }); // a week: DAY() is inside it
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    const cancel = await request(app)
      .post(`/v1/appointments/${res.body.data.id}/cancel`)
      .set(me.auth)
      .send({ reasonCode: 'schedule_conflict', note: 'Exam moved', bookLater: true });
    expect(cancel.body.data).toMatchObject({
      status: 'cancelled',
      cancellation: { cancelledBy: 'user', reasonCode: 'schedule_conflict', reason: 'Exam moved' },
      policy: { canCancel: false },
    });
    const row = await db.appointment.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.lateCancellation).toBe(true);
    expect(row.rebookReminderAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    expect(
      (
        await request(app)
          .post(`/v1/appointments/${res.body.data.id}/cancel`)
          .set(me.auth)
          .send({ reasonCode: 'other' })
      ).status,
    ).toBe(409);
    // Someone else can now take 10:00.
    expect((await book(await person(), s, at(DAY(), '10:00'))).status).toBe(201);
  });

  it('cancelling well before the window is not late', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 0 } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    await request(app)
      .post(`/v1/appointments/${res.body.data.id}/cancel`)
      .set(me.auth)
      .send({ reasonCode: 'not_needed' });
    const row = await db.appointment.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect([row.lateCancellation, row.rebookReminderAt]).toEqual([false, null]);
  });

  it('rescheduling moves the booking (same person when free), even to an overlapping time', async () => {
    const s = await salon({ staffCount: 2 });
    const me = await person();
    const first = await book(me, s, at(DAY(), '10:00'));
    const moved = await request(app)
      .post(`/v1/appointments/${first.body.data.id}/reschedule`)
      .set(me.auth)
      .send({ startAt: at(DAY(), '10:15') });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({
      local: { startTime: '10:15' },
      staff: { id: first.body.data.staff.id },
      rescheduledFromId: first.body.data.id,
    });
    const old = await db.appointment.findUniqueOrThrow({ where: { id: first.body.data.id } });
    expect(old.status).toBe('rescheduled');
    expect(old.confirmationCode).not.toBe(moved.body.data.code);
  });

  it('rescheduling is refused inside the cancellation window', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 168 } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    expect(res.body.data.policy.canReschedule).toBe(false);
    const moved = await request(app)
      .post(`/v1/appointments/${res.body.data.id}/reschedule`)
      .set(me.auth)
      .send({ startAt: at(DAY(), '11:00') });
    expect(moved.body.error.code).toBe('CANCELLATION_WINDOW_PASSED');
  });
});

describe('The business’s list (serve customers with or without a phone)', () => {
  it('shows the day, finds a receipt by code or a customer by name, without contact details', async () => {
    const s = await salon({ staffCount: 2 });
    const ayesha = await person('user', 'Ayesha Khan');
    const res = await book(ayesha, s, at(DAY(), '16:00'));
    const code: string = res.body.data.code;

    const day = await request(app).get(`${s.base}/appointments`).query({ date: DAY() }).set(s.owner.auth);
    expect(day.body.data.items.map((a: { code: string }) => a.code)).toEqual([code]);
    const item = day.body.data.items[0];
    expect(item.customer).toEqual({ id: ayesha.id, name: 'Ayesha Khan' });
    expect(JSON.stringify(item)).not.toMatch(/email|phone|avatar/i);

    const byCode = await request(app)
      .get(`${s.base}/appointments`)
      .query({ q: code.toLowerCase() })
      .set(s.owner.auth);
    expect(byCode.body.data.items.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);
    const byName = await request(app).get(`${s.base}/appointments`).query({ q: 'ayesha' }).set(s.owner.auth);
    expect(byName.body.data.items).toHaveLength(1);
    // Another business can't find it.
    const other = await salon();
    expect(
      (await request(app).get(`${other.base}/appointments`).query({ q: code }).set(other.owner.auth)).body
        .data.items,
    ).toEqual([]);
  });

  it('staff see only their own appointments; outsiders get 404; cancelling needs a reason', async () => {
    const s = await salon({ staffCount: 2 });
    const stylist = await s.member('staff');
    await db.staff.update({ where: { id: s.staff[0]!.id }, data: { userId: stylist.id } });
    const mine = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[0]!.id });
    const theirs = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[1]!.id });

    const list = await request(app).get(`${s.base}/appointments`).query({ date: DAY() }).set(stylist.auth);
    expect(list.body.data.items.map((a: { id: string }) => a.id)).toEqual([mine.body.data.id]);
    expect(
      (await request(app).get(`${s.base}/appointments/${theirs.body.data.id}`).set(stylist.auth)).status,
    ).toBe(404);
    expect(
      (
        await request(app)
          .get(`${s.base}/appointments`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);

    const path = `${s.base}/appointments/${theirs.body.data.id}/cancel`;
    expect((await request(app).post(path).set(s.owner.auth).send({})).status).toBe(400);
    const cancelled = await request(app).post(path).set(s.owner.auth).send({ reason: 'Stylist is ill' });
    expect(cancelled.body.data.cancellation).toMatchObject({
      cancelledBy: 'business',
      reasonCode: 'business_unavailable',
      late: false,
    });
  });
});

describe('Plans: the free visit (billing on)', () => {
  it('Free: one booking; cancelled ones don’t count; Plus is unlimited', async () => {
    await withBilling(db, 'user', async () => {
      const [a, b] = [await salon(), await salon()];
      const me = await person();
      const first = await book(me, a, at(DAY(), '10:00'));
      expect(first.status).toBe(201);
      const second = await book(me, b, at(DAY(), '12:00'));
      expect([second.status, second.body.error.code]).toEqual([409, 'PLAN_LIMIT_REACHED']);
      expect(second.body.error).toMatchObject({
        message: expect.stringContaining('free booking'),
        details: { limit: 'visits', max: 1, used: 1, plan: 'user_free' },
      });

      await request(app)
        .post(`/v1/appointments/${first.body.data.id}/cancel`)
        .set(me.auth)
        .send({ reasonCode: 'other' });
      expect((await book(me, b, at(DAY(), '12:00'))).status).toBe(201);

      await givePlan(db, { userId: me.id }, 'user_plus');
      expect((await book(me, a, at(DAY(), '14:00'))).status).toBe(201);
      expect((await book(me, b, at(DAY(), '15:00'))).status).toBe(201);
    });
  });

  it('two bookings at once at different businesses: only one free visit is used', async () => {
    await withBilling(db, 'user', async () => {
      const [a, b] = [await salon(), await salon()];
      const me = await person();
      const results = await Promise.all([book(me, a, at(DAY(), '10:00')), book(me, b, at(DAY(), '13:00'))]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    });
  });

  it('billing off: everyone books freely (as in every other test)', async () => {
    const s = await salon({ staffCount: 2 });
    const me = await person();
    expect((await book(me, s, at(DAY(), '10:00'))).status).toBe(201);
    expect((await book(me, s, at(DAY(), '11:00'))).status).toBe(201);
  });
});
