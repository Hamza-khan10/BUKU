import { describe, expect, it } from 'vitest';
import type { Receipt } from '../src/features/booking/types';
import { reviewable, reviewerName, visited } from '../src/features/reviews/rules';

const DAY = 86_400_000;
const now = Date.parse('2026-10-20T12:00:00Z');

const visit = (over: Partial<Receipt>): Receipt =>
  ({
    status: 'completed',
    checkedInAt: null,
    startAt: new Date(now - 3 * DAY).toISOString(),
    ...over,
  }) as Receipt;

describe('which visits can be reviewed (the API’s rules)', () => {
  it('a visit that happened: completed, or checked in and started', () => {
    expect(visited(visit({}), now)).toBe(true);
    expect(
      visited(visit({ status: 'confirmed', checkedInAt: new Date(now - 3 * DAY).toISOString() }), now),
    ).toBe(true);
    expect(visited(visit({ status: 'confirmed' }), now)).toBe(false);
    expect(
      visited(
        visit({
          status: 'confirmed',
          checkedInAt: new Date(now).toISOString(),
          startAt: new Date(now + DAY).toISOString(),
        }),
        now,
      ),
    ).toBe(false);
    for (const status of ['cancelled', 'no_show', 'rescheduled', 'pending'] as const) {
      expect(visited(visit({ status }), now)).toBe(false);
    }
  });

  it('up to 30 days afterwards', () => {
    expect(reviewable(visit({ startAt: new Date(now - 30 * DAY).toISOString() }), now)).toBe(true);
    expect(reviewable(visit({ startAt: new Date(now - 31 * DAY).toISOString() }), now)).toBe(false);
  });
});

describe('how a reviewer is shown', () => {
  it('first name and last initial, never the full name (as the API does)', () => {
    expect(reviewerName('Ayesha Noor Khan')).toBe('Ayesha K.');
    expect(reviewerName('  sana   malik ')).toBe('sana M.');
    expect(reviewerName('Madonna')).toBe('Madonna');
  });
});
