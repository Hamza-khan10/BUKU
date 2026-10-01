import { describe, expect, it } from 'vitest';
import { estimateWaitMinutes, shouldAlert, ticketLabel } from '../src/alerts.js';

/** Replays a customer moving up the line and returns the counts they'd be alerted at. */
function alertsWhileMovingUp(startAhead: number): number[] {
  const sent: number[] = [];
  let last: number | null = null;
  for (let ahead = startAhead; ahead >= 0; ahead--) {
    if (shouldAlert(ahead, last)) {
      sent.push(ahead);
      last = ahead;
    }
  }
  return sent;
}

describe('"people ahead of you" alerts', () => {
  it('at 10, at 5, then every step', () => {
    expect(alertsWhileMovingUp(15)).toEqual([10, 5, 4, 3, 2, 1, 0]);
  });

  it('joining already close alerts at once, then follows the same rule', () => {
    expect(alertsWhileMovingUp(8)).toEqual([8, 5, 4, 3, 2, 1, 0]);
    expect(alertsWhileMovingUp(3)).toEqual([3, 2, 1, 0]);
  });

  it('never twice for the same count, and not when pushed back (priority lane)', () => {
    expect(shouldAlert(4, 4)).toBe(false);
    expect(shouldAlert(5, 4)).toBe(false);
    expect(shouldAlert(3, 4)).toBe(true);
    expect(shouldAlert(11, null)).toBe(false);
    expect(shouldAlert(9, 10)).toBe(false);
  });
});

describe('wait estimate and ticket label', () => {
  it('shares the people ahead among the staff on shift', () => {
    expect(estimateWaitMinutes(0, 300, 1)).toBe(0);
    expect(estimateWaitMinutes(4, 300, 1)).toBe(20);
    expect(estimateWaitMinutes(4, 300, 2)).toBe(10);
    expect(estimateWaitMinutes(4, 300, 0)).toBe(20); // nobody clocked in: assume one
  });

  it('formats tickets like A-023', () => {
    expect(ticketLabel('A', 23)).toBe('A-023');
    expect(ticketLabel('VIP', 1204)).toBe('VIP-1204');
  });
});
