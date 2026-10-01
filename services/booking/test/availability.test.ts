import { describe, expect, it } from 'vitest';
import { computeSlots, subtract, type SlotQuery, type StaffSchedule } from '../src/availability/engine.js';
import { startOfDay, toInstant, wallClock } from '../src/availability/time.js';

const KHI = 'Asia/Karachi';
const LONDON = 'Europe/London';
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('local time ↔ instants', () => {
  it('converts Pakistan time (UTC+5, no daylight saving)', () => {
    expect(iso(toInstant('2026-10-05', '10:00', KHI))).toBe('2026-10-05T05:00:00.000Z');
    expect(wallClock(new Date('2026-10-05T05:00:00Z'), KHI)).toEqual({ date: '2026-10-05', time: '10:00' });
  });

  it('a time skipped when clocks jump forward does not exist', () => {
    // London, 28 Mar 2027: 01:00 GMT → 02:00 BST.
    expect(toInstant('2027-03-28', '01:30', LONDON)).toBeNull();
    expect(iso(toInstant('2027-03-28', '00:30', LONDON))).toBe('2027-03-28T00:30:00.000Z');
    expect(iso(toInstant('2027-03-28', '02:00', LONDON))).toBe('2027-03-28T01:00:00.000Z');
  });

  it('a time that happens twice when clocks fall back means the first one', () => {
    // London, 25 Oct 2026: 02:00 BST → 01:00 GMT, so 01:30 happens twice.
    expect(iso(toInstant('2026-10-25', '01:30', LONDON))).toBe('2026-10-25T00:30:00.000Z');
  });

  it('a day whose midnight is skipped starts at its first real minute', () => {
    // Chile moves clocks forward at midnight (first Sunday of September).
    expect(toInstant('2026-09-06', '00:00', 'America/Santiago')).toBeNull();
    expect(wallClock(startOfDay('2026-09-06', 'America/Santiago'), 'America/Santiago')).toEqual({
      date: '2026-09-06',
      time: '01:00',
    });
  });
});

describe('interval arithmetic', () => {
  it('subtracts holes and merges touching ranges', () => {
    expect(
      subtract(
        [
          [0, 10],
          [10, 20],
        ],
        [[5, 7]],
      ),
    ).toEqual([
      [0, 5],
      [7, 20],
    ]);
    expect(subtract([[0, 10]], [[0, 10]])).toEqual([]);
  });
});

/** A Monday in Lahore, with "now" far in the past so notice/horizon don't interfere. */
const MONDAY = '2026-10-05';
function query(overrides: Partial<SlotQuery> = {}, staff: Partial<StaffSchedule>[] = [{}]): SlotQuery {
  return {
    date: MONDAY,
    timezone: KHI,
    durationMinutes: 30,
    bufferMinutes: 0,
    stepMinutes: 15,
    earliest: new Date('2026-01-01T00:00:00Z'),
    latest: new Date('2027-01-01T00:00:00Z'),
    closures: [],
    staff: staff.map((s, i) => ({
      id: `staff-${i + 1}`,
      weekly: new Map([[1, [{ start: '09:00', end: '12:00' }]]]),
      timeOff: [],
      extraHours: [],
      busy: [],
      ...s,
    })),
    ...overrides,
  };
}
const times = (q: SlotQuery) => computeSlots(q).map((s) => s.time);
const at = (time: string) => toInstant(MONDAY, time, KHI)!.getTime();

describe('the slot calculator', () => {
  it('offers every step inside working hours where the service fits', () => {
    expect(times(query())).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '09:45',
      '10:00',
      '10:15',
      '10:30',
      '10:45',
      '11:00',
      '11:15',
      '11:30',
    ]);
    const first = computeSlots(query())[0]!;
    expect([iso(first.startAt), iso(first.endAt), first.staffIds]).toEqual([
      '2026-10-05T04:00:00.000Z',
      '2026-10-05T04:30:00.000Z',
      ['staff-1'],
    ]);
  });

  it('keeps room for the clean-up buffer, but the customer sees the real end', () => {
    const slots = computeSlots(query({ bufferMinutes: 10 }));
    expect(slots.at(-1)!.time).toBe('11:15'); // 11:15 + 30 + 10 = 11:55
    expect(slots[0]!.endAt.getTime() - slots[0]!.startAt.getTime()).toBe(30 * 60_000);
  });

  it('skips times that touch an existing appointment (including its buffer)', () => {
    const q = query({}, [{ busy: [[at('10:00'), at('10:40')]] }]);
    expect(times(q)).toEqual(['09:00', '09:15', '09:30', '10:45', '11:00', '11:15', '11:30']);
  });

  it('respects part-day time off, whole-day time off and business closures', () => {
    expect(times(query({}, [{ timeOff: [{ date: MONDAY, start: '10:00', end: '11:00' }] }]))).toEqual([
      '09:00',
      '09:15',
      '09:30',
      '11:00',
      '11:15',
      '11:30',
    ]);
    expect(times(query({}, [{ timeOff: [{ date: MONDAY }] }]))).toEqual([]);
    expect(times(query({ closures: [{ date: MONDAY }] }))).toEqual([]);
    // Time off on another day changes nothing.
    expect(times(query({}, [{ timeOff: [{ date: '2026-10-06' }] }]))).toHaveLength(11);
  });

  it('adds extra hours, and nothing on days without hours', () => {
    const extra = query({}, [{ extraHours: [{ date: MONDAY, start: '18:00', end: '19:00' }] }]);
    expect(times(extra).slice(-3)).toEqual(['18:00', '18:15', '18:30']);
    expect(times(query({ date: '2026-10-04' }))).toEqual([]); // Sunday
  });

  it('respects minimum notice and the booking horizon', () => {
    expect(times(query({ earliest: new Date(at('10:50')) }))[0]).toBe('11:00');
    expect(times(query({ latest: new Date(at('09:30')) }))).toEqual(['09:00', '09:15', '09:30']);
  });

  it('lists who is free at each time when several people do the service', () => {
    const slots = computeSlots(
      query({}, [
        {},
        { weekly: new Map([[1, [{ start: '11:00', end: '13:00' }]]]), busy: [[at('11:00'), at('11:30')]] },
      ]),
    );
    const at11 = slots.find((s) => s.time === '11:00')!;
    const at1130 = slots.find((s) => s.time === '11:30')!;
    expect(at11.staffIds).toEqual(['staff-1']);
    expect(at1130.staffIds).toEqual(['staff-1', 'staff-2']);
    expect(slots.at(-1)!.time).toBe('12:30');
  });

  it('stays correct across a daylight-saving change in the middle of the day', () => {
    // London, 28 Mar 2027: working 00:00–03:00 local is only 2 real hours.
    const q = query(
      {
        date: '2027-03-28',
        timezone: LONDON,
        durationMinutes: 60,
        stepMinutes: 60,
        earliest: new Date('2027-01-01T00:00:00Z'),
        latest: new Date('2028-01-01T00:00:00Z'),
      },
      [{ weekly: new Map([[0, [{ start: '00:00', end: '03:00' }]]]) }],
    );
    expect(computeSlots(q).map((s) => [s.time, iso(s.startAt)])).toEqual([
      ['00:00', '2027-03-28T00:00:00.000Z'],
      ['02:00', '2027-03-28T01:00:00.000Z'],
    ]);
  });
});
