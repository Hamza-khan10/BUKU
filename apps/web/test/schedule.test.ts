import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  groupEntries,
  groupWhen,
  scheduleInput,
  scheduleProblems,
  type ScheduleEntry,
} from '../src/features/manage/schedule';

/** Closed days and time off (3.5e): stretches people think in, checked as the API checks them. */

const TODAY = '2026-10-31';
const day = (date: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: date,
  date,
  kind: 'time_off',
  startTime: null,
  endTime: null,
  reason: 'Eid',
  ...over,
});

describe('groupEntries', () => {
  it('joins consecutive whole days with the same reason into one stretch', () => {
    const groups = groupEntries([day('2026-11-12'), day('2026-11-10'), day('2026-11-11')]);
    expect(groups).toEqual([
      {
        ids: ['2026-11-10', '2026-11-11', '2026-11-12'],
        from: '2026-11-10',
        to: '2026-11-12',
        kind: 'time_off',
        startTime: null,
        endTime: null,
        reason: 'Eid',
      },
    ]);
  });

  it('keeps apart: a gap, another reason, another kind, and any part of a day', () => {
    const groups = groupEntries([
      day('2026-11-10'),
      day('2026-11-12'),
      day('2026-11-13', { reason: 'Repairs' }),
      day('2026-11-14', { reason: 'Repairs', kind: 'extra_hours', startTime: '18:00', endTime: '20:00' }),
      day('2026-11-15', { reason: 'Repairs', startTime: '09:00', endTime: '12:00' }),
      day('2026-11-16', { reason: 'Repairs', startTime: '09:00', endTime: '12:00' }),
    ]);
    expect(groups.map((g) => [g.from, g.to])).toEqual([
      ['2026-11-10', '2026-11-10'],
      ['2026-11-12', '2026-11-12'],
      ['2026-11-13', '2026-11-13'],
      ['2026-11-14', '2026-11-14'],
      ['2026-11-15', '2026-11-15'],
      ['2026-11-16', '2026-11-16'],
    ]);
  });

  it('says when, in words', () => {
    const [stretch] = groupEntries([day('2026-11-01'), day('2026-11-02'), day('2026-11-03')]);
    expect(groupWhen(stretch!, TODAY)).toBe('Tomorrow – Tue 3 Nov');
    const [part] = groupEntries([day('2026-10-31', { startTime: '14:00', endTime: '18:00' })]);
    expect(groupWhen(part!, TODAY)).toBe('Today, 14:00–18:00');
  });
});

describe('scheduleProblems', () => {
  const form = { from: '2026-11-10', to: '', partDay: false, startTime: '', endTime: '' };

  it('one day, or a stretch of whole days', () => {
    expect(scheduleProblems(form, TODAY)).toEqual({});
    expect(scheduleProblems({ ...form, to: '2026-11-12' }, TODAY)).toEqual({});
  });

  it('refuses no day, a day in the past, a last day before the first, and over two months', () => {
    expect(scheduleProblems({ ...form, from: '' }, TODAY).from).toBe('Choose the day.');
    expect(scheduleProblems({ ...form, from: '2026-10-30' }, TODAY).from).toBe(
      'Choose today or a later day.',
    );
    expect(scheduleProblems({ ...form, to: '2026-11-09' }, TODAY).to).toBe(
      'The last day can’t be before the first.',
    );
    expect(scheduleProblems({ ...form, to: '2027-01-11' }, TODAY).to).toBe('At most 62 days at once.');
    expect(scheduleProblems({ ...form, to: '2027-01-10' }, TODAY).to).toBeUndefined();
  });

  it('part of a day needs a start before its end', () => {
    const part = { ...form, partDay: true };
    expect(scheduleProblems({ ...part, startTime: '14:00', endTime: '18:00' }, TODAY)).toEqual({});
    expect(scheduleProblems(part, TODAY)).toEqual({
      startTime: 'Choose a start time.',
      endTime: 'Choose an end time.',
    });
    expect(scheduleProblems({ ...part, startTime: '18:00', endTime: '14:00' }, TODAY).endTime).toBe(
      'The end must be after the start.',
    );
  });

  it('extra hours always need times', () => {
    expect(scheduleProblems(form, TODAY, true).startTime).toBe('Choose a start time.');
  });
});

describe('scheduleInput', () => {
  const base = { from: '2026-11-10', to: '', partDay: false, startTime: '', endTime: '', reason: '' };

  it('sends only what applies', () => {
    expect(scheduleInput(base)).toEqual({ from: '2026-11-10' });
    expect(scheduleInput({ ...base, to: '2026-11-10' })).toEqual({ from: '2026-11-10' });
    expect(scheduleInput({ ...base, to: '2026-11-12', reason: '  Eid  ' })).toEqual({
      from: '2026-11-10',
      to: '2026-11-12',
      reason: 'Eid',
    });
    expect(
      scheduleInput({ ...base, to: '2026-11-12', partDay: true, startTime: '14:00', endTime: '18:00' }),
    ).toEqual({
      from: '2026-11-10',
      startTime: '14:00',
      endTime: '18:00',
    });
  });

  it('counts days with both ends', () => {
    expect(daysBetween('2026-11-10', '2026-11-10')).toBe(1);
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(3);
  });
});
