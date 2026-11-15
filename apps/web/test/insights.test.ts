import { describe, expect, it } from 'vitest';
import {
  everyWeek,
  hourLabel,
  hoursInOrder,
  niceTicks,
  percent,
  periodDates,
  periodOf,
  shortDate,
  weekdaysInOrder,
} from '../src/features/manage/insights';

describe('Insights', () => {
  it('takes only the three periods from the address; anything else is 90 days', () => {
    expect([periodOf('30'), periodOf('90'), periodOf('365')]).toEqual([30, 90, 365]);
    for (const raw of [undefined, '', '7', '366', '30 ', ['30'], '1e3']) expect(periodOf(raw)).toBe(90);
  });

  it('counts the period back from today, today included', () => {
    expect(periodDates(30, '2026-11-15')).toEqual({ from: '2026-10-17', to: '2026-11-15' });
    expect(periodDates(90, '2026-11-15')).toEqual({ from: '2026-08-18', to: '2026-11-15' });
    expect(periodDates(365, '2026-11-15')).toEqual({ from: '2025-11-16', to: '2026-11-15' });
  });

  it('lists every week the period touches, the quiet ones as zeros', () => {
    const busy = { weekOf: '2026-11-02', booked: 4, completed: 2, cancellations: 1, noShows: 1 };
    const weeks = everyWeek([busy], '2026-10-21', '2026-11-15');
    expect(weeks.map((w) => w.weekOf)).toEqual(['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09']);
    expect(weeks[2]).toEqual(busy);
    expect(weeks[0]).toEqual({ weekOf: '2026-10-19', booked: 0, completed: 0, cancellations: 0, noShows: 0 });
    // A year is 53 weeks at most, every one present.
    expect(everyWeek([], '2025-11-16', '2026-11-15')).toHaveLength(53);
  });

  it('reads the week Monday first, and the hours from the first to the last that had bookings', () => {
    const days = weekdaysInOrder([{ dayOfWeek: 0, cancellations: 2, noShows: 1 }]);
    expect(days.map((d) => d.name)).toEqual([
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]);
    expect(days[6]).toMatchObject({ day: 0, cancellations: 2, noShows: 1 });
    expect(days[0]).toMatchObject({ cancellations: 0, noShows: 0 });

    const hours = hoursInOrder([
      { hour: 13, cancellations: 1, noShows: 0 },
      { hour: 10, cancellations: 0, noShows: 2 },
    ]);
    expect(hours.map((h) => h.hour)).toEqual([10, 11, 12, 13]);
    expect(hours[1]).toEqual({ hour: 11, cancellations: 0, noShows: 0 });
    expect(hoursInOrder([])).toEqual([]);
  });

  it('labels hours, dates and rates the way people read them', () => {
    expect([0, 9, 12, 13, 23].map(hourLabel)).toEqual(['12 am', '9 am', '12 pm', '1 pm', '11 pm']);
    expect(shortDate('2026-11-02')).toBe('2 Nov');
    expect(shortDate('2026-11-02', true)).toBe('2 Nov 2026');
    expect([percent(6.4), percent(0), percent(null)]).toEqual(['6.4%', '0%', '–']);
  });

  it('gives a value axis whole, round steps up past the largest value', () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
    expect(niceTicks(38)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(130)).toEqual([0, 50, 100, 150]);
  });
});
