import type { OpeningHours } from '@/lib/format';

/**
 * The plain rules behind setting up a business (3.5a): the opening-hours week as people edit
 * it, where the business is (coordinates), and sensible defaults. No React, so every rule is
 * unit-tested on its own.
 */

/** The days in the order people read a week here: Monday first (0 = Sunday, as the API counts). */
export const WEEK = [
  { day: 1, name: 'Monday', short: 'Mon' },
  { day: 2, name: 'Tuesday', short: 'Tue' },
  { day: 3, name: 'Wednesday', short: 'Wed' },
  { day: 4, name: 'Thursday', short: 'Thu' },
  { day: 5, name: 'Friday', short: 'Fri' },
  { day: 6, name: 'Saturday', short: 'Sat' },
  { day: 0, name: 'Sunday', short: 'Sun' },
] as const;

export interface Range {
  start: string;
  end: string;
}

/** One day as edited: open or closed, and its opening times (a lunch break makes two). */
export interface Day {
  open: boolean;
  ranges: Range[];
}

/** A week, by API day number (0 = Sunday … 6 = Saturday). */
export type Week = Record<number, Day>;

/** At most two openings a day (morning and afternoon) — more is rare, and the API allows four. */
export const MAX_RANGES = 2;

/** A usual week to start from: Monday to Saturday, 9 to 6; Sunday closed. */
export function defaultWeek(): Week {
  const week: Week = {};
  for (const { day } of WEEK) {
    week[day] = { open: day !== 0, ranges: [{ start: '09:00', end: '18:00' }] };
  }
  return week;
}

/** The week the API has (days not listed are closed); an empty list gives the usual week. */
export function weekFromApi(hours: readonly OpeningHours[]): Week {
  if (hours.length === 0) return defaultWeek();
  const week: Week = {};
  for (const { day } of WEEK) {
    const ranges = hours
      .filter((h) => h.dayOfWeek === day)
      .map((h) => ({ start: h.openTime.slice(0, 5), end: h.closeTime.slice(0, 5) }))
      .sort((a, b) => a.start.localeCompare(b.start));
    week[day] =
      ranges.length > 0
        ? { open: true, ranges }
        : { open: false, ranges: [{ start: '09:00', end: '18:00' }] };
  }
  return week;
}

/** The business's opening hours, as `PUT /v1/businesses/:id/hours` takes them. */
export function weekToApi(week: Week): OpeningHours[] {
  return WEEK.flatMap(({ day }) =>
    week[day]?.open
      ? week[day].ranges.map((r) => ({ dayOfWeek: day, openTime: r.start, closeTime: r.end }))
      : [],
  );
}

/** The same week as someone's working hours (`PUT …/staff/:staffId/hours`). */
export function weekToStaffDays(week: Week): { dayOfWeek: number; ranges: Range[] }[] {
  return WEEK.filter(({ day }) => week[day]?.open).map(({ day }) => ({
    dayOfWeek: day,
    ranges: week[day]!.ranges.map((r) => ({ ...r })),
  }));
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What's wrong with each day, in words (by day number), or nothing. Times must be real, each
 * opening must end after it starts, and two openings on one day can't overlap. At least one
 * day must be open, or nobody could ever come.
 */
export function weekProblems(week: Week): { days: Record<number, string>; week?: string } {
  const days: Record<number, string> = {};
  for (const { day, name } of WEEK) {
    const d = week[day];
    if (!d?.open) continue;
    if (d.ranges.some((r) => !TIME.test(r.start) || !TIME.test(r.end))) {
      days[day] = `Please choose both times for ${name}.`;
    } else if (d.ranges.some((r) => r.start >= r.end)) {
      days[day] = `On ${name}, closing has to be after opening.`;
    } else {
      const sorted = [...d.ranges].sort((a, b) => a.start.localeCompare(b.start));
      if (sorted.some((r, i) => i > 0 && r.start < sorted[i - 1]!.end)) {
        days[day] = `On ${name}, the two openings overlap.`;
      }
    }
  }
  const anyOpen = WEEK.some(({ day }) => week[day]?.open);
  return anyOpen ? { days } : { days, week: 'Open at least one day, so people can come.' };
}

/** Give other days the same hours as `from` (e.g. "the same every weekday"). */
export function copyDay(week: Week, from: number, to: readonly number[]): Week {
  const source = week[from];
  if (!source) return week;
  const next = { ...week };
  for (const day of to) next[day] = { open: source.open, ranges: source.ranges.map((r) => ({ ...r })) };
  return next;
}

/** "9:00 to 18:00, 14:00 to 18:00" — a day's hours as people say them. */
export function dayLabel(day: Day | undefined): string {
  if (!day?.open) return 'Closed';
  return day.ranges.map((r) => `${r.start} to ${r.end}`).join(', ');
}

/**
 * Where the business is, from what someone pasted: "31.5204, 74.3587" (as Google Maps copies
 * it), with or without the space, brackets or a degree sign. Null when it isn't a real place.
 */
export function parseCoordinates(text: string): { lat: number; lng: number } | null {
  const match = text
    .trim()
    .replace(/[()°]/g, '')
    .match(/^(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null;
  // 0, 0 is in the sea off Africa: never a business, almost always a mistake.
  if (lat === 0 && lng === 0) return null;
  return { lat: round(lat), lng: round(lng) };
}

/** Five decimals: about a metre, as precise as a phone's location is anyway. */
const round = (n: number) => Math.round(n * 100_000) / 100_000;

export const roundCoordinates = (lat: number, lng: number) => ({ lat: round(lat), lng: round(lng) });

/** "31.52040, 74.35870" — how a place is shown back to the person who set it. */
export const coordinatesLabel = ({ lat, lng }: { lat: number; lng: number }) =>
  `${lat.toFixed(5)}, ${lng.toFixed(5)}`;

/** A link that opens the place in Google Maps, to check it's the right spot. */
export const mapsLink = ({ lat, lng }: { lat: number; lng: number }) =>
  `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

/**
 * The currency a business in a country most likely uses, to start the choice from. Only a few
 * are listed: everyone else picks theirs (every ISO currency is offered).
 */
const CURRENCY_BY_COUNTRY: Record<string, string> = {
  PK: 'PKR',
  IN: 'INR',
  BD: 'BDT',
  AE: 'AED',
  SA: 'SAR',
  QA: 'QAR',
  OM: 'OMR',
  KW: 'KWD',
  BH: 'BHD',
  GB: 'GBP',
  US: 'USD',
  CA: 'CAD',
  AU: 'AUD',
  TR: 'TRY',
  MY: 'MYR',
};

export const currencyFor = (country: string): string | null => CURRENCY_BY_COUNTRY[country] ?? null;

/** A phone number as the API stores it (E.164): spaces, dashes and brackets removed. */
export function cleanPhone(text: string): string {
  return text.replace(/[\s()-]/g, '');
}

export const E164 = /^\+[1-9]\d{6,14}$/;

/** Service lengths to choose from, in minutes. */
export const DURATIONS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240] as const;

export function durationLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** A price as typed ("1,200", "1200.50") → the API's number, or null when it isn't one. */
export function parsePrice(text: string): number | null {
  const clean = text.replace(/[,\s]/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(clean)) return null;
  return Number(clean);
}

export interface Option {
  value: string;
  label: string;
}

/**
 * Countries by name, A to Z. Built on the server only and handed to the form: the browser's
 * own country names can differ from the server's ("Falkland Islands" or "Falkland Islands
 * (Islas Malvinas)"), and a page must look the same before and after it comes to life.
 */
export function countryOptions(codes: Iterable<string>): Option[] {
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  return [...codes]
    .map((value) => ({ value, label: names.of(value) ?? value }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Every currency, "Pakistani Rupee (PKR)" (server only, for the same reason). */
export function currencyOptions(): Option[] {
  const names = new Intl.DisplayNames(['en'], { type: 'currency' });
  return Intl.supportedValuesOf('currency').map((value) => ({
    value,
    label: `${names.of(value) ?? value} (${value})`,
  }));
}

/** Someone's working hours (as the API keeps them) as a week to edit; days not listed are off. */
export function weekFromStaffDays(days: readonly { dayOfWeek: number; ranges: readonly Range[] }[]): Week {
  const week: Week = {};
  for (const { day } of WEEK) {
    const ranges = (days.find((d) => d.dayOfWeek === day)?.ranges ?? []).map((r) => ({
      start: r.start.slice(0, 5),
      end: r.end.slice(0, 5),
    }));
    week[day] =
      ranges.length > 0
        ? { open: true, ranges }
        : { open: false, ranges: [{ start: '09:00', end: '18:00' }] };
  }
  return week;
}

/** Clean-up time after a service, in minutes (used for free times, never shown to customers). */
export const CLEANUP = [0, 5, 10, 15, 20, 30, 45, 60] as const;

/** "Mon to Sat, 09:00 to 18:00" when every working day is the same; otherwise the days, briefly. */
export function weekSummary(week: Week): string {
  const open = WEEK.filter(({ day }) => week[day]?.open);
  if (open.length === 0) return 'No working hours yet';
  const labels = new Set(open.map(({ day }) => dayLabel(week[day])));
  const days =
    open.length === 7
      ? 'Every day'
      : isRun(open.map((d) => d.day))
        ? `${open[0]!.short} to ${open.at(-1)!.short}`
        : open.map((d) => d.short).join(', ');
  return labels.size === 1 ? `${days}, ${[...labels][0]}` : `${days}, hours vary`;
}

/** Days next to each other in the week as people read it (Monday first). */
function isRun(days: number[]): boolean {
  const order = WEEK.map((w) => w.day as number);
  const at = days.map((d) => order.indexOf(d));
  return at.every((v, i) => i === 0 || v === at[i - 1]! + 1);
}
