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
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { givePlan, withBilling } from '../../../packages/billing/test/helpers.js';
import { buildQueueApp } from '../src/app.js';

/** The virtual queue against the real database (incl. PostGIS distances and the one-ticket rule). */

let app: Express;
let db: Database;
let redis: Redis;
let subscriber: Redis;
let signer: JwtSigner;

// A shop in Gulberg, Lahore; a customer 1.3 km away; someone in Karachi.
const SHOP = { lat: 31.5204, lng: 74.3587 };
const NEAR = { lat: 31.531, lng: 74.364 };
const KARACHI = { lat: 24.8607, lng: 67.0011 };

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
type Person = Awaited<ReturnType<typeof person>>;

async function person(role: Role = 'user', name = `Customer ${randomUUID().slice(0, 6)}`) {
  const user = await db.user.create({ data: { name, emailHash: randomBytes(32).toString('hex'), role } });
  const { token } = await signer.sign({ sub: user.id, role, sid: randomUUID() });
  return { id: user.id, name, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

async function shop(opts: { settings?: Record<string, unknown>; location?: boolean; open?: boolean } = {}) {
  const owner = await person();
  const suffix = randomUUID().slice(-12);
  const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const b = await db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Passport Office ${suffix}`,
      slug: `passport-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      ...(opts.location !== false && SHOP),
    },
  });
  if (opts.settings) await db.queueSettings.create({ data: { businessId: b.id, ...opts.settings } });
  const base = `/v1/businesses/${b.id}/queue`;
  if (opts.open !== false) expect((await request(app).post(`${base}/open`).set(owner.auth)).status).toBe(200);
  const member = async (role: 'manager' | 'front_desk' | 'staff') => {
    const p = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: p.id, role } });
    return p;
  };
  return { owner, b, base, member };
}
type Shop = Awaited<ReturnType<typeof shop>>;

const join = (who: Person, s: Shop, where = NEAR) =>
  request(app)
    .post('/v1/queue/join')
    .set(who.auth)
    .send({ businessId: s.b.id, ...where });
const desk = (s: Shop, path: string, body: object = {}) =>
  request(app).post(`${s.base}${path}`).set(s.owner.auth).send(body);
const events = (entryId: string) =>
  db.outboxEvent.findMany({ where: { aggregateId: entryId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'queue-int-test', maxConnections: 10 });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'queue-int-test' });
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
  subscriber = createRedisClient({ url: testEnv.redisUrl, connectionName: 'queue-int-test-live' });
  ({ app } = buildQueueApp({
    db,
    redis,
    subscriber,
    verifier,
    revocations: createRevocationStore(redis),
    http: {
      service: 'queue-test',
      logger: createLogger({ service: 'queue-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
  await subscriber.quit();
});

describe('Joining', () => {
  it('a nearby customer gets a ticket (A-001), with position and estimated wait', async () => {
    const s = await shop();
    const first = await join(await person(), s);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      ticket: 'A-001',
      qr: 'A-001',
      status: 'waiting',
      ahead: 0,
      estimatedWaitMinutes: 0,
    });
    const second = await join(await person(), s);
    expect(second.body.data).toMatchObject({ ticket: 'A-002', ahead: 1, estimatedWaitMinutes: 5 });

    const pub = await request(app).get(`/v1/queue/public/${s.b.slug}`);
    expect(pub.body.data).toMatchObject({
      status: 'open',
      waiting: 2,
      called: [],
      serving: [],
      estimatedWaitMinutes: 10,
    });
    expect(JSON.stringify(pub.body.data)).not.toMatch(/Customer/);
  });

  it('only within the business’s distance (default 5 km), and only where the business has a location', async () => {
    const s = await shop();
    const far = await join(await person(), s, KARACHI);
    expect(far.status).toBe(422);
    expect(far.body.error).toMatchObject({ code: 'QUEUE_TOO_FAR', details: { maxMeters: 5000 } });
    expect(far.body.error.details.distanceMeters).toBeGreaterThan(900_000);

    const noLocation = await shop({ location: false });
    expect((await join(await person(), noLocation)).body.error.code).toBe('QUEUE_TOO_FAR');
  });

  it('one live ticket per customer, in any queue — even when both joins are sent at once', async () => {
    const [a, b] = [await shop(), await shop()];
    const me = await person();
    const results = await Promise.all([join(me, a), join(me, b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('QUEUE_ALREADY_JOINED');

    const mine = await request(app).get('/v1/queue/my-ticket').set(me.auth);
    const left = await request(app).post(`/v1/queue/tickets/${mine.body.data.id}/leave`).set(me.auth);
    expect(left.body.data.status).toBe('left');
    const other = mine.body.data.business.id === a.b.id ? b : a;
    expect((await join(me, other)).status).toBe(201);
  });

  it('ten people joining at once get ten different tickets', async () => {
    const s = await shop();
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const results = await Promise.all(people.map((p) => join(p, s)));
    const tickets = results.map((r) => r.body.data.ticket as string).sort();
    expect(tickets).toEqual(Array.from({ length: 10 }, (_, i) => `A-${String(i + 1).padStart(3, '0')}`));
  });

  it('refuses a closed, paused or full queue; walk-ins are still possible while paused', async () => {
    const closed = await shop({ open: false });
    expect((await join(await person(), closed)).body.error.code).toBe('QUEUE_CLOSED');

    const s = await shop({ settings: { maxQueueSize: 2 } });
    await desk(s, '/pause');
    expect((await join(await person(), s)).body.error.code).toBe('QUEUE_PAUSED');
    expect((await desk(s, '/walk-ins', { name: 'Uncle Rashid', priority: true })).status).toBe(201);
    await desk(s, '/resume');
    expect((await join(await person(), s)).status).toBe(201);
    expect((await join(await person(), s)).body.error.code).toBe('QUEUE_FULL');
  });

  it('employee accounts can’t join; a ticket is only visible to its owner', async () => {
    const s = await shop();
    expect((await join(await person('staff'), s)).status).toBe(403);
    const me = await person();
    const t = await join(me, s);
    expect(
      (
        await request(app)
          .get(`/v1/queue/tickets/${t.body.data.id}`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
    expect((await request(app).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth)).status).toBe(200);
  });
});

describe('Serving the line', () => {
  it('calls the priority lane first, then by ticket; serve and complete update the day’s average', async () => {
    const s = await shop();
    const [a, b] = [await join(await person(), s), await join(await person(), s)];
    const elder = await desk(s, '/walk-ins', { name: 'Elder', priority: true });

    const first = await desk(s, '/call-next');
    expect(first.body.data).toMatchObject({
      id: elder.body.data.id,
      status: 'called',
      comeBy: expect.any(String),
    });
    expect((await desk(s, '/call-next')).body.data.id).toBe(a.body.data.id);

    expect((await desk(s, `/entries/${a.body.data.id}/serve`)).body.data.status).toBe('serving');
    const done = await desk(s, `/entries/${a.body.data.id}/complete`);
    expect(done.body.data.status).toBe('completed');
    const board = await request(app).get(s.base).set(s.owner.auth);
    expect(board.body.data.session).toMatchObject({ totalServed: 1, lastCalled: a.body.data.ticket });
    expect(board.body.data.called.map((e: { name: string }) => e.name)).toEqual(['Elder']);
    expect(board.body.data.waiting.map((e: { ticket: string }) => e.ticket)).toEqual([b.body.data.ticket]);
    expect((await events(a.body.data.id)).map((e) => e.topic)).toEqual([
      'queue.entry.joined',
      'queue.position.updated',
      'queue.entry.called',
      'queue.entry.served',
      'queue.entry.completed',
    ]);
  });

  it('a no-show only after the grace period (default 5 minutes)', async () => {
    const s = await shop();
    const t = await join(await person(), s);
    await desk(s, '/call-next');
    const early = await desk(s, `/entries/${t.body.data.id}/no-show`);
    expect([early.status, early.body.error.message]).toEqual([
      409,
      expect.stringContaining('5 minutes after calling'),
    ]);

    const quick = await shop({ settings: { gracePeriodSeconds: 0 } });
    const u = await join(await person(), quick);
    await desk(quick, '/call-next');
    expect((await desk(quick, `/entries/${u.body.data.id}/no-show`)).body.data.status).toBe('no_show');
  });

  it('alerts at 10 ahead, 5 ahead, then every step — as people are actually called', async () => {
    const s = await shop();
    const people = await Promise.all(Array.from({ length: 12 }, () => person()));
    const tickets = [];
    for (const p of people) tickets.push((await join(p, s)).body.data.id as string);
    const last = tickets.at(-1)!; // 11 ahead: no alert yet
    const alertsFor = async (id: string) =>
      (await events(id))
        .filter((e) => e.topic === 'queue.position.updated')
        .map((e) => (e.payload as { data: { ahead: number } }).data.ahead);
    expect(await alertsFor(last)).toEqual([]);
    for (let i = 0; i < 11; i++) await desk(s, '/call-next');
    expect(await alertsFor(last)).toEqual([10, 5, 4, 3, 2, 1, 0]);
    // Events carry the ticket and ids, never names.
    expect(JSON.stringify(await events(last))).not.toContain(people.at(-1)!.name);
  });

  it('closing the queue tells everyone still waiting', async () => {
    const s = await shop();
    const me = await person();
    const t = await join(me, s);
    await desk(s, '/close');
    const mine = await request(app).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth);
    expect(mine.body.data.status).toBe('left');
    const left = (await events(t.body.data.id)).find((e) => e.topic === 'queue.entry.left');
    expect((left!.payload as { data: { reason: string } }).data.reason).toBe('queue_closed');
    expect((await join(await person(), s)).body.error.code).toBe('QUEUE_CLOSED');
  });
});

describe('Front desk access and settings', () => {
  it('owner, manager and front desk operate; staff only watch; outsiders get 404; names only', async () => {
    const s = await shop();
    await join(await person('user', 'Ayesha Khan'), s);
    const staff = await s.member('staff');
    expect((await request(app).post(`${s.base}/call-next`).set(staff.auth)).status).toBe(403);
    const board = await request(app).get(s.base).set(staff.auth);
    expect(board.body.data.waiting[0]).toMatchObject({
      name: 'Ayesha Khan',
      walkIn: false,
      joinedRemotely: true,
    });
    expect(JSON.stringify(board.body.data)).not.toMatch(/email|phone|avatar/i);
    expect(
      (
        await request(app)
          .post(`${s.base}/call-next`)
          .set((await s.member('front_desk')).auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .get(s.base)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
  });

  it('settings: defaults, owner/manager changes within limits, applied from the next opening', async () => {
    const s = await shop({ open: false });
    const get = await request(app).get(`${s.base}/settings`).set(s.owner.auth);
    expect(get.body.data).toEqual({
      remoteJoinRadiusMeters: 5000,
      maxQueueSize: 200,
      gracePeriodSeconds: 300,
      ticketPrefix: 'A',
      avgServiceSeconds: 300,
    });
    const put = await request(app)
      .put(`${s.base}/settings`)
      .set(s.owner.auth)
      .send({ ticketPrefix: 'p', remoteJoinRadiusMeters: 2000 });
    expect(put.body.data).toMatchObject({ ticketPrefix: 'P', remoteJoinRadiusMeters: 2000 });
    for (const bad of [{ ticketPrefix: 'A1' }, { remoteJoinRadiusMeters: 10 }, {}]) {
      expect((await request(app).put(`${s.base}/settings`).set(s.owner.auth).send(bad)).status).toBe(400);
    }
    expect(
      (
        await request(app)
          .put(`${s.base}/settings`)
          .set((await s.member('front_desk')).auth)
          .send({ maxQueueSize: 5 })
      ).status,
    ).toBe(403);
    await desk(s, '/open');
    expect((await join(await person(), s)).body.data.ticket).toBe('P-001');
  });
});

describe('Plans (billing on)', () => {
  it('the virtual queue needs a plan that includes it (Starter doesn’t)', async () => {
    await withBilling(db, 'business', async () => {
      const s = await shop({ open: false });
      const refused = await desk(s, '/open');
      expect([refused.status, refused.body.error.code]).toEqual([403, 'PLAN_FEATURE_UNAVAILABLE']);
      await givePlan(db, { businessId: s.b.id }, 'business_essential');
      expect((await desk(s, '/open')).status).toBe(200);
    });
  });

  it('a queue join is a visit: Free customers get one; leaving before being served gives it back', async () => {
    await withBilling(db, 'user', async () => {
      const s = await shop();
      const me = await person();
      const first = await join(me, s);
      expect(
        (await request(app).post(`/v1/queue/tickets/${first.body.data.id}/leave`).set(me.auth)).status,
      ).toBe(200);
      const second = await join(me, s);
      expect(second.status).toBe(201);
      await desk(s, '/call-next');
      await desk(s, `/entries/${second.body.data.id}/serve`);
      await desk(s, `/entries/${second.body.data.id}/complete`);
      const third = await join(me, s);
      expect([third.status, third.body.error.code]).toEqual([409, 'PLAN_LIMIT_REACHED']);
      await givePlan(db, { userId: me.id }, 'user_plus');
      expect((await join(me, s)).status).toBe(201);
    });
  });
});
