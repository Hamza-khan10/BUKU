import { describe, expect, it } from 'vitest';
import {
  cleanPhone,
  copyDay,
  currencyFor,
  dayLabel,
  defaultWeek,
  durationLabel,
  E164,
  parseCoordinates,
  parsePrice,
  weekFromApi,
  weekProblems,
  weekToApi,
  weekFromStaffDays,
  weekSummary,
  weekToStaffDays,
} from '@/features/manage/setup';

describe('Setting up a business: the week', () => {
  it('starts from Monday to Saturday, 9 to 6, Sunday closed', () => {
    const api = weekToApi(defaultWeek());
    expect(api).toHaveLength(6);
    expect(api.some((h) => h.dayOfWeek === 0)).toBe(false);
    expect(api[0]).toEqual({ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' });
  });

  it('round-trips the API hours, lunch breaks included; days not listed are closed', () => {
    const hours = [
      { dayOfWeek: 1, openTime: '14:00', closeTime: '18:00' },
      { dayOfWeek: 1, openTime: '09:00', closeTime: '13:00' },
      { dayOfWeek: 5, openTime: '10:00:00', closeTime: '16:00:00' },
    ];
    const week = weekFromApi(hours);
    expect(week[1]).toEqual({
      open: true,
      ranges: [
        { start: '09:00', end: '13:00' },
        { start: '14:00', end: '18:00' },
      ],
    });
    expect(week[2]?.open).toBe(false);
    expect(weekToApi(week)).toEqual([
      { dayOfWeek: 1, openTime: '09:00', closeTime: '13:00' },
      { dayOfWeek: 1, openTime: '14:00', closeTime: '18:00' },
      { dayOfWeek: 5, openTime: '10:00', closeTime: '16:00' },
    ]);
    expect(weekToStaffDays(week).map((d) => d.dayOfWeek)).toEqual([1, 5]);
  });

  it('says what is wrong with a day, in words', () => {
    const week = defaultWeek();
    week[2] = { open: true, ranges: [{ start: '18:00', end: '09:00' }] };
    week[3] = {
      open: true,
      ranges: [
        { start: '09:00', end: '14:00' },
        { start: '13:00', end: '18:00' },
      ],
    };
    week[4] = { open: true, ranges: [{ start: '', end: '18:00' }] };
    expect(weekProblems(week).days).toEqual({
      2: 'On Tuesday, closing has to be after opening.',
      3: 'On Wednesday, the two openings overlap.',
      4: 'Please choose both times for Thursday.',
    });
    const closed = Object.fromEntries(
      Object.entries(defaultWeek()).map(([d, v]) => [d, { ...v, open: false }]),
    );
    expect(weekProblems(closed).week).toBe('Open at least one day, so people can come.');
  });

  it('copies one day to others, and reads a day back', () => {
    const week = copyDay(
      { ...defaultWeek(), 1: { open: true, ranges: [{ start: '08:00', end: '12:00' }] } },
      1,
      [2, 3],
    );
    expect(dayLabel(week[3])).toBe('08:00 to 12:00');
    expect(dayLabel(week[0])).toBe('Closed');
  });
});

describe('Setting up a business: where it is and what it costs', () => {
  it('reads coordinates pasted from a map', () => {
    expect(parseCoordinates('31.5204, 74.3587')).toEqual({ lat: 31.5204, lng: 74.3587 });
    expect(parseCoordinates('(33.684422,73.047882)')).toEqual({ lat: 33.68442, lng: 73.04788 });
    expect(parseCoordinates('-33.8688 151.2093')).toEqual({ lat: -33.8688, lng: 151.2093 });
    expect(parseCoordinates('0, 0')).toBeNull();
    expect(parseCoordinates('95, 10')).toBeNull();
    expect(parseCoordinates('Gulberg, Lahore')).toBeNull();
  });

  it('starts the currency from the country, and cleans phone numbers and prices', () => {
    expect(currencyFor('PK')).toBe('PKR');
    expect(currencyFor('FR')).toBeNull();
    expect(cleanPhone('+92 (300) 123-4567')).toBe('+923001234567');
    expect(E164.test(cleanPhone('+92 300 1234567'))).toBe(true);
    expect(E164.test('03001234567')).toBe(false);
    expect(parsePrice('1,200')).toBe(1200);
    expect(parsePrice('1200.5')).toBe(1200.5);
    expect(parsePrice('12.345')).toBeNull();
    expect(parsePrice('free')).toBeNull();
    expect(durationLabel(45)).toBe('45 min');
    expect(durationLabel(90)).toBe('1 h 30 min');
    expect(durationLabel(120)).toBe('2 h');
  });
});

describe('Setting up a business: someone’s working hours', () => {
  it('reads the days the API keeps, and sums a week up', () => {
    const week = weekFromStaffDays([
      { dayOfWeek: 1, ranges: [{ start: '09:00:00', end: '17:00:00' }] },
      { dayOfWeek: 2, ranges: [{ start: '09:00', end: '17:00' }] },
      { dayOfWeek: 3, ranges: [{ start: '09:00', end: '17:00' }] },
    ]);
    expect(week[1]).toEqual({ open: true, ranges: [{ start: '09:00', end: '17:00' }] });
    expect(week[0]?.open).toBe(false);
    expect(weekSummary(week)).toBe('Mon to Wed, 09:00 to 17:00');
    expect(weekSummary(defaultWeek())).toBe('Mon to Sat, 09:00 to 18:00');
    expect(weekSummary(weekFromStaffDays([]))).toBe('No working hours yet');
    const odd = weekFromStaffDays([
      { dayOfWeek: 1, ranges: [{ start: '09:00', end: '13:00' }] },
      { dayOfWeek: 4, ranges: [{ start: '14:00', end: '18:00' }] },
    ]);
    expect(weekSummary(odd)).toBe('Mon, Thu, hours vary');
  });
});
