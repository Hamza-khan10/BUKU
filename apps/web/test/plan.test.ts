import { describe, expect, it } from 'vitest';
import type { MyPlan } from '../src/features/plan/api';
import { planStory, usageLines } from '../src/features/plan/story';

const base: MyPlan = {
  plan: { code: 'user_free', name: 'Free' },
  source: 'default',
  billingEnabled: true,
  subscription: null,
  features: {},
  usage: { visits: { used: 1, limit: 1, remaining: 0 } },
  trial: {
    available: true,
    reason: null,
    days: 30,
    plan: { code: 'user_plus', name: 'BUKU Plus' },
    endsAt: null,
  },
};
const sub = (over: Partial<NonNullable<MyPlan['subscription']>>): MyPlan['subscription'] => ({
  id: 's1',
  status: 'active',
  provider: 'paddle',
  channel: 'web',
  currentPeriodEnd: '2026-11-05T10:00:00Z',
  cancelAtPeriodEnd: false,
  ...over,
});
const plus = { code: 'user_plus', name: 'BUKU Plus' };

describe('what someone is told about their plan', () => {
  it('while paid plans are off: free for everyone, no limits, nothing else', () => {
    const p: MyPlan = {
      ...base,
      source: 'billing_off',
      billingEnabled: false,
      plan: { code: 'user_unlimited', name: 'Unlimited (billing off)' },
    };
    expect(planStory(p)).toMatchObject({
      title: 'Everything is free right now',
      managedIn: null,
      renewal: null,
    });
    expect(usageLines(p, { visits: 'Bookings and queue joins' })).toEqual([]);
  });

  it('the free plan: its name, and what’s used of its limits', () => {
    expect(planStory(base).title).toBe('You’re on Free');
    expect(usageLines(base, { visits: 'Bookings and queue joins' })).toEqual([
      { label: 'Bookings and queue joins', text: '1 of 1 used', full: true },
    ]);
    const unlimited: MyPlan = { ...base, usage: { visits: { used: 4, limit: null, remaining: null } } };
    expect(usageLines(unlimited, {})).toEqual([{ label: 'visits', text: '4 so far, no limit', full: false }]);
  });

  it('a trial: until when, and that nothing is charged after', () => {
    const p: MyPlan = { ...base, source: 'trial', plan: plus, subscription: sub({ provider: 'trial' }) };
    expect(planStory(p)).toMatchObject({
      title: 'You’re trying BUKU Plus',
      lines: ['Free until 5 Nov 2026. Then you’re back on the free plan; nothing is charged.'],
      managedIn: null,
    });
  });

  it('a plan given by BUKU: until when, with nothing to manage', () => {
    const p: MyPlan = {
      ...base,
      source: 'subscription',
      plan: plus,
      subscription: sub({ provider: 'manual' }),
    };
    expect(planStory(p)).toMatchObject({
      lines: ['Given to you by BUKU until 5 Nov 2026.'],
      managedIn: null,
      renewal: null,
    });
    const forever = { ...p, subscription: sub({ provider: 'manual', currentPeriodEnd: null }) };
    expect(planStory(forever).lines).toEqual(['Given to you by BUKU.']);
  });

  it('bought on the website: renews, or ends — and a failed payment is said first', () => {
    const p: MyPlan = { ...base, source: 'subscription', plan: plus, subscription: sub({}) };
    expect(planStory(p)).toMatchObject({
      lines: ['Renews on 5 Nov 2026.'],
      managedIn: 'website',
      renewal: 'renews',
      warning: null,
    });
    const ending = { ...p, subscription: sub({ cancelAtPeriodEnd: true }) };
    expect(planStory(ending)).toMatchObject({
      lines: ['Ends on 5 Nov 2026; it won’t renew.'],
      renewal: 'ends',
    });
    const late = { ...p, subscription: sub({ status: 'past_due' }) };
    expect(planStory(late).warning).toMatch(/didn’t go through/);
  });

  it('bought in the app: managed in its store, not here', () => {
    const p: MyPlan = {
      ...base,
      source: 'subscription',
      plan: plus,
      subscription: sub({ provider: 'google_play', channel: 'android' }),
    };
    expect(planStory(p)).toMatchObject({ managedIn: 'google_play', renewal: null });
    const ios = { ...p, subscription: sub({ provider: 'app_store', channel: 'ios' }) };
    expect(planStory(ios).managedIn).toBe('app_store');
  });
});
