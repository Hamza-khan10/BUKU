import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  Readiness,
  type JwtSigner,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import { createEvent, TOPICS } from '@buku/kafka';
import { createS3Storage, MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { givePlan, withBilling } from '../../../packages/billing/test/helpers.js';
import { buildBookingApp } from '../src/app.js';
import { bookingEventHandler } from '../src/events/handlers.js';
import { todayIn } from '../src/schedules/schedule-service.js';
import type { StaffService } from '../src/staff/staff-service.js';

/**
 * booking-service part 1: the menu, staff profiles, schedules and booking
 * settings — against the real test database.
 */

let app: Express;
let staffService: StaffService;
let db: Database;
let redis: Redis;
let signer: JwtSigner;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const hex64 = () => randomBytes(32).toString('hex');

type Person = Awaited<ReturnType<typeof person>>;

async function person() {
  const user = await db.user.create({ data: { name: `U ${randomUUID().slice(0, 6)}`, emailHash: hex64() } });
  const { token } = await signer.sign({ sub: user.id, role: 'user', sid: randomUUID() });
  return { id: user.id, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

/** An owner with a business, plus team members in each role (each linked to a staff profile if asked). */
async function business(status: 'pending' | 'verified' | 'suspended' = 'pending') {
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
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      status,
    },
  });
  const member = async (role: 'manager' | 'front_desk' | 'staff') => {
    const p = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: p.id, role } });
    return p;
  };
  return { owner, b, member, base: `/v1/businesses/${b.id}` };
}

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'booking-int-test', maxConnections: 5 });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'booking-int-test' });
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
  ({ app, staff: staffService } = buildBookingApp({
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

const post = (path: string, who: Person, body: unknown) =>
  request(app)
    .post(path)
    .set(who.auth)
    .send(body as object);
const put = (path: string, who: Person, body: unknown) =>
  request(app)
    .put(path)
    .set(who.auth)
    .send(body as object);
const del = (path: string, who: Person) => request(app).delete(path).set(who.auth);
const get = (path: string, who?: Person) =>
  who ? request(app).get(path).set(who.auth) : request(app).get(path);

const haircut = (overrides: Record<string, unknown> = {}) => ({
  name: 'Haircut',
  durationMinutes: 30,
  price: 800,
  ...overrides,
});

describe('Service menu', () => {
  it('groups active services by category for customers; prices are exact, in the business currency', async () => {
    const { owner, b, base } = await business();
    const cuts = await post(`${base}/service-categories`, owner, { name: 'Haircuts', sortOrder: 1 });
    const colour = await post(`${base}/service-categories`, owner, { name: 'Colour', sortOrder: 0 });
    expect(cuts.status).toBe(201);

    await post(`${base}/services`, owner, haircut({ categoryId: cuts.body.data.id, price: 799.99 }));
    await post(
      `${base}/services`,
      owner,
      haircut({ name: 'Highlights', categoryId: colour.body.data.id, durationMinutes: 90 }),
    );
    await post(`${base}/services`, owner, haircut({ name: 'Beard trim', price: 300 }));
    const archived = await post(`${base}/services`, owner, haircut({ name: 'Old service' }));
    expect((await del(`${base}/services/${archived.body.data.id}`, owner)).status).toBe(204);

    const menu = await get(`/v1/businesses/${b.slug}/services`);
    expect(menu.status).toBe(200);
    expect(menu.headers['cache-control']).toBe('public, max-age=60');
    expect(menu.body.data.currency).toBe('PKR');
    expect(
      menu.body.data.categories.map((c: { name: string; services: { name: string }[] }) => [
        c.name,
        c.services.map((s) => s.name),
      ]),
    ).toEqual([
      ['Colour', ['Highlights']],
      ['Haircuts', ['Haircut']],
      ['Other services', ['Beard trim']],
    ]);
    const cut = menu.body.data.categories[1].services[0];
    expect(cut).toMatchObject({ price: '799.99', currency: 'PKR', durationMinutes: 30 });
    expect(cut).not.toHaveProperty('bufferMinutes');
    expect(menu.body.data.booking).toEqual({
      confirmationMode: 'automatic',
      bookingHorizonDays: 365,
      cancellationWindowHours: 12,
      minNoticeMinutes: 60,
    });

    // The team sees everything, archived included.
    const manage = await get(`${base}/services/manage`, owner);
    const all = manage.body.data.categories.flatMap(
      (c: { services: { name: string; isActive: boolean }[] }) => c.services,
    );
    expect(all.find((s: { name: string }) => s.name === 'Old service')).toMatchObject({ isActive: false });
  });

  it('owner and manager manage the menu; front desk and staff cannot; outsiders get 404', async () => {
    const { owner, member, base } = await business();
    const manager = await member('manager');
    expect((await post(`${base}/services`, manager, haircut())).status).toBe(201);
    for (const who of [await member('front_desk'), await member('staff')]) {
      expect((await post(`${base}/services`, who, haircut())).status).toBe(403);
    }
    expect((await post(`${base}/services`, await person(), haircut())).status).toBe(404);
    expect((await request(app).post(`${base}/services`).send(haircut())).status).toBe(401);
    expect((await get(`${base}/services/manage`, owner)).status).toBe(200);
  });

  it('validates prices and refuses unknown fields (currency comes from the business)', async () => {
    const { owner, base } = await business();
    for (const bad of [
      haircut({ price: 10.005 }),
      haircut({ price: -1 }),
      haircut({ durationMinutes: 2 }),
      haircut({ currency: 'USD' }),
      haircut({ businessId: randomUUID() }),
    ]) {
      expect((await post(`${base}/services`, owner, bad)).status).toBe(400);
    }
  });

  it('deleting a category keeps its services; names are unique per business; other businesses’ categories are off limits', async () => {
    const a = await business();
    const other = await business();
    const cat = await post(`${a.base}/service-categories`, a.owner, { name: 'Nails' });
    expect((await post(`${a.base}/service-categories`, a.owner, { name: 'Nails' })).status).toBe(409);
    const svc = await post(
      `${a.base}/services`,
      a.owner,
      haircut({ name: 'Manicure', categoryId: cat.body.data.id }),
    );

    const foreign = await post(`${other.base}/service-categories`, other.owner, { name: 'Theirs' });
    expect(
      (await post(`${a.base}/services`, a.owner, haircut({ categoryId: foreign.body.data.id }))).status,
    ).toBe(404);

    expect((await del(`${a.base}/service-categories/${cat.body.data.id}`, a.owner)).status).toBe(204);
    const row = await db.service.findUniqueOrThrow({ where: { id: svc.body.data.id } });
    expect([row.categoryId, row.isActive]).toEqual([null, true]);
  });

  it('a suspended business cannot change its menu', async () => {
    const { owner, base } = await business('suspended');
    const res = await post(`${base}/services`, owner, haircut());
    expect([res.status, res.body.error.code]).toEqual([403, 'BUSINESS_SUSPENDED']);
  });
});

describe('Staff profiles', () => {
  it('links a profile to a team account; customers see who does what', async () => {
    const { owner, b, member, base } = await business();
    const ali = await member('staff');
    const cut = await post(`${base}/services`, owner, haircut());
    const res = await post(`${base}/staff`, owner, {
      displayName: 'Ali Raza',
      bio: 'Fades & beards',
      specializations: ['Fades'],
      userId: ali.id,
      serviceIds: [cut.body.data.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ userId: ali.id, isActive: true, serviceIds: [cut.body.data.id] });

    const list = await get(`/v1/businesses/${b.slug}/staff`);
    expect(list.body.data).toEqual([
      {
        id: res.body.data.id,
        displayName: 'Ali Raza',
        bio: 'Fades & beards',
        specializations: ['Fades'],
        photoUrl: null,
        serviceIds: [cut.body.data.id],
      },
    ]);
    // The menu shows who performs each service.
    const menu = await get(`/v1/businesses/${b.slug}/services`);
    expect(menu.body.data.categories[0].services[0].staffIds).toEqual([res.body.data.id]);
  });

  it('a brand-new employee (still on their temporary password) can get a profile right away', async () => {
    const { owner, member, base } = await business();
    const ali = await member('staff');
    await db.user.update({ where: { id: ali.id }, data: { mustChangePassword: true } });
    expect((await post(`${base}/staff`, owner, { displayName: 'Ali', userId: ali.id })).status).toBe(201);
  });

  it('only team accounts can be linked, once each; services must be this business’s', async () => {
    const { owner, member, base } = await business();
    const other = await business();
    expect(
      (await post(`${base}/staff`, owner, { displayName: 'X', userId: (await person()).id })).status,
    ).toBe(400);
    const sana = await member('front_desk');
    expect((await post(`${base}/staff`, owner, { displayName: 'Sana', userId: sana.id })).status).toBe(201);
    expect((await post(`${base}/staff`, owner, { displayName: 'Sana again', userId: sana.id })).status).toBe(
      409,
    );
    const theirs = await post(`${other.base}/services`, other.owner, haircut());
    expect(
      (await post(`${base}/staff`, owner, { displayName: 'Y', serviceIds: [theirs.body.data.id] })).status,
    ).toBe(404);
  });

  it('deactivated profiles disappear from the public list but stay for the team', async () => {
    const { owner, b, base } = await business();
    const s = await post(`${base}/staff`, owner, { displayName: 'Temp' });
    expect((await del(`${base}/staff/${s.body.data.id}`, owner)).status).toBe(204);
    expect((await get(`/v1/businesses/${b.slug}/staff`)).body.data).toEqual([]);
    expect((await get(`${base}/staff/manage`, owner)).body.data[0]).toMatchObject({ isActive: false });
  });

  it('when someone leaves the team, their profile is no longer bookable (event), once or twice', async () => {
    const { owner, b, member, base } = await business();
    const ali = await member('staff');
    const s = await post(`${base}/staff`, owner, { displayName: 'Ali', userId: ali.id });
    const handle = bookingEventHandler({ staff: staffService });
    const event = createEvent({
      type: TOPICS.BUSINESSES_MEMBER_REMOVED,
      source: 'auth-service',
      subject: b.id,
      data: { businessId: b.id, userId: ali.id, memberId: randomUUID() },
    });
    const ctx = { topic: event.type, partition: 0, offset: '0', key: null, attempt: 1 };
    await handle(event, ctx);
    await handle(event, ctx);
    const row = await db.staff.findUniqueOrThrow({ where: { id: s.body.data.id } });
    expect([row.isActive, row.userId]).toEqual([false, null]);
  });
});

describe('Working hours, time off and closures', () => {
  async function teamWithEmployee() {
    const t = await business();
    const ali = await t.member('staff');
    const aliProfile = await post(`${t.base}/staff`, t.owner, { displayName: 'Ali', userId: ali.id });
    const other = await post(`${t.base}/staff`, t.owner, { displayName: 'Bilal' });
    return { ...t, ali, aliId: aliProfile.body.data.id as string, otherId: other.body.data.id as string };
  }
  const week = {
    days: [
      {
        dayOfWeek: 1,
        ranges: [
          { start: '14:00', end: '18:00' },
          { start: '09:00', end: '13:00' },
        ],
      },
      { dayOfWeek: 6, ranges: [{ start: '10:00', end: '16:00' }] },
    ],
  };

  it('the owner sets anyone’s weekly hours; ranges come back in order', async () => {
    const { owner, base, otherId } = await teamWithEmployee();
    const res = await put(`${base}/staff/${otherId}/hours`, owner, week);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      {
        dayOfWeek: 1,
        ranges: [
          { start: '09:00', end: '13:00' },
          { start: '14:00', end: '18:00' },
        ],
      },
      { dayOfWeek: 6, ranges: [{ start: '10:00', end: '16:00' }] },
    ]);
    // Replacing the week replaces everything.
    const off = await put(`${base}/staff/${otherId}/hours`, owner, { days: [] });
    expect(off.body.data).toEqual([]);
  });

  it('refuses overlapping or backwards ranges and repeated days', async () => {
    const { owner, base, otherId } = await teamWithEmployee();
    for (const days of [
      [
        {
          dayOfWeek: 1,
          ranges: [
            { start: '09:00', end: '13:00' },
            { start: '12:00', end: '15:00' },
          ],
        },
      ],
      [{ dayOfWeek: 1, ranges: [{ start: '13:00', end: '09:00' }] }],
      [
        { dayOfWeek: 2, ranges: [{ start: '09:00', end: '10:00' }] },
        { dayOfWeek: 2, ranges: [{ start: '11:00', end: '12:00' }] },
      ],
      [{ dayOfWeek: 7, ranges: [{ start: '09:00', end: '10:00' }] }],
      [{ dayOfWeek: 1, ranges: [{ start: '9:00', end: '10:00' }] }],
    ]) {
      expect((await put(`${base}/staff/${otherId}/hours`, owner, { days })).status).toBe(400);
    }
  });

  it('employees manage their OWN hours and time off, not a colleague’s', async () => {
    const { ali, base, aliId, otherId } = await teamWithEmployee();
    expect((await put(`${base}/staff/${aliId}/hours`, ali, week)).status).toBe(200);
    expect((await put(`${base}/staff/${otherId}/hours`, ali, week)).status).toBe(403);
    const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    expect((await post(`${base}/staff/${aliId}/time-off`, ali, { from: tomorrow })).status).toBe(201);
    expect((await post(`${base}/staff/${otherId}/time-off`, ali, { from: tomorrow })).status).toBe(403);
  });

  it('time off: a holiday over several days, part of a day, extra hours; never in the past', async () => {
    const { owner, b, base, aliId } = await teamWithEmployee();
    const today = todayIn(b.timezone);
    const plus = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const path = `${base}/staff/${aliId}/time-off`;
    expect((await post(path, owner, { from: plus(10), to: plus(14), reason: 'Eid holidays' })).status).toBe(
      201,
    );
    expect((await post(path, owner, { from: plus(3), startTime: '13:00', endTime: '15:00' })).status).toBe(
      201,
    );
    expect(
      (await post(path, owner, { kind: 'extra_hours', from: plus(4), startTime: '18:00', endTime: '21:00' }))
        .status,
    ).toBe(201);

    const list = await get(path, owner);
    expect(list.body.data.map((e: { date: string; kind: string }) => [e.date, e.kind])).toEqual([
      [plus(3), 'time_off'],
      [plus(4), 'extra_hours'],
      [plus(10), 'time_off'],
      [plus(11), 'time_off'],
      [plus(12), 'time_off'],
      [plus(13), 'time_off'],
      [plus(14), 'time_off'],
    ]);

    for (const bad of [
      { from: plus(-1) },
      { from: plus(5), to: plus(4) },
      { from: plus(5), to: plus(6), startTime: '10:00', endTime: '11:00' },
      { from: plus(5), startTime: '10:00' },
      { kind: 'extra_hours', from: plus(5) },
      { from: plus(1), to: plus(100) },
    ]) {
      expect((await post(path, owner, bad)).status).toBe(400);
    }

    const first = list.body.data[0].id;
    expect((await del(`${path}/${first}`, owner)).status).toBe(204);
    expect((await del(`${path}/${first}`, owner)).status).toBe(404);
  });

  it('closures apply to the whole business and need the owner or a manager', async () => {
    const { owner, ali, base } = await teamWithEmployee();
    const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    expect((await post(`${base}/closures`, ali, { from: day })).status).toBe(403);
    const res = await post(`${base}/closures`, owner, { from: day, reason: 'Public holiday' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual([
      expect.objectContaining({ date: day, kind: 'time_off', reason: 'Public holiday' }),
    ]);
    expect((await del(`${base}/closures/${res.body.data[0].id}`, owner)).status).toBe(204);
  });

  it('working hours can only point at an employee of the same business (database guarantee)', async () => {
    const a = await teamWithEmployee();
    const other = await business();
    await expect(
      db.availabilityRule.create({
        data: {
          businessId: other.b.id,
          staffId: a.aliId,
          dayOfWeek: 1,
          startTime: '09:00',
          endTime: '10:00',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('Booking settings', () => {
  it('defaults until changed; owner and manager can change them within limits', async () => {
    const { owner, member, b, base } = await business();
    expect((await get(`${base}/booking-settings`, owner)).body.data).toEqual({
      confirmationMode: 'automatic',
      bookingHorizonDays: 365,
      maxFutureBookingsPerCustomer: 3,
      cancellationWindowHours: 12,
      minNoticeMinutes: 60,
      slotStepMinutes: 15,
      noShowGraceMinutes: 15,
    });
    const manager = await member('manager');
    const res = await put(`${base}/booking-settings`, manager, {
      confirmationMode: 'manual',
      bookingHorizonDays: 90,
    });
    expect(res.body.data).toMatchObject({
      confirmationMode: 'manual',
      bookingHorizonDays: 90,
      maxFutureBookingsPerCustomer: 3,
    });
    expect((await get(`/v1/businesses/${b.slug}/services`)).body.data.booking.confirmationMode).toBe(
      'manual',
    );

    for (const bad of [
      { bookingHorizonDays: 0 },
      { slotStepMinutes: 7 },
      { maxFutureBookingsPerCustomer: 50 },
      {},
    ]) {
      expect((await put(`${base}/booking-settings`, owner, bad)).status).toBe(400);
    }
    expect(
      (await put(`${base}/booking-settings`, await member('staff'), { bookingHorizonDays: 30 })).status,
    ).toBe(403);
  });
});

describe('Plans: business limits (billing on)', () => {
  it('Starter: 10 services; archiving frees a place; bringing one back counts again', async () => {
    await withBilling(db, 'business', async () => {
      const { owner, b, base } = await business();
      const ids: string[] = [];
      for (let i = 0; i < 10; i++)
        ids.push((await post(`${base}/services`, owner, haircut({ name: `S${i}` }))).body.data.id);
      const over = await post(`${base}/services`, owner, haircut({ name: 'Eleventh' }));
      expect([over.status, over.body.error.code, over.body.error.details]).toEqual([
        409,
        'PLAN_LIMIT_REACHED',
        { limit: 'services', max: 10, used: 10, plan: 'business_free' },
      ]);
      await del(`${base}/services/${ids[0]}`, owner);
      expect((await post(`${base}/services`, owner, haircut({ name: 'Replacement' }))).status).toBe(201);
      const back = await request(app)
        .patch(`${base}/services/${ids[0]}`)
        .set(owner.auth)
        .send({ isActive: true });
      expect(back.status).toBe(409);

      await givePlan(db, { businessId: b.id }, 'business_essential');
      expect(
        (await request(app).patch(`${base}/services/${ids[0]}`).set(owner.auth).send({ isActive: true }))
          .status,
      ).toBe(200);
    });
  });

  it('Starter: 2 bookable staff; manual approval is a paid feature', async () => {
    await withBilling(db, 'business', async () => {
      const { owner, b, base } = await business();
      await post(`${base}/staff`, owner, { displayName: 'One' });
      await post(`${base}/staff`, owner, { displayName: 'Two' });
      expect((await post(`${base}/staff`, owner, { displayName: 'Three' })).body.error.details).toMatchObject(
        { limit: 'staff_profiles', max: 2 },
      );

      const manual = await put(`${base}/booking-settings`, owner, { confirmationMode: 'manual' });
      expect([manual.status, manual.body.error.code, manual.body.error.details]).toEqual([
        403,
        'PLAN_FEATURE_UNAVAILABLE',
        { feature: 'manual_approval', plan: 'business_free' },
      ]);
      // Other settings are always allowed.
      expect((await put(`${base}/booking-settings`, owner, { bookingHorizonDays: 60 })).status).toBe(200);

      await givePlan(db, { businessId: b.id }, 'business_essential');
      expect((await put(`${base}/booking-settings`, owner, { confirmationMode: 'manual' })).status).toBe(200);
      expect((await post(`${base}/staff`, owner, { displayName: 'Three' })).status).toBe(201);
    });
  });
});
