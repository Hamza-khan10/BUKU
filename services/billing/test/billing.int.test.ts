import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { entitlementsOf } from '@buku/billing';
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
import { buildBillingApp } from '../src/app.js';

/**
 * Billing catalog, switches and entitlements against the real database, with
 * the starting catalog from the migration. Settings changed here are put
 * back afterwards (billing starts switched off).
 */

let app: Express;
let db: Database;
let redis: Redis;
let signer: JwtSigner;
let admin: Person;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
type Person = Awaited<ReturnType<typeof person>>;

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
      name: `Shop ${suffix}`,
      slug: `shop-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    },
  });
}

const get = (path: string, who?: Person) =>
  who ? request(app).get(path).set(who.auth) : request(app).get(path);
const send = (method: 'post' | 'put' | 'patch' | 'delete', path: string, who: Person, body: object = {}) =>
  request(app)[method](path).set(who.auth).send(body);
const setBilling = (audience: 'user' | 'business', enabled: boolean) =>
  send('put', `/v1/admin/billing/settings/${audience}`, admin, { enabled });

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'billing-int-test', maxConnections: 5 });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'billing-int-test' });
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
    paddle: null,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    http: {
      service: 'billing-test',
      logger: createLogger({ service: 'billing-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
  admin = await person('super_admin');
});

afterAll(async () => {
  // Leave billing as the migration starts it: switched off for everyone.
  await setBilling('user', false);
  await setBilling('business', false);
  for (const [audience, plan] of [
    ['user', 'user_plus'],
    ['business', 'business_professional'],
  ] as const) {
    await send('put', `/v1/admin/billing/settings/${audience}`, admin, {
      trialEnabled: true,
      trialDays: 30,
      trialPlanCode: plan,
    });
  }
  await db.$disconnect();
  await redis.quit();
});

describe('The pricing page', () => {
  it('users: Free and BUKU Plus — $1.99 on the web and Android, $4.99 on iPhone', async () => {
    const web = await get('/v1/billing/plans?audience=user&channel=web');
    expect(web.status).toBe(200);
    expect(
      web.body.data.plans.map((p: { code: string; prices: { amount: string }[]; free: boolean }) => [
        p.code,
        p.prices.map((x) => x.amount),
        p.free,
      ]),
    ).toEqual([
      ['user_free', [], true],
      ['user_plus', ['1.99'], false],
    ]);
    expect(web.body.data.plans[1]).toMatchObject({
      limits: { visits: null },
      benefits: expect.arrayContaining(['Unlimited bookings']),
    });
    expect(web.body.data.plans[0].limits).toEqual({ visits: 1 });
    expect(web.body.data.billingEnabled).toBe(false);
    expect(
      (await get('/v1/billing/plans?audience=user&channel=android')).body.data.plans[1].prices[0].amount,
    ).toBe('1.99');
    expect(
      (await get('/v1/billing/plans?audience=user&channel=ios')).body.data.plans[1].prices[0].amount,
    ).toBe('4.99');
  });

  it('businesses: Essential, Professional and Enterprise with their limits and features to compare', async () => {
    const res = await get('/v1/billing/plans?audience=business');
    const plans = res.body.data.plans as {
      code: string;
      prices: { amount: string }[];
      limits: Record<string, number | null>;
      features: Record<string, boolean>;
    }[];
    expect(plans.map((p) => [p.code, p.prices[0]?.amount])).toEqual([
      ['business_essential', '24.99'],
      ['business_professional', '49.99'],
      ['business_enterprise', '99.99'],
    ]);
    expect(plans.map((p) => p.limits.team_accounts)).toEqual([3, 15, null]);
    expect(plans.map((p) => p.features.ads)).toEqual([false, false, true]);
    expect(res.body.data.comparison.limits.map((l: { label: string }) => l.label)).toEqual([
      'Team logins',
      'Bookable staff',
      'Services',
      'Photos',
    ]);
    expect(JSON.stringify(res.body.data)).not.toMatch(/unlimited \(billing off\)/i);
  });
});

describe('Changing prices and plans at any time', () => {
  it('a new price replaces the old one for new customers; existing subscribers keep theirs', async () => {
    const plans = (await get('/v1/admin/billing/plans', admin)).body.data as {
      code: string;
      prices: { id: string; channel: string; active: boolean }[];
    }[];
    const oldWeb = plans
      .find((p) => p.code === 'user_plus')!
      .prices.find((p) => p.channel === 'web' && p.active)!;
    const subscriber = await person();
    const plusId = (await db.plan.findUniqueOrThrow({ where: { code: 'user_plus' } })).id;
    await db.subscription.create({
      data: {
        planId: plusId,
        priceId: oldWeb.id,
        userId: subscriber.id,
        provider: 'paddle',
        channel: 'web',
        status: 'active',
        externalSubscriptionId: `sub_${randomUUID()}`,
      },
    });

    const res = await send('post', '/v1/admin/billing/plans/user_plus/prices', admin, {
      channel: 'web',
      amount: 2.49,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      price: { amount: '2.49', active: true },
      replaced: { id: oldWeb.id, active: false },
      subscribersOnPreviousPrice: 1,
    });
    expect(
      (await get('/v1/billing/plans?audience=user')).body.data.plans[1].prices.map(
        (p: { amount: string }) => p.amount,
      ),
    ).toEqual(['2.49']);
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: subscriber.id } });
    expect(sub.priceId).toBe(oldWeb.id);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'billing.price_set', resourceId: res.body.data.price.id },
    });
    expect(audit.newValues).toMatchObject({ amount: '2.49', previous: { amount: '1.99' } });

    // Back to $1.99 (another new price, the history stays).
    await send('post', '/v1/admin/billing/plans/user_plus/prices', admin, { channel: 'web', amount: 1.99 });
    expect((await get('/v1/billing/plans?audience=user')).body.data.plans[1].prices[0].amount).toBe('1.99');
  });

  it('archiving hides a plan and stops sales; restoring brings it back; fallback plans are protected', async () => {
    expect(
      (await send('post', '/v1/admin/billing/plans/business_essential/archive', admin)).body.data.archivedAt,
    ).not.toBeNull();
    expect(
      (await get('/v1/billing/plans?audience=business')).body.data.plans.map((p: { code: string }) => p.code),
    ).toEqual(['business_professional', 'business_enterprise']);
    expect(
      (
        await send('post', '/v1/admin/billing/plans/business_essential/prices', admin, {
          channel: 'web',
          amount: 39.99,
        })
      ).status,
    ).toBe(409);
    await send('post', '/v1/admin/billing/plans/business_essential/restore', admin);
    expect((await get('/v1/billing/plans?audience=business')).body.data.plans).toHaveLength(3);

    const protectedPlan = await send('post', '/v1/admin/billing/plans/user_free/archive', admin);
    expect([protectedPlan.status, protectedPlan.body.error.message]).toEqual([
      409,
      expect.stringContaining('fallback plan'),
    ]);
  });

  it('stopping sales on one channel: the iPhone price can be removed on its own', async () => {
    const plans = (await get('/v1/admin/billing/plans', admin)).body.data as {
      code: string;
      prices: { id: string; channel: string; active: boolean }[];
    }[];
    const ios = plans
      .find((p) => p.code === 'user_plus')!
      .prices.find((p) => p.channel === 'ios' && p.active)!;
    await send('post', `/v1/admin/billing/prices/${ios.id}/archive`, admin);
    expect(
      (await get('/v1/billing/plans?audience=user&channel=ios')).body.data.plans.map(
        (p: { code: string }) => p.code,
      ),
    ).toEqual(['user_free']);
    await send('post', '/v1/admin/billing/plans/user_plus/prices', admin, { channel: 'ios', amount: 4.99 });
  });

  it('edits limits, features and benefits; only known keys; admins only', async () => {
    const res = await send('patch', '/v1/admin/billing/plans/business_essential', admin, {
      limits: { team_accounts: 4 },
      benefits: ['Online bookings', 'Virtual queue', 'Up to 4 team logins'],
    });
    expect(res.body.data.limits).toMatchObject({ team_accounts: 4, staff_profiles: 5 }); // merged
    const bad = await send('patch', '/v1/admin/billing/plans/business_essential', admin, {
      limits: { team_acounts: 9 },
    });
    expect([bad.status, bad.body.error.details.unknownLimits]).toEqual([400, ['team_acounts']]);
    expect(
      (await send('patch', '/v1/admin/billing/plans/business_essential', await person(), { name: 'Hacked' }))
        .status,
    ).toBe(403);
    expect(
      (await send('patch', '/v1/admin/billing/plans/business_essential', admin, { name: 'Local' })).status,
    ).toBe(200);
    await send('patch', '/v1/admin/billing/plans/business_essential', admin, {
      limits: { team_accounts: 3 },
      benefits: [
        'Online bookings and receipts',
        'Virtual queue with live display',
        'Up to 3 team logins and 5 bookable staff',
        'Staff photos',
        'Approve bookings by hand',
      ],
    });
  });
});

describe('Switching billing on and off', () => {
  it('off: everyone unlimited. On: Free gives 1 visit; Plus is unlimited. Off again: nothing breaks', async () => {
    const me = await person();
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
      plan: { code: 'user_unlimited' },
      source: 'billing_off',
      usage: { visits: { used: 0, limit: null, remaining: null } },
    });

    await setBilling('user', true);
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
      plan: { code: 'user_free', name: 'Free' },
      source: 'default',
      usage: { visits: { used: 0, limit: 1, remaining: 1 } },
    });

    const grant = await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'user_plus',
      userId: me.id,
      note: 'Beta tester',
    });
    expect(grant.status).toBe(201);
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
      plan: { code: 'user_plus' },
      source: 'subscription',
      usage: { visits: { limit: null } },
    });

    await setBilling('user', false);
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
      plan: { code: 'user_unlimited' },
      source: 'billing_off',
    });
  });

  it('businesses see their plan and usage; when billing is on without a subscription, the Starter plan applies', async () => {
    const owner = await person();
    const b = await business(owner);
    await db.businessMember.create({
      data: { businessId: b.id, userId: (await person()).id, role: 'staff' },
    });
    await setBilling('business', true);
    const res = await get(`/v1/businesses/${b.id}/billing`, owner);
    expect(res.body.data).toMatchObject({
      plan: { code: 'business_free', name: 'Starter' },
      usage: { team_accounts: { used: 1, limit: 1, remaining: 0 }, services: { used: 0, limit: 10 } },
      features: { queue: false, ads: false },
    });
    await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'business_enterprise',
      businessId: b.id,
      note: 'Launch partner',
    });
    expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data).toMatchObject({
      plan: { code: 'business_enterprise' },
      usage: { team_accounts: { limit: null } },
      features: { ads: true },
    });
    expect((await get(`/v1/businesses/${b.id}/billing`, await person())).status).toBe(404);
    await setBilling('business', false);
  });

  it('settings can only point at plans of the right audience that are on sale', async () => {
    expect(
      (await send('put', '/v1/admin/billing/settings/user', admin, { defaultPlanCode: 'business_essential' }))
        .status,
    ).toBe(400);
    expect(
      (await send('put', '/v1/admin/billing/settings/user', admin, { defaultPlanCode: 'nope_plan' })).status,
    ).toBe(404);
  });

  it('if billing settings were ever missing, everyone is unlimited instead of blocked', async () => {
    const u = await person();
    await db
      .$transaction(async (tx) => {
        await tx.billingSettings.delete({ where: { audience: 'user' } });
        const e = await entitlementsOf(tx, { userId: u.id });
        expect([e.source, e.limits.visits]).toEqual(['fallback', null]);
        throw new Error('rollback');
      })
      .catch((err: unknown) => {
        if ((err as Error).message !== 'rollback') throw err;
      });
    expect(await db.billingSettings.count()).toBe(2);
  });
});

describe('Grants and subscriptions', () => {
  it('one live subscription per account; admins end grants, not store subscriptions', async () => {
    const u = await person();
    const first = await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'user_plus',
      userId: u.id,
      note: 'Support gesture',
      until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(
      (
        await send('post', '/v1/admin/billing/grants', admin, {
          planCode: 'user_plus',
          userId: u.id,
          note: 'Again',
        })
      ).status,
    ).toBe(409);
    const ended = await send('post', `/v1/admin/billing/subscriptions/${first.body.data.id}/end`, admin, {
      reason: 'Gesture over',
    });
    expect(ended.body.data.status).toBe('cancelled');
    expect(
      (
        await send('post', '/v1/admin/billing/grants', admin, {
          planCode: 'user_plus',
          userId: u.id,
          note: 'Again',
        })
      ).status,
    ).toBe(201);

    const store = await db.subscription.create({
      data: {
        planId: (await db.plan.findUniqueOrThrow({ where: { code: 'user_plus' } })).id,
        userId: (await person()).id,
        provider: 'paddle',
        channel: 'web',
        status: 'active',
      },
    });
    expect(
      (await send('post', `/v1/admin/billing/subscriptions/${store.id}/end`, admin, { reason: 'Test' }))
        .status,
    ).toBe(503); // Paddle subscriptions are ended in Paddle (not configured in this test; see paddle.int.test.ts)
    expect(
      (
        await send('post', '/v1/admin/billing/grants', admin, {
          planCode: 'business_essential',
          userId: u.id,
          note: 'Wrong',
        })
      ).status,
    ).toBe(400);
  });
});

describe('Costs, fees and the profit calculator', () => {
  it('uses the real costs and fees; "what if" subscriber numbers; changes apply at once', async () => {
    const costs = await get('/v1/admin/billing/costs', admin);
    expect(costs.body.data.monthlyTotal).toBe('108.00');
    const added = await send('post', '/v1/admin/billing/costs', admin, {
      name: 'WhatsApp messages',
      category: 'messaging',
      monthlyAmount: 12,
    });
    expect(added.status).toBe(201);

    const prices = (await get('/v1/admin/billing/plans', admin)).body.data.flatMap(
      (p: { prices: { id: string; channel: string; amount: string; active: boolean }[]; code: string }) =>
        p.prices.filter((x) => x.active).map((x) => ({ ...x, plan: p.code })),
    ) as { id: string; plan: string; channel: string }[];
    const plusWeb = prices.find((p) => p.plan === 'user_plus' && p.channel === 'web')!;
    const local = prices.find((p) => p.plan === 'business_essential')!;
    const r = await send('post', '/v1/admin/billing/economics', admin, {
      subscribers: { [plusWeb.id]: 100, [local.id]: 10 },
    });
    expect(r.body.data.assumptions).toEqual({ taxPercent: 0, monthlyCosts: '120.00' });
    const row = r.body.data.prices.find((p: { priceId: string }) => p.priceId === plusWeb.id);
    expect(row.perSubscriberPerMonth).toMatchObject({ net: '1.39', channelFee: '0.60' });
    expect(r.body.data.totals).toMatchObject({ subscribers: 110, costsPerMonth: '120.00' });

    await send('put', '/v1/admin/billing/fees/web', admin, { percent: 4, fixedAmount: 0.4 });
    const again = await send('post', '/v1/admin/billing/economics', admin, {
      subscribers: { [plusWeb.id]: 100 },
    });
    expect(
      again.body.data.prices.find((p: { priceId: string }) => p.priceId === plusWeb.id).perSubscriberPerMonth
        .net,
    ).toBe('1.51');

    await send('put', '/v1/admin/billing/fees/web', admin, { percent: 5, fixedAmount: 0.5 });
    expect((await send('delete', `/v1/admin/billing/costs/${added.body.data.id}`, admin)).status).toBe(204);
    expect((await send('post', '/v1/admin/billing/economics', await person())).status).toBe(403);
  });
});

describe('Free trial: once per account, started whenever they like', () => {
  it('a customer starts a month of BUKU Plus; it ends by itself and can’t be used twice', async () => {
    const me = await person();
    expect((await get('/v1/billing/me', me)).body.data.trial).toMatchObject({
      available: false,
      reason: 'billing_off',
    });
    expect((await send('post', '/v1/billing/me/trial', me)).status).toBe(409);

    await setBilling('user', true);
    expect((await get('/v1/billing/me', me)).body.data.trial).toEqual({
      available: true,
      reason: null,
      days: 30,
      plan: { code: 'user_plus', name: 'BUKU Plus' },
      endsAt: null,
    });
    const started = await send('post', '/v1/billing/me/trial', me);
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({
      plan: { code: 'user_plus' },
      source: 'trial',
      usage: { visits: { limit: null } },
    });
    const ends = new Date(started.body.data.subscription.currentPeriodEnd).getTime();
    expect(Math.abs(ends - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);
    expect((await send('post', '/v1/billing/me/trial', me)).body.error.details.reason).toBe('in_trial');

    // A month later: back on Free, and the trial is used up.
    await db.subscription.updateMany({
      where: { userId: me.id, provider: 'trial' },
      data: {
        currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 1000),
      },
    });
    const after = (await get('/v1/billing/me', me)).body.data;
    expect(after).toMatchObject({
      plan: { code: 'user_free' },
      source: 'default',
      trial: { available: false, reason: 'already_used' },
    });
    expect((await send('post', '/v1/billing/me/trial', me)).body.error.details.reason).toBe('already_used');
    await setBilling('user', false);
  });

  it('two taps at once start exactly one trial', async () => {
    await setBilling('user', true);
    const me = await person();
    const results = await Promise.all([
      send('post', '/v1/billing/me/trial', me),
      send('post', '/v1/billing/me/trial', me),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.subscription.count({ where: { userId: me.id, provider: 'trial' } })).toBe(1);
    await setBilling('user', false);
  });

  it('admins switch trials off (Free is then the normal plan), change the length or the plan', async () => {
    await setBilling('user', true);
    const off = await send('put', '/v1/admin/billing/settings/user', admin, { trialEnabled: false });
    expect(off.body.data.trial).toEqual({
      enabled: false,
      days: 30,
      plan: { code: 'user_plus', name: 'BUKU Plus' },
    });
    const me = await person();
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({
      plan: { code: 'user_free' },
      trial: { available: false, reason: 'trials_off' },
    });
    expect((await get('/v1/billing/plans?audience=user')).body.data.trial).toBeNull();

    await send('put', '/v1/admin/billing/settings/user', admin, { trialEnabled: true, trialDays: 14 });
    expect((await get('/v1/billing/plans?audience=user')).body.data.trial).toEqual({
      days: 14,
      plan: { code: 'user_plus', name: 'BUKU Plus' },
    });
    expect(
      (await send('put', '/v1/admin/billing/settings/user', admin, { trialPlanCode: 'business_enterprise' }))
        .status,
    ).toBe(400);
    expect(
      (await send('put', '/v1/admin/billing/settings/user', admin, { trialPlanCode: null })).body.data.trial
        .plan,
    ).toBeNull();
    const protectedPlan = await send('post', '/v1/admin/billing/plans/business_professional/archive', admin);
    expect(protectedPlan.body.error.message).toContain('free-trial plan');
    await send('put', '/v1/admin/billing/settings/user', admin, {
      trialEnabled: true,
      trialDays: 30,
      trialPlanCode: 'user_plus',
    });
    await setBilling('user', false);
  });

  it('a business owner starts a month of Professional; managers can’t', async () => {
    const owner = await person();
    const b = await business(owner);
    const manager = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: manager.id, role: 'manager' } });
    await setBilling('business', true);
    expect((await get('/v1/billing/plans?audience=business')).body.data.trial).toEqual({
      days: 30,
      plan: { code: 'business_professional', name: 'Professional' },
    });
    expect((await send('post', `/v1/businesses/${b.id}/billing/trial`, manager)).status).toBe(403);
    const started = await send('post', `/v1/businesses/${b.id}/billing/trial`, owner);
    expect(started.body.data).toMatchObject({
      plan: { code: 'business_professional' },
      source: 'trial',
      usage: { team_accounts: { limit: 15 } },
    });
    await setBilling('business', false);
  });
});

describe('Any plan for any business: requests and grants', () => {
  it('a large business asks for Enterprise; the admin approves it free until a date', async () => {
    const owner = await person();
    const b = await business(owner);
    await setBilling('business', true);
    const path = `/v1/businesses/${b.id}/billing/plan-requests`;
    const asked = await send('post', path, owner, {
      planCode: 'business_enterprise',
      message: 'Hospital group, 14 branches, 300 staff',
    });
    expect(asked.status).toBe(201);
    expect(
      (await send('post', path, owner, { planCode: 'business_enterprise', message: 'Asking again please' }))
        .status,
    ).toBe(409);
    const staff = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: staff.id, role: 'staff' } });
    expect(
      (await send('post', path, staff, { planCode: 'business_enterprise', message: 'Not my call though' }))
        .status,
    ).toBe(403);
    expect(
      (
        await send('post', path, await person(), {
          planCode: 'business_enterprise',
          message: 'Strangers asking',
        })
      ).status,
    ).toBe(404);
    expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data.pendingPlanRequest).toMatchObject({
      plan: { code: 'business_enterprise' },
    });

    const queue = (await get('/v1/admin/billing/plan-requests?status=pending', admin)).body.data as {
      id: string;
      business: { name: string };
    }[];
    expect(queue.find((r) => r.id === asked.body.data.id)?.business.name).toBe(b.name);
    const until = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const approved = await send(
      'post',
      `/v1/admin/billing/plan-requests/${asked.body.data.id}/approve`,
      admin,
      { until, note: 'Launch partner, first year free' },
    );
    expect(approved.body.data).toMatchObject({
      status: 'approved',
      decisionNote: 'Launch partner, first year free',
      subscriptionId: expect.any(String),
    });
    expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data).toMatchObject({
      plan: { code: 'business_enterprise' },
      source: 'subscription',
      subscription: {
        provider: 'manual',
        currentPeriodEnd: until,
      },
      pendingPlanRequest: null,
    });
    await setBilling('business', false);
  });

  it('approving replaces a running trial; declined and withdrawn requests leave the plan alone', async () => {
    const owner = await person();
    const b = await business(owner);
    await setBilling('business', true);
    await send('post', `/v1/businesses/${b.id}/billing/trial`, owner);
    const path = `/v1/businesses/${b.id}/billing/plan-requests`;

    const first = await send('post', path, owner, {
      planCode: 'business_enterprise',
      message: 'We are a large chain of clinics',
    });
    const declined = await send(
      'post',
      `/v1/admin/billing/plan-requests/${first.body.data.id}/decline`,
      admin,
      { note: 'Not eligible yet' },
    );
    expect(declined.body.data.status).toBe('declined');
    const second = await send('post', path, owner, {
      planCode: 'business_enterprise',
      message: 'Changed my mind about this',
    });
    expect((await send('post', `${path}/${second.body.data.id}/withdraw`, owner)).body.data.status).toBe(
      'withdrawn',
    );
    expect((await get(`/v1/businesses/${b.id}/billing`, owner)).body.data.source).toBe('trial');

    const third = await send('post', path, owner, {
      planCode: 'business_essential',
      message: 'Please give us Enterprise instead',
    });
    await send('post', `/v1/admin/billing/plan-requests/${third.body.data.id}/approve`, admin, {
      planCode: 'business_enterprise',
    });
    const now = (await get(`/v1/businesses/${b.id}/billing`, owner)).body.data;
    expect(now).toMatchObject({
      plan: { code: 'business_enterprise' },
      source: 'subscription',
      subscription: { currentPeriodEnd: null },
    });
    const trial = await db.subscription.findFirstOrThrow({ where: { businessId: b.id, provider: 'trial' } });
    expect(trial.status).toBe('cancelled');
    await setBilling('business', false);
  });

  it('admins can replace a grant directly, but never a plan paid in a store', async () => {
    const u = await person();
    await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'user_plus',
      userId: u.id,
      note: 'First grant',
    });
    expect(
      (
        await send('post', '/v1/admin/billing/grants', admin, {
          planCode: 'user_plus',
          userId: u.id,
          note: 'Second grant',
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await send('post', '/v1/admin/billing/grants', admin, {
          planCode: 'user_plus',
          userId: u.id,
          note: 'Second grant',
          replace: true,
        })
      ).status,
    ).toBe(201);

    const payer = await person();
    await db.subscription.create({
      data: {
        planId: (await db.plan.findUniqueOrThrow({ where: { code: 'user_plus' } })).id,
        userId: payer.id,
        provider: 'paddle',
        channel: 'web',
        status: 'active',
      },
    });
    const refused = await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'user_plus',
      userId: payer.id,
      note: 'Swap',
      replace: true,
    });
    expect([refused.status, refused.body.error.message]).toEqual([
      409,
      expect.stringContaining('billed by paddle'),
    ]);
  });

  it('ended trials and grants are marked expired by the sweeper', async () => {
    const u = await person();
    const g = await send('post', '/v1/admin/billing/grants', admin, {
      planCode: 'user_plus',
      userId: u.id,
      note: 'Short gesture',
      until: new Date(Date.now() + 60_000).toISOString(),
    });
    await db.subscription.update({
      where: { id: g.body.data.id },
      data: {
        currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
        currentPeriodEnd: new Date(Date.now() - 1000),
      },
    });
    const { AccountService } = await import('../src/account-service.js');
    expect(await new AccountService(db).expireEnded()).toBeGreaterThanOrEqual(1);
    expect((await db.subscription.findUniqueOrThrow({ where: { id: g.body.data.id } })).status).toBe(
      'expired',
    );
  });
});
