import { describe, expect, it } from 'vitest';
import {
  clockTime,
  correctionProblems,
  duration,
  wallClock,
  zonedToIso,
} from '../src/features/manage/attendance';

/** Attendance (3.5g): times in the business's own zone, corrections checked as the API checks them. */

const KARACHI = 'Asia/Karachi';
const LONDON = 'Europe/London';

describe('times in the business’s zone', () => {
  it('reads a moment on the business’s clock', () => {
    expect(clockTime('2026-10-31T04:05:00Z', KARACHI)).toBe('09:05');
    expect(wallClock('2026-10-31T19:30:00Z', KARACHI)).toBe('2026-11-01T00:30');
  });

  it('turns the business’s wall clock back into the moment', () => {
    expect(zonedToIso('2026-10-31T09:05', KARACHI)).toBe('2026-10-31T04:05:00.000Z');
    // London on the last Sunday of October: summer time ends at 02:00, so 09:00 is GMT.
    expect(zonedToIso('2026-10-25T09:00', LONDON)).toBe('2026-10-25T09:00:00.000Z');
    expect(zonedToIso('2026-07-01T09:00', LONDON)).toBe('2026-07-01T08:00:00.000Z');
    expect(zonedToIso('not a time', KARACHI)).toBeNull();
  });

  it('says how long', () => {
    expect(duration(45)).toBe('45 min');
    expect(duration(420)).toBe('7 h');
    expect(duration(450)).toBe('7 h 30 min');
  });
});

describe('correcting a shift', () => {
  const now = Date.parse('2026-10-31T12:00:00Z'); // 17:00 in Karachi

  it('a clock-in and a later clock-out, both past, within a day', () => {
    expect(
      correctionProblems({ checkIn: '2026-10-31T09:00', checkOut: '2026-10-31T16:30' }, KARACHI, now),
    ).toEqual({});
    expect(correctionProblems({ checkIn: '2026-10-31T09:00', checkOut: '' }, KARACHI, now)).toEqual({});
  });

  it('refuses the future, an end before its start, and more than a day', () => {
    expect(correctionProblems({ checkIn: '2026-10-31T18:00', checkOut: '' }, KARACHI, now).checkIn).toBe(
      'That’s in the future.',
    );
    expect(
      correctionProblems({ checkIn: '2026-10-31T09:00', checkOut: '2026-10-31T08:00' }, KARACHI, now)
        .checkOut,
    ).toBe('Clocking out must be after clocking in.');
    expect(
      correctionProblems({ checkIn: '2026-10-29T09:00', checkOut: '2026-10-30T10:00' }, KARACHI, now)
        .checkOut,
    ).toBe('A shift can be at most 24 hours.');
    expect(correctionProblems({ checkIn: '', checkOut: '' }, KARACHI, now).checkIn).toBe(
      'Choose when they clocked in.',
    );
  });
});
