/**
 * Formatting shared by every screen. Times are always shown in the
 * business's own timezone (where the visit happens), with a fixed locale, so
 * the server and the browser render the same text.
 */

const LOCALE = 'en-GB';

/** "Rs 800", "$24.99" — no decimals when there are none to show. */
export function money(amount: number | string, currency: string): string {
  const value = typeof amount === 'string' ? Number(amount) : amount;
  const whole = Number.isInteger(value);
  return new Intl.NumberFormat(LOCALE, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(value);
}

/** "30 min", "1 h", "1 h 30 min". */
export function duration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** "4.5" (one decimal, never "4.50" or "4"). */
export const ratingValue = (average: number) => average.toFixed(1);

/** Monday first, as people read a week; API days are 0 = Sunday … 6 = Saturday. */
export const WEEK = [1, 2, 3, 4, 5, 6, 0] as const;
export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export interface OpeningHours {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
}

/** Day of week and "HH:MM" right now in a timezone. */
export function wallClock(timezone: string, now = new Date()): { day: number; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { day, time: `${get('hour')}:${get('minute')}` };
}

/** Today's opening periods (split shifts allowed), in order. */
export function hoursOn(hours: OpeningHours[], day: number): OpeningHours[] {
  return hours.filter((h) => h.dayOfWeek === day).sort((a, b) => a.openTime.localeCompare(b.openTime));
}

export type OpenState =
  { open: true; closesAt: string } | { open: false; opensAt: string | null; opensDay: number | null };

/** Open right now, and until when — or when it opens next (within a week). */
export function openState(hours: OpeningHours[], timezone: string, now = new Date()): OpenState {
  const { day, time } = wallClock(timezone, now);
  const current = hoursOn(hours, day).find((h) => h.openTime <= time && time < h.closeTime);
  if (current) return { open: true, closesAt: current.closeTime };
  const laterToday = hoursOn(hours, day).find((h) => h.openTime > time);
  if (laterToday) return { open: false, opensAt: laterToday.openTime, opensDay: day };
  for (let i = 1; i <= 7; i++) {
    const d = (day + i) % 7;
    const first = hoursOn(hours, d)[0];
    if (first) return { open: false, opensAt: first.openTime, opensDay: d };
  }
  return { open: false, opensAt: null, opensDay: null };
}

/** "Open now · until 18:00" / "Closed · opens 09:00" / "Closed · opens Monday 09:00". */
export function openLabel(state: OpenState, today: number): string {
  if (state.open) return `Open now · until ${state.closesAt}`;
  if (!state.opensAt || state.opensDay === null) return 'Closed';
  if (state.opensDay === today) return `Closed · opens ${state.opensAt}`;
  if (state.opensDay === (today + 1) % 7) return `Closed · opens tomorrow ${state.opensAt}`;
  return `Closed · opens ${DAY_NAMES[state.opensDay]} ${state.opensAt}`;
}

/** "September 2026" from "2026-09". */
export function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  if (!y || !m) return yearMonth;
  return new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(y, m - 1, 1)),
  );
}

/** "5 km", "800 m". */
export function distance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
