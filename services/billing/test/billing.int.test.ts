import { randomUUID } from 'node:crypto';
import { businessEntitlementsOnShard } from '@buku/billing';
import { createBusinessShardClient } from '@buku/database';
import { afterAll, describe, expect, it } from 'vitest';
import { servicesWorld } from '../../../packages/database/test/services-world.js';
import { AccountService } from '../src/account-service.js';
import { useBillingHarness, type Shop } from './harness.js';

/**
 * Billing catalog, switches and entitlements on database v2 (D3g): the catalog on the directory
 * (with the starting catalog from its migrations), subscriptions and plan requests on business
 * shards. Settings changed here are put back afterwards (billing starts switched off).
 */

const { h, x } = useBillingHarness('billing-int-test');
const { get, send } = x;
const admin = () => h.admin;

afterAll(async () => {
  // Leave billing as the migrations start it: switched off for everyone; trials for businesses only.
  await x.setBilling('business', false);
  await send('put', '/v1/admin/billing/settings/business', admin(), {
    trialEnabled: true,
    trialDays: 30,
    trialPlanCode: 'business_professional',
  });
});

/** A subscription written straight to the business's shard (as a store or an admin would). */
const subscribe = async (b: Shop, data: { planCode: string; provider: string; priceId?: bigint }) => {
  const plan = await h.world.directory.plan.findUniqueOrThrow({ where: { code: data.planCode } });
  return x.inShop(b, (tx) =>
    tx.subscription.create({
      data: {
        id: h.world.id(),
        businessId: b.id,
        planId: plan.id,
        priceId: data.priceId ?? null,
        provider: data.provider,
        channel: data.provider === 'manual' ? null : 'web',
        status: 'active',
        externalSubscriptionId: data.provider === 'paddle' ? `sub_${randomUUID()}` : null,
      },
    }),
  );
};
const grant = (b: Shop, planCode: string, note: string, extra: Record<string, unknown> = {}) =>
  send('post', '/v1/admin/billing/grants', admin(), { planCode, businessId: b.publicId, note, ...extra });

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
    expect(web.body.data.plans[1].prices[0].id).toMatch(/^[1-9][0-9]*$/);
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
    // Ads aren't offered yet (D-087): no plan advertises them, in its features, the comparison or its words.
    expect(plans.every((p) => !('ads' in p.features))).toBe(true);
    expect(plans.map((p) => p.features.queue)).toEqual([true, true, true]);
    expect(res.body.data.comparison.features.map((f: { key: string }) => f.key)).not.toContain('ads');
    expect(JSON.stringify(res.body.data)).not.toMatch(/\bads?\b/i);
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
    const plans = (await get('/v1/admin/billing/plans', admin())).body.data as {
      code: string;
      prices: { id: string; channel: string; active: boolean }[];
    }[];
    const oldWeb = plans
      .find((p) => p.code === 'business_essential')!
      .prices.find((p) => p.channel === 'web' && p.active)!;
    const subscriber = await x.business();
    await subscribe(subscriber, {
      planCode: 'business_essential',
      provider: 'paddle',
      priceId: BigInt(oldWeb.id),
    });

    const res = await send('post', '/v1/admin/billing/plans/business_essential/prices', admin(), {
      channel: 'web',
      amount: 29.99,
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      price: { amount: '29.99', active: true },
      replaced: { id: oldWeb.id, active: false },
      subscribersOnPreviousPrice: 1,
    });
    expect(
      (await get('/v1/billing/plans?audience=business')).body.data.plans[0].prices.map(
        (p: { amount: string }) => p.amount,
      ),
    ).toEqual(['29.99']);
    // Kept in minor units on the directory (DB-009).
    expect(
      (await h.world.directory.planPrice.findUniqueOrThrow({ where: { id: BigInt(res.body.data.price.id) } }))
        .amountMinor,
    ).toBe(2999n);
    expect((await x.subscriptions(subscriber))[0]!.priceId).toBe(BigInt(oldWeb.id));
    const audit = await (
      await x.shardOf(admin())
    ).auditLog.findFirstOrThrow({
      where: { action: 'billing.price_set', resourceId: BigInt(res.body.data.price.id) },
    });
    expect(audit.newValues).toMatchObject({ amount: '29.99', previous: { amount: '24.99' } });

    // Back to $24.99 (another new price, the history stays).
    await send('post', '/v1/admin/billing/plans/business_essential/prices', admin(), {
      channel: 'web',
      amount: 24.99,
    });
    expect((await get('/v1/billing/plans?audience=business')).body.data.plans[0].prices[0].amount).toBe(
      '24.99',
    );
    expect(
      (
        await send('post', '/v1/admin/billing/plans/business_essential/prices', admin(), {
          channel: 'web',
          amount: 1.999,
        })
      ).status,
    ).toBe(400);
  });

  it('archiving hides a plan and stops sales; restoring brings it back; fallback plans are protected', async () => {
    expect(
      (await send('post', '/v1/admin/billing/plans/business_essential/archive', admin())).body.data
        .archivedAt,
    ).not.toBeNull();
    expect(
      (await get('/v1/billing/plans?audience=business')).body.data.plans.map((p: { code: string }) => p.code),
    ).toEqual(['business_professional', 'business_enterprise']);
    expect(
      (
        await send('post', '/v1/admin/billing/plans/business_essential/prices', admin(), {
          channel: 'web',
          amount: 39.99,
        })
      ).status,
    ).toBe(409);
    await send('post', '/v1/admin/billing/plans/business_essential/restore', admin());
    expect((await get('/v1/billing/plans?audience=business')).body.data.plans).toHaveLength(3);

    const protectedPlan = await send('post', '/v1/admin/billing/plans/user_free/archive', admin());
    expect([protectedPlan.status, protectedPlan.body.error.message]).toEqual([
      409,
      expect.stringContaining('fallback plan'),
    ]);
  });

  it('stopping sales on one channel: the iPhone price can be removed on its own', async () => {
    const plans = (await get('/v1/admin/billing/plans', admin())).body.data as {
      code: string;
      prices: { id: string; channel: string; active: boolean }[];
    }[];
    const ios = plans
      .find((p) => p.code === 'user_plus')!
      .prices.find((p) => p.channel === 'ios' && p.active)!;
    await send('post', `/v1/admin/billing/prices/${ios.id}/archive`, admin());
    expect(
      (await get('/v1/billing/plans?audience=user&channel=ios')).body.data.plans.map(
        (p: { code: string }) => p.code,
      ),
    ).toEqual(['user_free']);
    await send('post', '/v1/admin/billing/plans/user_plus/prices', admin(), { channel: 'ios', amount: 4.99 });
  });

  it('edits limits, features and benefits; only known keys; admins only', async () => {
    const res = await send('patch', '/v1/admin/billing/plans/business_essential', admin(), {
      limits: { team_accounts: 4 },
      benefits: ['Online bookings', 'Virtual queue', 'Up to 4 team logins'],
    });
    expect(res.body.data.limits).toMatchObject({ team_accounts: 4, staff_profiles: 5 }); // merged
    const bad = await send('patch', '/v1/admin/billing/plans/business_essential', admin(), {
      limits: { team_acounts: 9 },
    });
    expect([bad.status, bad.body.error.details.unknownLimits]).toEqual([400, ['team_acounts']]);
    expect(
      (
        await send('patch', '/v1/admin/billing/plans/business_essential', await x.person(), {
          name: 'Hacked',
        })
      ).status,
    ).toBe(403);
    expect(
      (await send('patch', '/v1/admin/billing/plans/business_essential', admin(), { name: 'Local' })).status,
    ).toBe(200);
    await send('patch', '/v1/admin/billing/plans/business_essential', admin(), {
      name: 'Essential',
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
  it('customers are free (D-101): unlimited, no trial to start, charging them can’t be switched on, nothing to grant', async () => {
    const me = await x.person();
    const free = {
      plan: { code: 'user_unlimited' },
      source: 'billing_off',
      usage: { visits: { used: 0, limit: null, remaining: null } },
      trial: { available: false, reason: 'billing_off' },
    };
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject(free);
    for (const change of [{ enabled: true }, { trialEnabled: true }, { enabled: true, trialDays: 7 }]) {
      const refused = await send('put', '/v1/admin/billing/settings/user', admin(), change);
      expect([refused.status, refused.body.error.code], JSON.stringify(change)).toEqual([409, 'CONFLICT']);
    }
    expect((await send('post', '/v1/billing/me/trial', me)).status).toBe(409);
    expect((await get('/v1/admin/billing/settings', admin())).body.data).toContainEqual(
      expect.objectContaining({ audience: 'user', enabled: false }),
    );
    // Saying "off" again is fine; a plan for a person is refused (there are no customer plans).
    expect((await x.setBilling('user', false)).status).toBe(200);
    const gift = await send('post', '/v1/admin/billing/grants', admin(), {
      planCode: 'user_plus',
      userId: me.publicId,
      note: 'Beta',
    });
    expect([gift.status, gift.body.error.code]).toEqual([409, 'CONFLICT']);
    expect((await get('/v1/billing/me', me)).body.data).toMatchObject({ source: 'billing_off' });
  });

  it('a customer’s visits are counted from their own list (shown only, never limited)', async () => {
    const me = await x.person();
    const db = await x.shardOf(me);
    const visit = (status: string) =>
      db.userAppointment.create({
        data: {
          userId: me.id,
          appointmentId: h.world.id(),
          businessId: 1n,
          version: 1n,
          startAt: new Date(),
          endAt: new Date(Date.now() + 1_800_000),
          appointmentPublicId: randomUUID().replace(/-/g, '').slice(0, 12),
          status,
          businessName: 'Shop',
          serviceName: 'Haircut',
        },
      });
    for (const status of ['confirmed', 'completed', 'cancelled', 'no_show']) await visit(status);
    await db.userVisitOutcome.create({
      data: {
        userId: me.id,
        refId: h.world.id(),
        businessId: 1n,
        happenedAt: new Date(),
        kind: 'visit',
        source: 'queue',
      },
    });
    expect((await get('/v1/billing/me', me)).body.data.usage.visits).toEqual({
      used: 4,
      limit: null,
      remaining: null,
    });
  });

  it('businesses see their plan and usage; when billing is on without a subscription, the Starter plan applies', async () => {
    const b = await x.business();
    await x.member(b, 'staff');
    await x.setBilling('business', true);
    const res = await get(`/v1/businesses/${b.publicId}/billing`, b.owner);
    expect(res.body.data).toMatchObject({
      plan: { code: 'business_free', name: 'Starter' },
      usage: { team_accounts: { used: 1, limit: 1, remaining: 0 }, services: { used: 0, limit: 10 } },
      features: { queue: false, ads: false },
    });
    expect((await grant(b, 'business_enterprise', 'Launch partner')).status).toBe(201);
    expect((await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data).toMatchObject({
      plan: { code: 'business_enterprise' },
      usage: { team_accounts: { limit: null } },
      features: { ads: true },
    });
    expect((await get(`/v1/businesses/${b.publicId}/billing`, await x.person())).status).toBe(404);
    await x.setBilling('business', false);
  });

  it('settings can only point at plans of the right audience that are on sale', async () => {
    expect(
      (
        await send('put', '/v1/admin/billing/settings/user', admin(), {
          defaultPlanCode: 'business_essential',
        })
      ).status,
    ).toBe(400);
    expect(
      (await send('put', '/v1/admin/billing/settings/user', admin(), { defaultPlanCode: 'nope_plan' }))
        .status,
    ).toBe(404);
  });

  it('if a shard’s copy of the billing settings were ever missing, everyone is unlimited instead of blocked', async () => {
    const b = await x.business();
    // The copy is replication's: only its owner can touch it, and this transaction is rolled back.
    const owner = createBusinessShardClient({
      url: servicesWorld.ownerUrl(servicesWorld.shards.business),
      applicationName: 'billing-int-test',
    });
    try {
      await owner
        .$transaction(async (tx) => {
          await tx.billingSettings.delete({ where: { audience: 'business' } });
          const e = await businessEntitlementsOnShard(tx, b.id);
          expect([e.source, e.limits.team_accounts]).toEqual(['fallback', null]);
          throw new Error('rollback');
        })
        .catch((err: unknown) => {
          if ((err as Error).message !== 'rollback') throw err;
        });
      expect(await owner.billingSettings.count()).toBe(2);
    } finally {
      await owner.$disconnect();
    }
  });
});

describe('Grants and subscriptions', () => {
  it('one live subscription per business; admins end grants, not store subscriptions', async () => {
    const b = await x.business();
    const first = await grant(b, 'business_essential', 'Support gesture', {
      until: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    });
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      businessId: b.publicId,
      provider: 'manual',
      id: expect.stringMatching(/^\d+$/),
    });
    expect((await grant(b, 'business_essential', 'Again')).status).toBe(409);
    const ended = await send('post', `/v1/admin/billing/subscriptions/${first.body.data.id}/end`, admin(), {
      reason: 'Gesture over',
    });
    expect(ended.body.data.status).toBe('cancelled');
    const onAdmin = await (
      await h.world.user(h.admin.id)
    ).auditLog.findMany({
      where: { userId: h.admin.id, resourceId: BigInt(first.body.data.id) },
      orderBy: { createdAt: 'asc' },
    });
    expect(onAdmin.map((e) => e.action)).toEqual(['admin.plan_granted', 'admin.subscription_ended']);
    expect(onAdmin[1]!.newValues).toMatchObject({ reason: 'Gesture over' });
    expect((await grant(b, 'business_essential', 'Again')).status).toBe(201);

    const store = await subscribe(await x.business(), { planCode: 'business_essential', provider: 'paddle' });
    expect(
      (await send('post', `/v1/admin/billing/subscriptions/${store.id}/end`, admin(), { reason: 'Test' }))
        .status,
    ).toBe(503); // Paddle subscriptions are ended in Paddle (not configured in this test; see paddle.int.test.ts)
    expect((await grant(b, 'user_plus', 'Wrong')).status).toBe(400);

    // The database itself keeps one live subscription per business (D3g).
    await expect(subscribe(b, { planCode: 'business_professional', provider: 'manual' })).rejects.toThrow(
      /subscriptions_one_live/,
    );
    const list = await get(
      `/v1/admin/billing/subscriptions?planCode=business_essential&page=1&limit=5`,
      admin(),
    );
    expect(list.body.meta.total).toBeGreaterThanOrEqual(2);
    expect(list.body.data[0]).toMatchObject({ plan: { code: 'business_essential' } });
  });
});

describe('Costs, fees and the profit calculator', () => {
  it('uses the real costs and fees; "what if" subscriber numbers; changes apply at once', async () => {
    const costs = await get('/v1/admin/billing/costs', admin());
    expect(costs.body.data.monthlyTotal).toBe('108.00');
    const added = await send('post', '/v1/admin/billing/costs', admin(), {
      name: 'WhatsApp messages',
      category: 'messaging',
      monthlyAmount: 12,
    });
    expect(added.status).toBe(201);

    const prices = (await get('/v1/admin/billing/plans', admin())).body.data.flatMap(
      (p: { prices: { id: string; channel: string; amount: string; active: boolean }[]; code: string }) =>
        p.prices.filter((x) => x.active).map((x) => ({ ...x, plan: p.code })),
    ) as { id: string; plan: string; channel: string }[];
    const plusWeb = prices.find((p) => p.plan === 'user_plus' && p.channel === 'web')!;
    const local = prices.find((p) => p.plan === 'business_essential')!;
    const r = await send('post', '/v1/admin/billing/economics', admin(), {
      subscribers: { [plusWeb.id]: 100, [local.id]: 10 },
    });
    expect(r.body.data.assumptions).toEqual({ taxPercent: 0, monthlyCosts: '120.00' });
    const row = r.body.data.prices.find((p: { priceId: string }) => p.priceId === plusWeb.id);
    expect(row.perSubscriberPerMonth).toMatchObject({ net: '1.39', channelFee: '0.60' });
    expect(r.body.data.totals).toMatchObject({ subscribers: 110, costsPerMonth: '120.00' });

    await send('put', '/v1/admin/billing/fees/web', admin(), { percent: 4, fixedAmount: 0.4 });
    const again = await send('post', '/v1/admin/billing/economics', admin(), {
      subscribers: { [plusWeb.id]: 100 },
    });
    expect(
      again.body.data.prices.find((p: { priceId: string }) => p.priceId === plusWeb.id).perSubscriberPerMonth
        .net,
    ).toBe('1.51');

    await send('put', '/v1/admin/billing/fees/web', admin(), { percent: 5, fixedAmount: 0.5 });
    expect((await send('delete', `/v1/admin/billing/costs/${added.body.data.id}`, admin())).status).toBe(204);
    expect((await send('post', '/v1/admin/billing/economics', await x.person())).status).toBe(403);
  });
});

describe('Free trial: once per business, started whenever they like', () => {
  it('a business starts a month of Professional; it ends by itself and can’t be used twice', async () => {
    const b = await x.business();
    const path = `/v1/businesses/${b.publicId}/billing`;
    expect((await get(path, b.owner)).body.data.trial).toMatchObject({
      available: false,
      reason: 'billing_off',
    });
    expect((await send('post', `${path}/trial`, b.owner)).status).toBe(409);

    await x.setBilling('business', true);
    expect((await get(path, b.owner)).body.data.trial).toEqual({
      available: true,
      reason: null,
      days: 30,
      plan: { code: 'business_professional', name: 'Professional' },
      endsAt: null,
    });
    const started = await send('post', `${path}/trial`, b.owner);
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ plan: { code: 'business_professional' }, source: 'trial' });
    const ends = new Date(started.body.data.subscription.currentPeriodEnd).getTime();
    expect(Math.abs(ends - (Date.now() + 30 * 86_400_000))).toBeLessThan(60_000);
    expect((await send('post', `${path}/trial`, b.owner)).body.error.details.reason).toBe('in_trial');

    // A month later: back on Starter, and the trial is used up.
    await x.inShop(b, (tx) =>
      tx.subscription.updateMany({
        where: { businessId: b.id, provider: 'trial' },
        data: {
          currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
          currentPeriodEnd: new Date(Date.now() - 1000),
        },
      }),
    );
    expect((await get(path, b.owner)).body.data).toMatchObject({
      plan: { code: 'business_free' },
      source: 'default',
      trial: { available: false, reason: 'already_used' },
    });
    expect((await send('post', `${path}/trial`, b.owner)).body.error.details.reason).toBe('already_used');
    await x.setBilling('business', false);
  });

  it('two taps at once start exactly one trial', async () => {
    await x.setBilling('business', true);
    const b = await x.business();
    const results = await Promise.all([
      send('post', `/v1/businesses/${b.publicId}/billing/trial`, b.owner),
      send('post', `/v1/businesses/${b.publicId}/billing/trial`, b.owner),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await x.subscriptions(b)).filter((s) => s.provider === 'trial')).toHaveLength(1);
    await x.setBilling('business', false);
  });

  it('admins switch trials off (Starter is then the normal plan), change the length or the plan', async () => {
    await x.setBilling('business', true);
    const settings = '/v1/admin/billing/settings/business';
    const off = await send('put', settings, admin(), { trialEnabled: false });
    expect(off.body.data.trial).toEqual({
      enabled: false,
      days: 30,
      plan: { code: 'business_professional', name: 'Professional' },
    });
    const b = await x.business();
    expect((await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data).toMatchObject({
      plan: { code: 'business_free' },
      trial: { available: false, reason: 'trials_off' },
    });
    expect((await get('/v1/billing/plans?audience=business')).body.data.trial).toBeNull();

    await send('put', settings, admin(), { trialEnabled: true, trialDays: 14 });
    expect((await get('/v1/billing/plans?audience=business')).body.data.trial).toEqual({
      days: 14,
      plan: { code: 'business_professional', name: 'Professional' },
    });
    expect((await send('put', settings, admin(), { trialPlanCode: 'user_plus' })).status).toBe(400);
    const protectedPlan = await send(
      'post',
      '/v1/admin/billing/plans/business_professional/archive',
      admin(),
    );
    expect(protectedPlan.body.error.message).toContain('free-trial plan');
    expect((await send('put', settings, admin(), { trialPlanCode: null })).body.data.trial.plan).toBeNull();
    await send('put', settings, admin(), {
      trialEnabled: true,
      trialDays: 30,
      trialPlanCode: 'business_professional',
    });
    await x.setBilling('business', false);
  });

  it('a business owner starts a month of Professional; managers can’t', async () => {
    const b = await x.business();
    const manager = await x.member(b, 'manager');
    await x.setBilling('business', true);
    expect((await get('/v1/billing/plans?audience=business')).body.data.trial).toEqual({
      days: 30,
      plan: { code: 'business_professional', name: 'Professional' },
    });
    expect((await send('post', `/v1/businesses/${b.publicId}/billing/trial`, manager)).status).toBe(403);
    const started = await send('post', `/v1/businesses/${b.publicId}/billing/trial`, b.owner);
    expect(started.body.data).toMatchObject({
      plan: { code: 'business_professional' },
      source: 'trial',
      usage: { team_accounts: { limit: 15 } },
    });
    // On the business's shard, with its audit entry there.
    expect(
      await x.inShop(b, (tx) =>
        tx.auditLog.findFirst({ where: { action: 'billing.trial_started', userId: b.owner.id } }),
      ),
    ).not.toBeNull();
    await x.setBilling('business', false);
  });
});

describe('Any plan for any business: requests and grants', () => {
  it('a large business asks for Enterprise; the admin approves it free until a date', async () => {
    const b = await x.business();
    await x.setBilling('business', true);
    const path = `/v1/businesses/${b.publicId}/billing/plan-requests`;
    const asked = await send('post', path, b.owner, {
      planCode: 'business_enterprise',
      message: 'Hospital group, 14 branches, 300 staff',
    });
    expect(asked.status).toBe(201);
    expect(asked.body.data).toMatchObject({ businessId: b.publicId, plan: { code: 'business_enterprise' } });
    expect(
      (await send('post', path, b.owner, { planCode: 'business_enterprise', message: 'Asking again please' }))
        .status,
    ).toBe(409);
    const staff = await x.member(b, 'staff');
    expect(
      (await send('post', path, staff, { planCode: 'business_enterprise', message: 'Not my call though' }))
        .status,
    ).toBe(403);
    expect(
      (
        await send('post', path, await x.person(), {
          planCode: 'business_enterprise',
          message: 'Strangers asking',
        })
      ).status,
    ).toBe(404);
    expect(
      (await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data.pendingPlanRequest,
    ).toMatchObject({
      plan: { code: 'business_enterprise' },
    });

    const queue = (await get('/v1/admin/billing/plan-requests?status=pending', admin())).body.data as {
      id: string;
      business: { id: string; name: string };
    }[];
    expect(queue.find((r) => r.id === asked.body.data.id)?.business).toMatchObject({
      id: b.publicId,
      name: b.name,
    });
    const until = new Date(Date.now() + 365 * 86_400_000).toISOString();
    const approved = await send(
      'post',
      `/v1/admin/billing/plan-requests/${asked.body.data.id}/approve`,
      admin(),
      {
        until,
        note: 'Launch partner, first year free',
      },
    );
    expect(approved.body.data).toMatchObject({
      status: 'approved',
      decisionNote: 'Launch partner, first year free',
      subscriptionId: expect.any(String),
    });
    expect((await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data).toMatchObject({
      plan: { code: 'business_enterprise' },
      source: 'subscription',
      subscription: { provider: 'manual', currentPeriodEnd: until },
      pendingPlanRequest: null,
    });
    await x.setBilling('business', false);
  });

  it('approving replaces a running trial; declined and withdrawn requests leave the plan alone', async () => {
    const b = await x.business();
    await x.setBilling('business', true);
    await send('post', `/v1/businesses/${b.publicId}/billing/trial`, b.owner);
    const path = `/v1/businesses/${b.publicId}/billing/plan-requests`;

    const first = await send('post', path, b.owner, {
      planCode: 'business_enterprise',
      message: 'We are a large chain of clinics',
    });
    const declined = await send(
      'post',
      `/v1/admin/billing/plan-requests/${first.body.data.id}/decline`,
      admin(),
      {
        note: 'Not eligible yet',
      },
    );
    expect(declined.body.data.status).toBe('declined');
    const second = await send('post', path, b.owner, {
      planCode: 'business_enterprise',
      message: 'Changed my mind about this',
    });
    expect((await send('post', `${path}/${second.body.data.id}/withdraw`, b.owner)).body.data.status).toBe(
      'withdrawn',
    );
    expect((await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data.source).toBe('trial');

    const third = await send('post', path, b.owner, {
      planCode: 'business_essential',
      message: 'Please give us Enterprise instead',
    });
    await send('post', `/v1/admin/billing/plan-requests/${third.body.data.id}/approve`, admin(), {
      planCode: 'business_enterprise',
    });
    expect((await get(`/v1/businesses/${b.publicId}/billing`, b.owner)).body.data).toMatchObject({
      plan: { code: 'business_enterprise' },
      source: 'subscription',
      subscription: { currentPeriodEnd: null },
    });
    expect((await x.subscriptions(b)).find((s) => s.provider === 'trial')!.status).toBe('cancelled');

    // Each decision is also on the admin's own record, for the console's audit log (D-132).
    const onAdmin = await (
      await h.world.user(h.admin.id)
    ).auditLog.findMany({
      where: {
        userId: h.admin.id,
        resourceId: { in: [BigInt(first.body.data.id), BigInt(third.body.data.id)] },
      },
      orderBy: { createdAt: 'asc' },
    });
    expect(onAdmin.map((e) => e.action)).toEqual([
      'admin.plan_request_declined',
      'admin.plan_request_approved',
    ]);
    expect(onAdmin[0]!.newValues).toMatchObject({ reason: 'Not eligible yet' });
    expect(onAdmin[1]!.newValues).toMatchObject({ plan: 'business_enterprise' });
    await x.setBilling('business', false);
  });

  it('admins can replace a grant directly, but never a plan paid in a store', async () => {
    const b = await x.business();
    await grant(b, 'business_essential', 'First grant');
    expect((await grant(b, 'business_essential', 'Second grant')).status).toBe(409);
    expect((await grant(b, 'business_professional', 'Second grant', { replace: true })).status).toBe(201);

    const payer = await x.business();
    await subscribe(payer, { planCode: 'business_essential', provider: 'paddle' });
    const refused = await grant(payer, 'business_professional', 'Swap', { replace: true });
    expect([refused.status, refused.body.error.message]).toEqual([
      409,
      expect.stringContaining('billed by paddle'),
    ]);
  });

  it('ended trials and grants are marked expired by the sweeper', async () => {
    const b = await x.business();
    const g = await grant(b, 'business_essential', 'Short gesture', {
      until: new Date(Date.now() + 60_000).toISOString(),
    });
    await x.inShop(b, (tx) =>
      tx.subscription.update({
        where: { id: BigInt(g.body.data.id) },
        data: {
          currentPeriodStart: new Date(Date.now() - 31 * 86_400_000),
          currentPeriodEnd: new Date(Date.now() - 1000),
        },
      }),
    );
    expect(await new AccountService(h.plane).expireEnded()).toBeGreaterThanOrEqual(1);
    expect((await x.subscriptions(b))[0]!.status).toBe('expired');
  });
});
