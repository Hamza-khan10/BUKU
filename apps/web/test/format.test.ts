import { describe, expect, it } from 'vitest';
import {
  distance,
  duration,
  money,
  monthLabel,
  openLabel,
  openState,
  wallClock,
  possessive,
} from '../src/lib/format';

const weekdays9to6 = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '09:00', closeTime: '18:00' }));

describe('formatting', () => {
  it('money in the business’s currency, without needless decimals', () => {
    expect(money('800.00', 'PKR')).toBe('Rs 800');
    expect(money(24.99, 'USD')).toBe('$24.99');
    expect(money(1500, 'USD')).toBe('$1,500');
  });

  it('durations people read at a glance', () => {
    expect(duration(15)).toBe('15 min');
    expect(duration(60)).toBe('1 h');
    expect(duration(90)).toBe('1 h 30 min');
  });

  it('distances', () => {
    expect(distance(0.42)).toBe('420 m');
    expect(distance(3.456)).toBe('3.5 km');
    expect(distance(12.6)).toBe('13 km');
  });

  it('months of a visit', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
  });
});

describe('opening hours, in the business’s timezone', () => {
  // Thursday 2026-10-08 10:30 in Karachi (UTC+5) = 05:30 UTC.
  const thursdayMorningKarachi = new Date('2026-10-08T05:30:00Z');

  it('reads the wall clock where the business is', () => {
    expect(wallClock('Asia/Karachi', thursdayMorningKarachi)).toEqual({ day: 4, time: '10:30' });
    expect(wallClock('America/New_York', thursdayMorningKarachi)).toEqual({ day: 4, time: '01:30' });
  });

  it('open now, until closing time', () => {
    const s = openState(weekdays9to6, 'Asia/Karachi', thursdayMorningKarachi);
    expect(s).toEqual({ open: true, closesAt: '18:00' });
    expect(openLabel(s, 4)).toBe('Open now · until 18:00');
  });

  it('closed: opens later today, tomorrow, or on a named day', () => {
    const early = new Date('2026-10-08T02:00:00Z'); // 07:00 Thursday in Karachi
    expect(openLabel(openState(weekdays9to6, 'Asia/Karachi', early), 4)).toBe('Closed · opens 09:00');
    const evening = new Date('2026-10-08T15:00:00Z'); // 20:00 Thursday
    expect(openLabel(openState(weekdays9to6, 'Asia/Karachi', evening), 4)).toBe(
      'Closed · opens tomorrow 09:00',
    );
    const saturdayNight = new Date('2026-10-10T16:00:00Z'); // 21:00 Saturday; closed Sunday
    expect(openLabel(openState(weekdays9to6, 'Asia/Karachi', saturdayNight), 6)).toBe(
      'Closed · opens Monday 09:00',
    );
  });

  it('split shifts and no hours at all', () => {
    const split = [
      { dayOfWeek: 4, openTime: '09:00', closeTime: '13:00' },
      { dayOfWeek: 4, openTime: '15:00', closeTime: '20:00' },
    ];
    const lunch = new Date('2026-10-08T09:00:00Z'); // 14:00 Thursday
    expect(openLabel(openState(split, 'Asia/Karachi', lunch), 4)).toBe('Closed · opens 15:00');
    expect(openLabel(openState([], 'Asia/Karachi', lunch), 4)).toBe('Closed');
  });
});

describe('possessives', () => {
  it('follow English: an apostrophe alone after a final s', () => {
    expect(possessive('Fade Masters')).toBe('Fade Masters’');
    expect(possessive('Noor Salon')).toBe('Noor Salon’s');
  });
});
