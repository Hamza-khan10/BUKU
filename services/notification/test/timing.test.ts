import { describe, expect, it } from 'vitest';
import { dueReminder, type ReminderSettings } from '../src/scheduler/timing.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const start = new Date('2026-10-10T10:00:00Z');
const at = (msBeforeStart: number) => new Date(start.getTime() - msBeforeStart);
const on: ReminderSettings = { reminder24h: true, reminder2h: true, quiet: false };
const confirmed = (bookedAhead: number) => ({
  status: 'confirmed',
  startAt: start,
  createdAt: at(bookedAhead),
});
const pending = (bookedAhead: number) => ({ status: 'pending', startAt: start, createdAt: at(bookedAhead) });

describe('Appointment reminders: when they are due', () => {
  it('day before: from 24 h until 3 h before, for bookings made 30 h+ ahead', () => {
    const a = confirmed(5 * 24 * HOUR);
    expect(dueReminder(a, at(24 * HOUR + MIN), on)).toBeNull();
    expect(dueReminder(a, at(24 * HOUR), on)).toBe('r24');
    expect(dueReminder(a, at(3 * HOUR + MIN), on)).toBe('r24');
    expect(dueReminder(a, at(3 * HOUR), on)).toBeNull(); // too late: the "soon" one will go
  });

  it('soon: from 2 h until 20 min before, for bookings made 2½ h+ ahead', () => {
    const a = confirmed(5 * 24 * HOUR);
    expect(dueReminder(a, at(2 * HOUR), on)).toBe('r2');
    expect(dueReminder(a, at(20 * MIN), on)).toBe('r2');
    expect(dueReminder(a, at(19 * MIN), on)).toBeNull();
  });

  it('a booking made shortly before gets no reminder that would land right after its confirmation', () => {
    expect(dueReminder(confirmed(29 * HOUR), at(20 * HOUR), on)).toBeNull(); // no day-before
    expect(dueReminder(confirmed(29 * HOUR), at(2 * HOUR), on)).toBe('r2'); // still gets "soon"
    expect(dueReminder(confirmed(2 * HOUR), at(90 * MIN), on)).toBeNull(); // booked 2 h ahead: nothing
  });

  it('nothing at night, nothing when switched off, nothing for cancelled visits', () => {
    const a = confirmed(5 * 24 * HOUR);
    expect(dueReminder(a, at(10 * HOUR), { ...on, quiet: true })).toBeNull();
    expect(dueReminder(a, at(10 * HOUR), { ...on, reminder24h: false })).toBeNull();
    expect(dueReminder(a, at(HOUR), { ...on, reminder2h: false })).toBeNull();
    expect(dueReminder({ ...a, status: 'cancelled' }, at(HOUR), on)).toBeNull();
  });

  it('unanswered requests: approvers are nudged after 2 h, or once the visit is under 24 h away', () => {
    expect(dueReminder(pending(5 * 24 * HOUR), at(5 * 24 * HOUR - HOUR), on)).toBeNull(); // waited 1 h
    expect(dueReminder(pending(5 * 24 * HOUR), at(5 * 24 * HOUR - 2 * HOUR), on)).toBe('pending');
    expect(dueReminder(pending(30 * HOUR), at(23 * HOUR), on)).toBe('pending'); // under 24 h away
    expect(dueReminder(pending(10 * HOUR), at(10 * HOUR - 10 * MIN), on)).toBeNull(); // only 10 min old
    expect(dueReminder(pending(5 * HOUR), at(29 * MIN), on)).toBeNull(); // too close to matter
  });
});
