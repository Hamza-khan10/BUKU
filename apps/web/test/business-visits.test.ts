import { describe, expect, it } from 'vitest';
import {
  actionsFor,
  countDay,
  dateIn,
  dayLabel,
  longDate,
  nextUp,
  normaliseCode,
  shiftDate,
  stageOf,
  type Visit,
} from '../src/features/manage/visits';

const T = Date.parse('2026-10-14T10:00:00Z');
const MIN = 60_000;

function visit(over: Partial<Visit> & { startIn?: number; minutes?: number } = {}): Visit {
  const start = T + (over.startIn ?? 0) * MIN;
  const end = start + (over.minutes ?? 30) * MIN;
  return {
    id: over.id ?? 'v1',
    code: 'BK-7KQ2MX',
    status: 'confirmed',
    customer: { id: 'c1', name: 'Ayesha Noor' },
    service: { id: 's1', name: 'Haircut', durationMinutes: over.minutes ?? 30 },
    staff: { id: 'p1', displayName: 'Ali' },
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    local: { date: '2026-10-14', startTime: '15:00', endTime: '15:30', timezone: 'Asia/Karachi' },
    price: '800.00',
    currency: 'PKR',
    notes: null,
    internalNotes: null,
    checkedInAt: null,
    cancellation: null,
    rescheduledFromId: null,
    createdAt: new Date(T - 86_400_000).toISOString(),
    ...over,
  };
}

describe('booking codes', () => {
  it('read any way people type them', () => {
    for (const typed of ['BK-7KQ2MX', 'bk-7kq2mx', 'bk7kq2mx', '7kq2mx', ' BK 7KQ 2MX ']) {
      expect(normaliseCode(typed), typed).toBe('BK-7KQ2MX');
    }
  });
  it('refuse anything else', () => {
    for (const typed of ['', 'BK-7KQ2M', 'BK-7KQ2MXX', 'hello world', '<script>', 'BK-SCRIPT', 'BK-0OIL11']) {
      expect(normaliseCode(typed), typed).toBeNull();
    }
  });
});

describe('what the front desk can do, and when', () => {
  it('check-in opens two hours before and closes at the end', () => {
    expect(actionsFor(visit({ startIn: 121 }), 'front_desk', T)).not.toContain('check_in');
    expect(actionsFor(visit({ startIn: 120 }), 'front_desk', T)).toContain('check_in');
    expect(actionsFor(visit({ startIn: -30, minutes: 30 }), 'front_desk', T)).toContain('check_in');
    expect(actionsFor(visit({ startIn: -31, minutes: 30 }), 'front_desk', T)).not.toContain('check_in');
  });

  it('done from the start time; no-show only after 15 minutes and never once checked in', () => {
    expect(actionsFor(visit({ startIn: 1 }), 'front_desk', T)).not.toContain('complete');
    expect(actionsFor(visit({ startIn: 0 }), 'front_desk', T)).toContain('complete');
    expect(actionsFor(visit({ startIn: -14 }), 'front_desk', T)).not.toContain('no_show');
    expect(actionsFor(visit({ startIn: -15 }), 'front_desk', T)).toContain('no_show');
    const here = visit({ startIn: -20, checkedInAt: new Date(T - 25 * MIN).toISOString() });
    expect(actionsFor(here, 'front_desk', T)).toEqual(['complete']);
  });

  it('requests: confirm or decline (and check in on arrival) for the front desk and up', () => {
    const asked = visit({ status: 'pending', startIn: 60 });
    expect(actionsFor(asked, 'manager', T)).toEqual(['check_in', 'confirm', 'decline']);
    expect(actionsFor(visit({ status: 'pending', startIn: 600 }), 'owner', T)).toEqual([
      'confirm',
      'decline',
    ]);
    expect(actionsFor(asked, 'staff', T)).toEqual([]);
  });

  it('cancelling is for the front desk and up, before the visit ends, never once they arrived', () => {
    expect(actionsFor(visit({ startIn: 600 }), 'front_desk', T)).toEqual(['cancel']);
    expect(actionsFor(visit({ startIn: 600 }), 'staff', T)).toEqual([]);
    const here = visit({ startIn: 30, checkedInAt: new Date(T).toISOString() });
    expect(actionsFor(here, 'owner', T)).not.toContain('cancel');
  });

  it('finished visits have nothing left to do', () => {
    for (const status of ['completed', 'no_show', 'cancelled', 'rescheduled'] as const) {
      expect(actionsFor(visit({ status, startIn: -5 }), 'owner', T), status).toEqual([]);
    }
  });
});

describe('the day at a glance', () => {
  const day = [
    visit({ id: 'a', status: 'completed', startIn: -120 }),
    visit({ id: 'b', status: 'no_show', startIn: -90 }),
    visit({ id: 'c', startIn: -10, checkedInAt: new Date(T - 15 * MIN).toISOString() }),
    visit({ id: 'd', startIn: 30 }),
    visit({ id: 'e', status: 'pending', startIn: 60 }),
    visit({ id: 'f', status: 'cancelled', startIn: 90 }),
    visit({ id: 'g', status: 'rescheduled', startIn: 120 }),
  ];
  it('counts what still matters and how it went (moved bookings live at their new time)', () => {
    expect(countDay(day, T)).toEqual({
      booked: 5,
      toConfirm: 1,
      toCome: 2,
      here: 1,
      done: 1,
      missed: 1,
      cancelled: 1,
    });
  });
  it('names the next customer still to arrive', () => {
    expect(nextUp(day, T)?.id).toBe('d');
    expect(stageOf(day[2]!)).toBe('here');
  });
});

describe('days', () => {
  it('in the business’s own time zone', () => {
    const late = new Date('2026-10-14T20:30:00Z');
    expect(dateIn('Asia/Karachi', late)).toBe('2026-10-15');
    expect(dateIn('America/New_York', late)).toBe('2026-10-14');
  });
  it('move by calendar days and read naturally', () => {
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayLabel('2026-10-14', '2026-10-14')).toBe('Today');
    expect(dayLabel('2026-10-15', '2026-10-14')).toBe('Tomorrow');
    expect(dayLabel('2026-10-13', '2026-10-14')).toBe('Yesterday');
    expect(dayLabel('2026-10-20', '2026-10-14')).toBe('Tue 20 Oct');
    expect(dayLabel('2027-01-05', '2026-10-14')).toBe('Tue 5 Jan 2027');
  });
});

describe('dates that aren’t dates', () => {
  it('never throw (a page that hasn’t loaded its business yet has no "today")', () => {
    expect(longDate('')).toBe('');
    expect(dayLabel('', '')).toBe('');
    expect(shiftDate('', 1)).toBe('');
  });
});
