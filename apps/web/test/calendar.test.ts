import { describe, expect, it } from 'vitest';
import { hoursShown, layDay, weekDays, weekLabel, weekStart } from '../src/features/manage/calendar';
import type { Visit } from '../src/features/manage/visits';

const visit = (id: string, start: string, end: string) =>
  ({ id, local: { date: '2026-11-04', startTime: start, endTime: end, timezone: 'Asia/Karachi' } }) as Visit;

describe('The calendar', () => {
  it('weeks start on Monday, whatever day is asked for', () => {
    expect(weekStart('2026-11-04')).toBe('2026-11-02'); // a Wednesday
    expect(weekStart('2026-11-02')).toBe('2026-11-02'); // a Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // a Sunday
    expect(weekDays('2026-11-02')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08',
    ]);
  });

  it('names the week across months and years', () => {
    expect(weekLabel('2026-11-02')).toBe('2 – 8 November 2026');
    expect(weekLabel('2026-10-26')).toBe('26 October – 1 November 2026');
    expect(weekLabel('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('shows 08:00–20:00, widened to whole hours around an early or late visit', () => {
    expect(hoursShown([])).toEqual({ from: 8, to: 20 });
    expect(hoursShown([visit('1', '06:45', '07:30'), visit('2', '20:15', '21:10')])).toEqual({
      from: 6,
      to: 22,
    });
    expect(hoursShown([visit('1', '23:00', '00:00')])).toEqual({ from: 8, to: 24 });
  });

  it('lays overlapping visits side by side, and the rest full width', () => {
    const placed = layDay(
      [
        visit('a', '10:00', '11:00'),
        visit('b', '10:30', '11:30'),
        visit('c', '10:45', '11:15'),
        visit('d', '12:00', '12:30'),
      ],
      8,
    );
    const by = Object.fromEntries(placed.map((p) => [p.visit.id, p]));
    expect([by.a!.lane, by.b!.lane, by.c!.lane]).toEqual([0, 1, 2]);
    expect([by.a!.lanes, by.b!.lanes, by.c!.lanes]).toEqual([3, 3, 3]);
    expect(by.d).toMatchObject({ lane: 0, lanes: 1, top: 4 * 60, height: 30 });
    // A visit that starts as another ends reuses its lane.
    const chain = layDay([visit('x', '09:00', '10:00'), visit('y', '10:00', '10:30')], 8);
    expect(chain.map((p) => [p.lane, p.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });
});
