import { describe, expect, it } from 'vitest';
import { computeEconomics, type EconomicsPrice } from '../src/economics.js';
import { readPlanValues } from '../src/registry.js';

const price = (overrides: Partial<EconomicsPrice> = {}): EconomicsPrice => ({
  priceId: 'p1',
  planCode: 'user_plus',
  planName: 'BUKU Plus',
  channel: 'web',
  currency: 'USD',
  amount: 1.99,
  interval: 'month',
  taxInclusive: false,
  subscribers: 100,
  ...overrides,
});
const fees = {
  web: { percent: 5, fixedAmount: 0.5 },
  android: { percent: 15, fixedAmount: 0 },
  ios: { percent: 15, fixedAmount: 0 },
};

describe('profit calculator', () => {
  it('web price excluding tax: the customer pays the tax on top; Paddle takes 5% + $0.50', () => {
    const r = computeEconomics({ prices: [price()], fees, monthlyCosts: 108, taxPercent: 0 });
    // 1.99 − (0.0995 + 0.50) = 1.3905 → 1.39 kept per subscriber
    expect(r.prices[0]!.perSubscriberPerMonth).toEqual({
      customerPays: '1.99',
      tax: '0.00',
      channelFee: '0.60',
      net: '1.39',
      keepPercent: 69.8,
    });
    expect(r.prices[0]!.breakEvenSubscribers).toBe(78); // 108 / 1.39
    expect(r.totals).toMatchObject({
      netRevenuePerMonth: '139.00',
      costsPerMonth: '108.00',
      profitPerMonth: '31.00',
    });
  });

  it('tax added on top is passed on, tax inside the price is taken out of it', () => {
    const on = computeEconomics({
      prices: [price({ amount: 24.99, subscribers: 1 })],
      fees,
      monthlyCosts: 0,
      taxPercent: 16,
    });
    expect(on.prices[0]!.perSubscriberPerMonth).toMatchObject({ customerPays: '28.99', tax: '4.00' });
    const inside = computeEconomics({
      prices: [price({ amount: 24.99, taxInclusive: true, subscribers: 1 })],
      fees,
      monthlyCosts: 0,
      taxPercent: 16,
    });
    expect(inside.prices[0]!.perSubscriberPerMonth).toMatchObject({ customerPays: '24.99', tax: '3.45' });
  });

  it('compares channels: the iPhone price absorbs the store’s cut', () => {
    const r = computeEconomics({
      prices: [price({ channel: 'android' }), price({ channel: 'ios', amount: 4.99 })],
      fees,
      monthlyCosts: 0,
      taxPercent: 0,
    });
    expect(r.prices.map((p) => [p.channel, p.perSubscriberPerMonth.net])).toEqual([
      ['android', '1.69'],
      ['ios', '4.24'],
    ]);
  });

  it('yearly prices count per month; other currencies stay out of USD totals', () => {
    const r = computeEconomics({
      prices: [price({ interval: 'year', amount: 240 }), price({ currency: 'PKR', amount: 500 })],
      fees: { web: { percent: 0, fixedAmount: 0 } },
      monthlyCosts: 0,
      taxPercent: 0,
    });
    expect(r.prices[0]!.perSubscriberPerMonth.net).toBe('20.00');
    expect(r.prices[1]!.includedInTotals).toBe(false);
    expect(r.totals.netRevenuePerMonth).toBe('2000.00');
  });

  it('no paying subscribers: a loss equal to the costs, no margin', () => {
    const r = computeEconomics({
      prices: [price({ subscribers: 0 })],
      fees,
      monthlyCosts: 50,
      taxPercent: 0,
    });
    expect(r.totals).toMatchObject({ profitPerMonth: '-50.00', marginPercent: null });
  });
});

describe('reading plan values', () => {
  it('keeps only known keys; missing or malformed limits are unlimited, features off', () => {
    expect(
      readPlanValues(
        'business',
        { team_accounts: 3, services: -1, photos: 'x', bogus: 1 },
        { queue: true, ads: 'yes' },
      ),
    ).toEqual({
      limits: { team_accounts: 3, staff_profiles: null, services: null, photos: null },
      features: {
        queue: true,
        manual_approval: false,
        staff_photos: false,
        ads: false,
        priority_support: false,
      },
    });
  });
});
