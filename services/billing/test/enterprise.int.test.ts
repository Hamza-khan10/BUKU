import { afterAll, describe, expect, it } from 'vitest';
import { useBillingHarness } from './harness.js';

/**
 * Enterprise for operators (D-151): the rate card, quotes and deals, on the directory's private
 * `sales` schema, with chains counted on the business shards. The figures here are made up: the
 * owner's real rate card is private and only ever typed into the console.
 */
const { h, x } = useBillingHarness('enterprise-int-test');
const { get, send } = x;
const admin = () => h.admin;
const base = '/v1/admin/billing/enterprise';

const card = {
  tiers: [
    { fromBranches: 6, price: 100, floor: 60 },
    { fromBranches: 25, price: 90, floor: 55 },
    { fromBranches: 50, price: 80, floor: 50 },
  ],
  terms: {
    costPerBranch: 10,
    yearlyDiscountPercent: 10,
    twoYearDiscountPercent: 15,
    askedDiscountPercent: 10,
    askedDiscountFromBranches: 50,
    withholdingPercent: 4,
  },
};

afterAll(async () => {
  // Leave no deal live for the other files' chains.
  for (const d of (await get(`${base}/deals?status=active`, admin())).body.data.deals as { id: string }[])
    await send('post', `${base}/deals/${d.id}/end`, admin());
});

describe('The rate card', () => {
  it('is for platform admins only, set a currency at a time, and read back', async () => {
    const owner = await x.person('business_owner');
    expect((await get(`${base}/rate-card`, owner)).status).toBe(403);
    expect((await send('put', `${base}/rate-card/USD`, owner, card)).status).toBe(403);

    const empty = (await get(`${base}/rate-card`, admin())).body.data.currencies as { currency: string }[];
    expect(empty.map((c) => c.currency)).toEqual(expect.arrayContaining(['PKR', 'USD']));

    const set = await send('put', `${base}/rate-card/USD`, admin(), card);
    expect(set.status).toBe(200);
    const usd = (set.body.data.currencies as { currency: string }[]).find((c) => c.currency === 'USD');
    expect(usd).toMatchObject({
      tiers: [
        { fromBranches: 6, toBranches: 24, price: '100.00', floor: '60.00' },
        { fromBranches: 25, toBranches: 49, price: '90.00', floor: '55.00' },
        { fromBranches: 50, toBranches: null, price: '80.00', floor: '50.00' },
      ],
      terms: { costPerBranch: '10.00', yearlyDiscountPercent: 10, askedDiscountFromBranches: 50 },
    });
    // Set again with fewer tiers: replaced, not added to.
    await send('put', `${base}/rate-card/USD`, admin(), { ...card, tiers: card.tiers.slice(0, 2) });
    expect(
      (await get(`${base}/rate-card`, admin())).body.data.currencies.find(
        (c: { currency: string }) => c.currency === 'USD',
      ).tiers,
    ).toHaveLength(2);
    await send('put', `${base}/rate-card/USD`, admin(), card);

    // A floor above its price, the same tier twice, an unknown currency: refused.
    const floorAbove = { ...card, tiers: [{ fromBranches: 6, price: 50, floor: 60 }] };
    expect((await send('put', `${base}/rate-card/USD`, admin(), floorAbove)).status).toBe(400);
    const twice = { ...card, tiers: [card.tiers[0], card.tiers[0]] };
    expect((await send('put', `${base}/rate-card/USD`, admin(), twice)).status).toBe(400);
    expect((await send('put', `${base}/rate-card/XYZ`, admin(), card)).status).toBe(404);
  });
});

describe('Quotes', () => {
  it('work out a chain’s price from the rate card, saving nothing', async () => {
    await send('put', `${base}/rate-card/USD`, admin(), card);
    const q = await send('post', `${base}/quote`, admin(), {
      currency: 'USD',
      branches: 60,
      term: 'year',
      askedDiscountPercent: 15,
    });
    expect(q.status).toBe(200);
    expect(q.body.data).toMatchObject({
      branches: 60,
      months: 12,
      tier: { fromBranches: 50, toBranches: null, price: '80.00', floor: '50.00' },
      discounts: { termPercent: 10, asked: 15, given: 10, limitedBy: 'most' },
      perBranch: '64.80',
      monthly: '3888.00',
      invoice: '46656.00',
      withheld: '1866.24',
      costMonthly: '600.00',
      marginMonthly: '3288.00',
      marginPercent: 84.6,
      floorMonthly: '3000.00',
    });
    // 24 branches pay what 25 would: adding a branch never lowers the bill.
    expect(
      (await send('post', `${base}/quote`, admin(), { currency: 'USD', branches: 24 })).body.data,
    ).toMatchObject({
      monthly: '2250.00',
      heldAtTier: { fromBranches: 25, monthly: '2250.00' },
    });
    const small = await send('post', `${base}/quote`, admin(), { currency: 'USD', branches: 4 });
    expect([small.status, small.body.error.details]).toEqual([
      409,
      { ok: false, reason: 'below_enterprise', fromBranches: 6 },
    ]);
    // Cleared: no more quotes in that currency.
    await send('put', `${base}/rate-card/EUR`, admin(), card);
    expect((await send('delete', `${base}/rate-card/EUR`, admin())).status).toBe(200);
    const none = await send('post', `${base}/quote`, admin(), { currency: 'EUR', branches: 10 });
    expect([none.status, none.body.error.details.reason]).toEqual([409, 'no_rate_card']);
  });
});

describe('Deals', () => {
  it('a chain’s deal follows its branches as they open and close, and counts in the month’s revenue', async () => {
    await send('put', `${base}/rate-card/USD`, admin(), card);
    const owner = await x.person('business_owner');
    const first = await x.business(owner);
    for (let i = 0; i < 5; i++) await x.business(owner);

    const made = await send('post', `${base}/deals`, admin(), {
      businessId: first.publicId,
      name: 'Chain Cuts',
      currency: 'USD',
      term: 'year',
      pricePerBranch: 90,
      startsOn: '2026-12-01',
      notes: 'Signed after the pilot.',
    });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({
      name: 'Chain Cuts',
      business: { publicId: first.publicId, name: first.name },
      currency: 'USD',
      term: 'year',
      pricePerBranch: '90.00',
      branchesAtSigning: 6,
      branchesNow: 6,
      monthly: '540.00',
      invoice: '6480.00',
      quoteAgain: false,
      startsOn: '2026-12-01',
      status: 'active',
    });
    const id = made.body.data.id as string;

    // One live deal a chain, made from any of its branches.
    const other = (await x.business(owner)).publicId;
    const again = {
      businessId: other,
      name: 'Chain Cuts again',
      currency: 'USD',
      term: 'month',
      pricePerBranch: 90,
      startsOn: '2026-12-01',
    };
    expect((await send('post', `${base}/deals`, admin(), again)).status).toBe(409);

    // A seventh branch opened above: the bill follows. Twenty more move it into the next tier.
    const now = async () =>
      ((await get(`${base}/deals?status=active`, admin())).body.data.deals as { id: string }[]).find(
        (d) => d.id === id,
      ) as unknown as { branchesNow: number; monthly: string; quoteAgain: boolean };
    expect(await now()).toMatchObject({ branchesNow: 7, monthly: '630.00', quoteAgain: false });
    for (let i = 0; i < 18; i++) await x.business(owner);
    expect(await now()).toMatchObject({ branchesNow: 25, monthly: '2250.00', quoteAgain: true });

    // A branch closed: gone from the bill.
    const closing = await x.business(owner);
    await x.inShop(closing, (tx) =>
      tx.business.update({ where: { id: closing.id }, data: { deletedAt: new Date() } }),
    );
    expect((await now()).branchesNow).toBe(25);

    // The new price after quoting again; the month's revenue counts it.
    const changed = await send('patch', `${base}/deals/${id}`, admin(), {
      pricePerBranch: 85,
      endsOn: '2027-11-30',
    });
    expect(changed.body.data).toMatchObject({
      pricePerBranch: '85.00',
      monthly: '2125.00',
      endsOn: '2027-11-30',
    });
    const listed = (await get(`${base}/deals?status=active`, admin())).body.data;
    expect(listed.totals.find((t: { currency: string }) => t.currency === 'USD')).toMatchObject({
      deals: expect.any(Number),
    });
    expect(
      Number(listed.totals.find((t: { currency: string }) => t.currency === 'USD').monthly),
    ).toBeGreaterThanOrEqual(2125);

    // Ended: out of the month's revenue, kept for the record, no longer changed; a new one may start.
    const ended = await send('post', `${base}/deals/${id}/end`, admin());
    expect(ended.body.data).toMatchObject({ status: 'ended', quoteAgain: false });
    expect((await send('patch', `${base}/deals/${id}`, admin(), { pricePerBranch: 70 })).status).toBe(409);
    expect((await send('post', `${base}/deals`, admin(), again)).status).toBe(201);

    // Recorded on the operator's shard.
    const audit = await (
      await x.shardOf(admin())
    ).auditLog.findMany({
      where: { resourceType: 'enterprise_deal', resourceId: BigInt(id) },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'billing.enterprise_deal_made',
      'billing.enterprise_deal_changed',
      'billing.enterprise_deal_ended',
    ]);
  });

  it('refuses what doesn’t add up', async () => {
    const b = await x.business();
    const deal = {
      businessId: b.publicId,
      name: 'Somewhere',
      currency: 'USD',
      term: 'month',
      pricePerBranch: 90,
      startsOn: '2026-12-01',
    };
    expect((await send('post', `${base}/deals`, admin(), { ...deal, endsOn: '2026-11-01' })).status).toBe(
      400,
    );
    expect((await send('post', `${base}/deals`, admin(), { ...deal, term: 'week' })).status).toBe(400);
    expect(
      (await send('post', `${base}/deals`, admin(), { ...deal, businessId: 'AAAAAAAAAAAA' })).status,
    ).toBe(404);
    expect((await send('post', `${base}/deals`, await x.person('business_owner'), deal)).status).toBe(403);
  });
});
