import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import express, { type Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withBilling } from '../../../packages/billing/test/helpers.js';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildBillingApp } from '../src/app.js';
import { PaddleClient, type PaddleSubscription } from '../src/paddle/client.js';
import { signPaddleBody } from '../src/paddle/signature.js';

/**
 * Paying with Paddle, end to end, against a FAKE Paddle API (an HTTP server
 * in this test that answers like Paddle and checks the API key) and signed
 * webhooks exactly as Paddle sends them.
 */

const API_KEY = 'pdl_sdbx_apikey_test';
const SECRET = 'pdl_ntfset_secret_test';
let app: Express;
let db: Database;
let redis: Redis;
let signer: JwtSigner;
let admin: Person;
let fake: ReturnType<typeof fakePaddle>;
let fakeServer: Server;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const pid = (prefix: string) => `${prefix}_${randomBytes(13).toString('hex')}`;
type Person = Awaited<ReturnType<typeof person>>;

/** What Paddle would do, in memory. */
function fakePaddle() {
  const calls: { method: string; path: string; body: Record<string, unknown> }[] = [];
  const subscriptions = new Map<string, PaddleSubscription>();
  const transactions = new Map<string, { custom_data: Record<string, string>; price_id: string }>();
  let down = false;
  const api = express();
  api.use(express.json());
  api.use((req, res, next) => {
    calls.push({ method: req.method, path: req.path, body: req.body as Record<string, unknown> });
    if (down) return void res.status(500).json({ error: { code: 'internal_error' } });
    if (req.get('authorization') !== `Bearer ${API_KEY}`)
      return void res.status(401).json({ error: { code: 'authentication_malformed' } });
    next();
  });
  api.post('/products', (_req, res) => void res.status(201).json({ data: { id: pid('pro') } }));
  api.post('/prices', (_req, res) => void res.status(201).json({ data: { id: pid('pri') } }));
  api.post('/transactions', (req, res) => {
    const id = pid('txn');
    const body = req.body as { items: { price_id: string }[]; custom_data: Record<string, string> };
    transactions.set(id, { custom_data: body.custom_data, price_id: body.items[0]!.price_id });
    res.status(201).json({ data: { id, checkout: { url: `https://pay.example/?_ptxn=${id}` } } });
  });
  const touch = (s: PaddleSubscription) => ({ ...s, updated_at: new Date(Date.now() + 1000).toISOString() });
  api.post('/subscriptions/:id/cancel', (req, res) => {
    const s = subscriptions.get(req.params.id)!;
    const now = (req.body as { effective_from: string }).effective_from === 'immediately';
    const next = touch(
      now
        ? {
            ...s,
            status: 'canceled',
            canceled_at: new Date().toISOString(),
            current_billing_period: null,
            scheduled_change: null,
          }
        : { ...s, scheduled_change: { action: 'cancel', effective_at: s.current_billing_period!.ends_at } },
    );
    subscriptions.set(s.id, next);
    res.json({ data: next });
  });
  api.patch('/subscriptions/:id', (req, res) => {
    const s = subscriptions.get(req.params.id)!;
    const body = req.body as { items?: { price_id: string }[]; scheduled_change?: null };
    const next = touch({
      ...s,
      ...(body.scheduled_change === null && { scheduled_change: null }),
      ...(body.items && { items: [{ price: { id: body.items[0]!.price_id }, quantity: 1 }] }),
    });
    subscriptions.set(s.id, next);
    res.json({ data: next });
  });
  api.post('/customers/:id/portal-sessions', (req, res) => {
    const ids = (req.body as { subscription_ids: string[] }).subscription_ids;
    res.status(201).json({
      data: {
        urls: {
          general: { overview: `https://portal.example/${req.params.id}` },
          subscriptions: ids.map((id) => ({
            id,
            update_subscription_payment_method: `https://portal.example/${id}/card`,
            cancel_subscription: `https://portal.example/${id}/cancel`,
          })),
        },
      },
    });
  });
  return {
    api,
    calls,
    subscriptions,
    setDown: (v: boolean) => (down = v),
    /** The customer paid: Paddle creates the subscription from the transaction. */
    pay(transactionId: string): PaddleSubscription {
      const t = transactions.get(transactionId)!;
      const start = new Date();
      const sub: PaddleSubscription = {
        id: pid('sub'),
        status: 'active',
        customer_id: pid('ctm'),
        items: [{ price: { id: t.price_id }, quantity: 1 }],
        current_billing_period: {
          starts_at: start.toISOString(),
          ends_at: new Date(start.getTime() + 30 * 86_400_000).toISOString(),
        },
        scheduled_change: null,
        custom_data: t.custom_data,
        canceled_at: null,
        updated_at: start.toISOString(),
      };
      subscriptions.set(sub.id, sub);
      return sub;
    },
  };
}

/** Deliver a webhook as Paddle does: signed raw body. */
function deliver(
  eventType: string,
  data: unknown,
  opts: { eventId?: string; secret?: string; ts?: number } = {},
) {
  const body = JSON.stringify({
    event_id: opts.eventId ?? pid('evt'),
    event_type: eventType,
    occurred_at: new Date().toISOString(),
    notification_id: pid('ntf'),
    data,
  });
  return request(app)
    .post('/v1/billing/webhooks/paddle')
    .set('Content-Type', 'application/json')
    .set('Paddle-Signature', signPaddleBody(body, opts.secret ?? SECRET, opts.ts))
    .send(body);
}

async function person(role: Role = 'user') {
  const user = await db.user.create({
    data: { name: `P ${randomUUID().slice(0, 6)}`, emailHash: randomBytes(32).toString('hex'), role },
  });
  const { token } = await signer.sign({ sub: user.id, role, sid: randomUUID() });
  return { id: user.id, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

async function business(owner: Person) {
  const suffix = randomUUID().slice(-12);
  const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  return db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Clinic ${suffix}`,
      slug: `clinic-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    },
  });
}

const post = (path: string, who: Person, body: object = {}) =>
  request(app).post(path).set(who.auth).send(body);
const get = (path: string, who: Person) => request(app).get(path).set(who.auth);

/** Sync a plan's web price to (fake) Paddle. */
async function sync(code: string) {
  const plan = await db.plan.findUniqueOrThrow({
    where: { code },
    include: { prices: { where: { channel: 'web', archivedAt: null } } },
  });
  const res = await post(`/v1/admin/billing/prices/${plan.prices[0]!.id}/sync-paddle`, admin);
  expect(res.status).toBe(200);
  return res.body.data as { externalPriceId: string; created: boolean };
}

beforeAll(async () => {
  fake = fakePaddle();
  fakeServer = fake.api.listen(0);
  await new Promise((r) => fakeServer.once('listening', r));
  db = createDatabaseClient({
    url: testEnv.appUrl,
    applicationName: 'billing-paddle-test',
    maxConnections: 5,
  });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'billing-paddle-test' });
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
  ({ app } = buildBillingApp({
    db,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    paddle: {
      client: new PaddleClient({
        apiUrl: `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`,
        apiKey: API_KEY,
        timeoutMs: 2000,
      }),
      config: {
        environment: 'sandbox',
        clientToken: 'test_client_token',
        webhookSecret: SECRET,
        webhookToleranceSeconds: 300,
        taxCategory: 'standard',
      },
    },
    http: {
      service: 'billing-paddle-test',
      logger: createLogger({ service: 'billing-paddle-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
  admin = await person('super_admin');
});

afterAll(async () => {
  await new Promise((r) => fakeServer.close(r));
  await db.$disconnect();
  await redis.quit();
});

describe('Linking prices to Paddle', () => {
  it('creates the product and the price there once; the price id is stored', async () => {
    const first = await sync('business_essential');
    expect(first).toMatchObject({ created: true, externalPriceId: expect.stringMatching(/^pri_/) });
    const priceCall = fake.calls.find((c) => c.path === '/prices')!;
    expect(priceCall.body).toMatchObject({
      unit_price: { amount: '2499', currency_code: 'USD' },
      billing_cycle: { interval: 'month', frequency: 1 },
      tax_mode: 'external',
    });
    expect((await sync('business_essential')).created).toBe(false);
    expect(
      (await db.plan.findUniqueOrThrow({ where: { code: 'business_essential' } })).externalProductId,
    ).toMatch(/^pro_/);
  });
});

describe('A business pays for Essential', () => {
  it('checkout → Paddle webhook → the business is on Essential; its trial is replaced', async () => {
    await withBilling(db, 'business', async () => {
      const owner = await person();
      const b = await business(owner);
      await post(`/v1/businesses/${b.id}/billing/trial`, owner);

      const manager = await person();
      await db.businessMember.create({ data: { businessId: b.id, userId: manager.id, role: 'manager' } });
      expect(
        (await post(`/v1/businesses/${b.id}/billing/checkout`, manager, { planCode: 'business_essential' }))
          .status,
      ).toBe(403);

      const checkout = await post(`/v1/businesses/${b.id}/billing/checkout`, owner, {
        planCode: 'business_essential',
      });
      expect(checkout.status).toBe(201);
      expect(checkout.body.data).toMatchObject({
        transactionId: expect.stringMatching(/^txn_/),
        clientToken: 'test_client_token',
        environment: 'sandbox',
        price: { amount: '24.99', currency: 'USD' },
      });
      const txCall = fake.calls.filter((c) => c.path === '/transactions').at(-1)!;
      expect(txCall.body.custom_data).toEqual({
        buku_account_type: 'business',
        buku_account_id: b.id,
        buku_plan: 'business_essential',
      });

      const sub = fake.pay(checkout.body.data.transactionId);
      expect((await deliver('subscription.created', sub)).status).toBe(200);
      const billing = (await get(`/v1/businesses/${b.id}/billing`, owner)).body.data;
      expect(billing).toMatchObject({
        plan: { code: 'business_essential' },
        source: 'subscription',
        subscription: { provider: 'paddle', channel: 'web' },
      });
      const trial = await db.subscription.findFirstOrThrow({
        where: { businessId: b.id, provider: 'trial' },
      });
      expect(trial.status).toBe('cancelled');
      expect(
        (await post(`/v1/businesses/${b.id}/billing/checkout`, owner, { planCode: 'business_essential' }))
          .status,
      ).toBe(409);
    });
  });

  it('cancel at period end, undo it, switch to Professional (prorated), card portal, then Paddle ends it', async () => {
    await withBilling(db, 'business', async () => {
      const owner = await person();
      const b = await business(owner);
      const checkout = await post(`/v1/businesses/${b.id}/billing/checkout`, owner, {
        planCode: 'business_essential',
      });
      const sub = fake.pay(checkout.body.data.transactionId);
      await deliver('subscription.created', sub);
      const base = `/v1/businesses/${b.id}/billing/subscription`;

      const cancelled = await post(`${base}/cancel`, owner);
      expect(cancelled.body.data).toMatchObject({
        plan: { code: 'business_essential' },
        status: 'active',
        cancelAtPeriodEnd: true,
      });
      expect((await post(`${base}/undo-cancel`, owner)).body.data.cancelAtPeriodEnd).toBe(false);

      expect((await post(`${base}/change`, owner, { planCode: 'business_professional' })).status).toBe(409); // not linked yet
      await sync('business_professional');
      const changed = await post(`${base}/change`, owner, { planCode: 'business_professional' });
      expect(changed.body.data.plan.code).toBe('business_professional');
      expect(fake.calls.filter((c) => c.method === 'PATCH').at(-1)!.body).toMatchObject({
        proration_billing_mode: 'prorated_immediately',
      });

      const portal = await get(`${base}/portal`, owner);
      expect(portal.body.data.updatePaymentMethod).toBe(`https://portal.example/${sub.id}/card`);

      const ended = {
        ...fake.subscriptions.get(sub.id)!,
        status: 'canceled' as const,
        canceled_at: new Date().toISOString(),
        current_billing_period: null,
        updated_at: new Date(Date.now() + 5000).toISOString(),
      };
      await deliver('subscription.canceled', ended);
      expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data).toMatchObject({
        plan: { code: 'business_free' },
        source: 'default',
      });
    });
  });
});

describe('Admins', () => {
  it('end a paid subscription immediately (in Paddle), which takes the plan away at once', async () => {
    await withBilling(db, 'business', async () => {
      const owner = await person();
      const b = await business(owner);
      const checkout = await post(`/v1/businesses/${b.id}/billing/checkout`, owner, {
        planCode: 'business_essential',
      });
      await deliver('subscription.created', fake.pay(checkout.body.data.transactionId));
      const sub = await db.subscription.findFirstOrThrow({ where: { businessId: b.id, provider: 'paddle' } });
      const ended = await post(`/v1/admin/billing/subscriptions/${sub.id}/end`, admin, {
        reason: 'Chargeback',
      });
      expect(ended.body.data).toMatchObject({ status: 'cancelled' });
      expect(fake.calls.filter((c) => c.path.endsWith('/cancel')).at(-1)!.body).toEqual({
        effective_from: 'immediately',
      });
      expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data.source).toBe('default');
    });
  });
});

describe('Webhooks are verified, processed once, and in order', () => {
  async function paidUser() {
    await sync('user_plus');
    const me = await person();
    const checkout = await post('/v1/billing/checkout', me, { planCode: 'user_plus' });
    expect(checkout.status).toBe(201);
    return { me, sub: fake.pay(checkout.body.data.transactionId) };
  }

  it('refuses bad signatures, wrong secrets and old deliveries; duplicates are processed once', async () => {
    await withBilling(db, 'user', async () => {
      const { me, sub } = await paidUser();
      expect((await deliver('subscription.created', sub, { secret: 'not-the-secret' })).status).toBe(401);
      expect(
        (await deliver('subscription.created', sub, { ts: Math.floor(Date.now() / 1000) - 3600 })).status,
      ).toBe(401);
      const unsigned = await request(app)
        .post('/v1/billing/webhooks/paddle')
        .set('Content-Type', 'application/json')
        .send(JSON.stringify({ event_id: 'evt_x', event_type: 'subscription.created', data: sub }));
      expect(unsigned.status).toBe(401);
      expect(await db.subscription.count({ where: { userId: me.id } })).toBe(0);

      const eventId = pid('evt');
      expect((await deliver('subscription.created', sub, { eventId })).body.data).toEqual({
        processed: true,
      });
      expect((await deliver('subscription.created', sub, { eventId })).body.data).toEqual({
        processed: false,
      });
      expect(await db.subscription.count({ where: { userId: me.id } })).toBe(1);
      expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
        plan: { code: 'user_plus' },
        source: 'subscription',
      });
    });
  });

  it('an older update arriving late is ignored', async () => {
    await withBilling(db, 'user', async () => {
      const { me, sub } = await paidUser();
      await deliver('subscription.created', sub);
      const newer = {
        ...sub,
        status: 'active' as const,
        updated_at: new Date(Date.now() + 60_000).toISOString(),
      };
      const older = {
        ...sub,
        status: 'past_due' as const,
        updated_at: new Date(Date.now() + 30_000).toISOString(),
      };
      await deliver('subscription.updated', newer);
      await deliver('subscription.past_due', older);
      expect((await db.subscription.findFirstOrThrow({ where: { userId: me.id } })).status).toBe('active');
    });
  });

  it('events BUKU can’t use are acknowledged (so Paddle stops retrying) and change nothing', async () => {
    await withBilling(db, 'user', async () => {
      const { me, sub } = await paidUser();
      const before = await db.subscription.count();
      const unknownPrice = { ...sub, id: pid('sub'), items: [{ price: { id: pid('pri') }, quantity: 1 }] };
      const noAccount = { ...sub, id: pid('sub'), custom_data: null };
      const strangers = {
        ...sub,
        id: pid('sub'),
        custom_data: { buku_account_type: 'user', buku_account_id: randomUUID() },
      };
      for (const s of [unknownPrice, noAccount, strangers])
        expect((await deliver('subscription.created', s)).status).toBe(200);
      expect((await deliver('transaction.completed', { id: pid('txn') })).status).toBe(200);
      expect(await db.subscription.count()).toBe(before);
      expect((await get('/v1/billing/me', me)).body.data.source).not.toBe('subscription');
    });
  });
});

describe('When Paddle isn’t there', () => {
  it('a Paddle outage gives a clear 502, and nothing is recorded', async () => {
    await withBilling(db, 'user', async () => {
      await sync('user_plus');
      const me = await person();
      fake.setDown(true);
      try {
        const res = await post('/v1/billing/checkout', me, { planCode: 'user_plus' });
        expect([res.status, res.body.error.code]).toEqual([502, 'SERVICE_UNAVAILABLE']);
      } finally {
        fake.setDown(false);
      }
    });
  });

  it('without Paddle configured, checkout says online payments aren’t set up', async () => {
    const { buildBillingApp: build } = await import('../src/app.js');
    const { app: plain } = build({
      db,
      redis,
      verifier: await createJwtVerifier({
        issuer: 'https://auth.test',
        audience: 'buku-api',
        keys: [
          {
            keyId: 'k1',
            publicKeyPem: generateKeyPairSync('rsa', { modulusLength: 2048 })
              .publicKey.export({ type: 'spki', format: 'pem' })
              .toString(),
          },
        ],
      }),
      revocations: createRevocationStore(redis),
      paddle: null,
      http: {
        service: 'x',
        logger: createLogger({ service: 'x', level: 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    });
    const res = await request(plain)
      .post('/v1/billing/webhooks/paddle')
      .set('Content-Type', 'application/json')
      .send('{}');
    expect([res.status, res.body.error.code]).toEqual([503, 'FEATURE_DISABLED']);
  });
});
