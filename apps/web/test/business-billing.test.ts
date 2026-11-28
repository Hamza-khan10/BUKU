import { describe, expect, it } from 'vitest';
import {
  meter,
  planAction,
  safePaymentUrl,
  standing,
  type BusinessBilling,
  type Subscription,
} from '../src/features/manage/billing';

const day = (iso: string) => iso.slice(0, 10);

const billing = (over: Partial<BusinessBilling> = {}): BusinessBilling => ({
  plan: { code: 'business_free', name: 'Starter' },
  source: 'default',
  billingEnabled: true,
  subscription: null,
  features: {},
  usage: {},
  trial: { available: false, reason: null, days: 30, plan: null, endsAt: null },
  pendingPlanRequest: null,
  ...over,
});

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: '1',
  status: 'active',
  provider: 'paddle',
  channel: 'web',
  currentPeriodEnd: '2026-12-15T10:00:00.000Z',
  cancelAtPeriodEnd: false,
  ...over,
});

const essential = billing({
  plan: { code: 'business_essential', name: 'Essential' },
  source: 'subscription',
  subscription: sub(),
});

describe('A business’s plan', () => {
  it('says where the business stands, in each case', () => {
    expect(standing(billing({ source: 'billing_off', billingEnabled: false }), day).title).toBe(
      'Everything is included',
    );
    expect(standing(billing(), day)).toEqual({
      title: 'Starter',
      detail: 'The free plan. Choose a plan when you need more.',
    });
    const trial = billing({
      plan: { code: 'business_professional', name: 'Professional' },
      source: 'trial',
      subscription: sub({ provider: 'trial', status: 'trialing' }),
    });
    expect(standing(trial, day).title).toBe('Professional, free trial');
    expect(standing(trial, day).detail).toContain('Free until 2026-12-15');
    expect(standing(essential, day).detail).toBe('Renews on 2026-12-15.');
    expect(standing({ ...essential, subscription: sub({ cancelAtPeriodEnd: true }) }, day).detail).toBe(
      'Ends on 2026-12-15; you won’t be charged again.',
    );
    expect(standing({ ...essential, subscription: sub({ status: 'past_due' }) }, day).detail).toContain(
      'Update your card',
    );
    expect(standing({ ...essential, subscription: sub({ provider: 'app_store' }) }, day).detail).toBe(
      'Renews on 2026-12-15, through the App Store.',
    );
    const granted = { ...essential, subscription: sub({ provider: 'manual', currentPeriodEnd: null }) };
    expect(standing(granted, day)).toEqual({
      title: 'Essential, from BUKU',
      detail: 'Given by BUKU, free, with no end date.',
    });
  });

  it('fills a meter, nearly full at 80%, full at the limit; no limit, no meter', () => {
    expect(meter({ used: 1, limit: 3, remaining: 2 })).toMatchObject({
      tone: 'ok',
      text: '1 of 3',
      state: null,
    });
    expect(meter({ used: 4, limit: 5, remaining: 1 })).toMatchObject({ tone: 'wait', state: 'Nearly full' });
    expect(meter({ used: 5, limit: 5, remaining: 0 })).toMatchObject({
      share: 1,
      tone: 'danger',
      state: 'At the limit',
    });
    // Over a limit after a downgrade: still full, never past the end.
    expect(meter({ used: 7, limit: 5, remaining: 0 }).share).toBe(1);
    expect(meter({ used: 0, limit: 0, remaining: 0 })).toMatchObject({ share: 1, tone: 'danger' });
    expect(meter({ used: 12, limit: null, remaining: null })).toEqual({
      share: null,
      tone: 'ok',
      text: '12, no limit',
      state: null,
    });
  });

  it('offers on each plan only what the API would accept', () => {
    const paid = { code: 'business_professional', free: false };
    const free = { code: 'business_free', free: true };
    // On the free plan: buy online; the free plan is where they are.
    expect(planAction(paid, billing(), true)).toBe('checkout');
    expect(planAction(free, billing(), true)).toBe('current');
    // Enterprise is priced for each chain: asked for, never bought online.
    const quoted = { code: 'business_enterprise', free: false, byRequest: true };
    expect(planAction(quoted, billing(), true)).toBeNull();
    expect(
      planAction(quoted, { ...essential, plan: { code: 'business_enterprise', name: 'Enterprise' } }, true),
    ).toBe('current');
    // Paying on the web: switch; paying in an app store: change it there.
    expect(planAction(paid, essential, true)).toBe('change');
    expect(planAction(free, essential, true)).toBeNull(); // cancelling is how to go back
    expect(planAction(paid, { ...essential, subscription: sub({ provider: 'google_play' }) }, true)).toBe(
      'store',
    );
    // A trial or a grant from BUKU: buying online is still open.
    expect(planAction(paid, { ...essential, subscription: sub({ provider: 'manual' }) }, true)).toBe(
      'checkout',
    );
    // Not the owner, or BUKU isn't charging: nothing to press.
    expect(planAction(paid, billing(), false)).toBeNull();
    expect(planAction(paid, billing({ source: 'billing_off', billingEnabled: false }), true)).toBeNull();
    expect(planAction(free, billing({ source: 'billing_off', billingEnabled: false }), true)).toBeNull();
  });

  it('follows a payment link only to this site or Paddle, over https', () => {
    const origin = 'https://buku.pk';
    expect(safePaymentUrl('https://buku.pk/checkout?_ptxn=txn_1', origin)).toBe(
      'https://buku.pk/checkout?_ptxn=txn_1',
    );
    expect(safePaymentUrl('https://customer-portal.paddle.com/cpl_1', origin)).toBe(
      'https://customer-portal.paddle.com/cpl_1',
    );
    expect(safePaymentUrl('http://localhost:3000/checkout?_ptxn=x', 'http://localhost:3000')).toBe(
      'http://localhost:3000/checkout?_ptxn=x',
    );
    for (const bad of [
      'http://customer-portal.paddle.com/x',
      'https://paddle.com.evil.example/x',
      'https://evilpaddle.com/x',
      'javascript:alert(1)',
      'https://buku.pk.evil.example/checkout',
      'not a url',
    ])
      expect(safePaymentUrl(bad, origin)).toBeNull();
  });
});
