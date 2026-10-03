import { describe, expect, it } from 'vitest';
import { businessReliability, customerShowUp } from '../src/reputation.js';

describe('Business reliability', () => {
  it('kept / (kept + cancelled by the business), shown from 10 decided bookings', () => {
    expect(businessReliability(9, 0)).toBeNull();
    expect(businessReliability(10, 0)).toEqual({ keptPercent: 100, basedOn: 10 });
    expect(businessReliability(97, 3)).toEqual({ keptPercent: 97, basedOn: 100 });
    expect(businessReliability(2, 1)).toBeNull();
    expect(businessReliability(0, 12)).toEqual({ keptPercent: 0, basedOn: 12 });
  });
});

describe('Customer show-up', () => {
  it('a no-show counts in full, a late cancellation half; new customers aren’t judged', () => {
    expect(customerShowUp({ visits: 2, noShows: 0, lateCancellations: 0 })).toEqual({
      showsUpPercent: null,
      basedOn: 2,
      label: 'New customer',
    });
    expect(customerShowUp({ visits: 19, noShows: 1, lateCancellations: 0 })).toMatchObject({
      showsUpPercent: 95,
    });
    expect(customerShowUp({ visits: 19, noShows: 0, lateCancellations: 2 })).toMatchObject({
      showsUpPercent: 95,
    });
    expect(customerShowUp({ visits: 0, noShows: 3, lateCancellations: 0 })).toMatchObject({
      showsUpPercent: 0,
      label: 'Shows up 0%',
    });
  });
});
