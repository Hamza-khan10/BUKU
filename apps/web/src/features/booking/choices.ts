/**
 * What someone has chosen so far on the booking page lives in its address
 * (`/b/salt-and-pepper/book?service=…&staff=…&date=…&time=…`), so a refresh,
 * the back button, sharing the link or signing in halfway never loses it.
 * Pure: read the same way on the server and in the browser, and tested.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface BookingChoices {
  serviceId: string | null;
  /** A person, or null for "anyone available". */
  staffId: string | null;
  /** The day, in the business's own calendar ("2026-10-06"). */
  date: string | null;
  /** The chosen start time, exactly as the API offered it (ISO, with offset). */
  startAt: string | null;
}

export const NO_CHOICES: BookingChoices = { serviceId: null, staffId: null, date: null, startAt: null };

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string): string | undefined {
  if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

const validDate = (v: string | undefined) =>
  v && DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) ? v : null;
const validTime = (v: string | undefined) => (v && v.length <= 40 && !Number.isNaN(Date.parse(v)) ? v : null);

/** The choices in an address; anything malformed is simply not chosen yet. */
export function readChoices(params: Params): BookingChoices {
  const service = get(params, 'service');
  const staff = get(params, 'staff');
  const serviceId = service && UUID.test(service) ? service : null;
  return {
    serviceId,
    staffId: serviceId && staff && UUID.test(staff) ? staff : null,
    date: serviceId ? validDate(get(params, 'date')) : null,
    startAt: serviceId ? validTime(get(params, 'time')) : null,
  };
}

/** The address for these choices (only what is chosen; in the order people choose). */
export function choicesQuery(c: BookingChoices): string {
  const params = new URLSearchParams();
  if (c.serviceId) params.set('service', c.serviceId);
  if (c.serviceId && c.staffId) params.set('staff', c.staffId);
  if (c.serviceId && c.date) params.set('date', c.date);
  if (c.serviceId && c.startAt) params.set('time', c.startAt);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const bookHref = (slug: string, c: Partial<BookingChoices> = {}) =>
  `/b/${slug}/book${choicesQuery({ ...NO_CHOICES, ...c })}`;

// ── Days ──────────────────────────────────────────────────────────────────

/** "2026-10-06" today in a time zone (the business's calendar, not the visitor's). */
export function todayIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** A calendar day `n` days after `date` ("2026-10-06" + 3 → "2026-10-09"). */
export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from one calendar date to another. */
export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);

/** "Mon", "6", "Oct" — a day as the day picker shows it (calendar maths only, no time zones). */
export function dayParts(date: string): { weekday: string; day: string; month: string; label: string } {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { ...o, timeZone: 'UTC' }).format(d);
  return {
    weekday: f({ weekday: 'short' }),
    day: f({ day: 'numeric' }),
    month: f({ month: 'short' }),
    label: f({ weekday: 'long', day: 'numeric', month: 'long' }),
  };
}

/** Days shown at a time on the day picker. */
export const WINDOW_DAYS = 14;

/** The first day of the two-week window a day falls in, counted from today (windows never overlap). */
export const windowFor = (today: string, date: string | null) =>
  date && date >= today
    ? addDays(today, Math.floor(daysBetween(today, date) / WINDOW_DAYS) * WINDOW_DAYS)
    : today;

// ── Times ─────────────────────────────────────────────────────────────────

export type DayPart = 'Morning' | 'Afternoon' | 'Evening';

/** Times grouped the way people think about a day ("10:30" is morning, "17:00" evening). */
export function byPartOfDay<T extends { time: string }>(slots: T[]): { part: DayPart; slots: T[] }[] {
  const part = (time: string): DayPart => {
    const hour = Number(time.slice(0, 2));
    return hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';
  };
  const groups: { part: DayPart; slots: T[] }[] = [];
  for (const slot of slots) {
    const p = part(slot.time);
    const last = groups.at(-1);
    if (last?.part === p) last.slots.push(slot);
    else groups.push({ part: p, slots: [slot] });
  }
  return groups;
}

/** "10:30" → "10:30 am" (the business's local wall-clock time, as the API gives it). */
export function clockLabel(time: string): string {
  const [h = 0, m = 0] = time.split(':').map(Number);
  const suffix = h < 12 ? 'am' : 'pm';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}
