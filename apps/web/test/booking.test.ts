import { describe, expect, it } from 'vitest';
import {
  addDays,
  bookHref,
  byPartOfDay,
  choicesQuery,
  clockLabel,
  dayParts,
  daysBetween,
  NO_CHOICES,
  readChoices,
  todayIn,
} from '../src/features/booking/choices';

const SERVICE = '0190a0b2-7c4e-7a3e-9f00-000000000001';
const STAFF = '0190a0b2-7c4e-7a3e-9f00-000000000002';
const TIME = '2026-10-06T05:00:00.000Z';

describe('booking choices in the address', () => {
  it('reads every choice back exactly', () => {
    const c = readChoices(
      new URLSearchParams({ service: SERVICE, staff: STAFF, date: '2026-10-06', time: TIME }),
    );
    expect(c).toEqual({ serviceId: SERVICE, staffId: STAFF, date: '2026-10-06', startAt: TIME });
    expect(readChoices(new URLSearchParams(choicesQuery(c)))).toEqual(c);
  });

  it('ignores anything malformed instead of failing', () => {
    expect(readChoices({ service: 'haircut', staff: STAFF, date: '2026-10-06', time: TIME })).toEqual(
      NO_CHOICES,
    );
    expect(readChoices({ service: SERVICE, staff: 'anyone', date: '6/10/2026', time: 'soon' })).toEqual({
      ...NO_CHOICES,
      serviceId: SERVICE,
    });
    expect(readChoices({ service: [SERVICE, 'x'] }).serviceId).toBe(SERVICE);
    expect(readChoices({ service: SERVICE, date: '2026-02-30x' }).date).toBeNull();
  });

  it('writes only what is chosen, and nothing without a service', () => {
    expect(choicesQuery(NO_CHOICES)).toBe('');
    expect(choicesQuery({ ...NO_CHOICES, staffId: STAFF, date: '2026-10-06' })).toBe('');
    expect(bookHref('fade-masters', { serviceId: SERVICE })).toBe(`/b/fade-masters/book?service=${SERVICE}`);
    expect(bookHref('fade-masters')).toBe('/b/fade-masters/book');
  });
});

describe('days on the business’s calendar', () => {
  it('knows today where the business is, not where the visitor is', () => {
    const lateEvening = new Date('2026-10-05T20:30:00Z'); // 01:30 the next day in Karachi
    expect(todayIn('Asia/Karachi', lateEvening)).toBe('2026-10-06');
    expect(todayIn('America/New_York', lateEvening)).toBe('2026-10-05');
  });

  it('counts calendar days across months, years and daylight-saving changes', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09');
    expect(daysBetween('2026-10-05', '2026-10-19')).toBe(14);
    expect(daysBetween('2026-10-05', '2026-10-05')).toBe(0);
  });

  it('labels a day for the picker', () => {
    expect(dayParts('2026-10-05')).toEqual({
      weekday: 'Mon',
      day: '5',
      month: 'Oct',
      label: 'Monday 5 October',
    });
  });
});

describe('times', () => {
  it('groups them into morning, afternoon and evening, in order', () => {
    const slots = ['09:00', '11:45', '12:00', '16:59', '17:00', '20:15'].map((time) => ({ time }));
    expect(byPartOfDay(slots).map((g) => [g.part, g.slots.map((s) => s.time)])).toEqual([
      ['Morning', ['09:00', '11:45']],
      ['Afternoon', ['12:00', '16:59']],
      ['Evening', ['17:00', '20:15']],
    ]);
    expect(byPartOfDay([])).toEqual([]);
  });

  it('reads the business’s clock the way people say it', () => {
    expect(clockLabel('00:15')).toBe('12:15 am');
    expect(clockLabel('09:05')).toBe('9:05 am');
    expect(clockLabel('12:00')).toBe('12:00 pm');
    expect(clockLabel('17:30')).toBe('5:30 pm');
  });
});
