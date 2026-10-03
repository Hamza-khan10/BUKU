import { describe, expect, it } from 'vitest';
import { businessReliability } from '../src/reputation.js';

describe('Business reliability', () => {
  it('kept / (kept + cancelled by the business), shown from 10 decided bookings', () => {
    expect(businessReliability(9, 0)).toBeNull();
    expect(businessReliability(10, 0)).toEqual({ keptPercent: 100, basedOn: 10 });
    expect(businessReliability(97, 3)).toEqual({ keptPercent: 97, basedOn: 100 });
    expect(businessReliability(2, 1)).toBeNull();
    expect(businessReliability(0, 12)).toEqual({ keptPercent: 0, basedOn: 12 });
  });
});
