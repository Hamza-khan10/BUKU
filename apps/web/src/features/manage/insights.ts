import type { CancelReason } from '@/features/booking/api';
import { DAY_NAMES, WEEK } from '@/lib/format';
import { weekStart } from './calendar';
import { shiftDate } from './visits';

/**
 * Insights (3.5j): the arithmetic behind the charts. Dates are the business's own calendar days
 * ("YYYY-MM-DD"), as the API counts them; nothing here knows about time zones.
 */

/** GET /v1/businesses/:id/insights/cancellations, as the API answers it. */
export interface CancellationReport {
  period: { from: string; to: string; timezone: string };
  totals: {
    booked: number;
    completed: number;
    upcoming: number;
    cancelledByCustomer: number;
    lateCancellations: number;
    cancelledByBusiness: number;
    declined: number;
    cancelledBySystem: number;
    noShows: number;
    moved: number;
  };
  /** Percentages with one decimal; null when there is nothing to divide by. */
  rates: {
    customerCancellation: number | null;
    lateCancellation: number | null;
    noShow: number | null;
    businessCancellation: number | null;
  };
  reasons: { reason: CancelReason | 'not_given'; count: number }[];
  byWeekday: { dayOfWeek: number; cancellations: number; noShows: number }[];
  byHour: { hour: number; cancellations: number; noShows: number }[];
  byService: Breakdown[];
  byStaff: Breakdown[];
  weekly: Week[];
  rebookLater: { asked: number; bookedAgain: number; rate: number | null };
}

export interface Breakdown {
  id: string;
  name: string;
  booked: number;
  cancellations: number;
  noShows: number;
  cancellationRate: number | null;
}

export interface Week {
  /** The Monday. */
  weekOf: string;
  booked: number;
  /** Visits that happened (done, or checked in). */
  completed: number;
  cancellations: number;
  noShows: number;
}

export type Period = 30 | 90 | 365;

export const PERIODS: { days: Period; label: string }[] = [
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '12 months' },
];

/** The period in the address: one of the three, anything else is the default (90 days). */
export function periodOf(raw: unknown): Period {
  return raw === '30' ? 30 : raw === '365' ? 365 : 90;
}

/** "The last N days", ending today by the business's calendar: what the API is asked for. */
export const periodDates = (days: Period, today: string) => ({
  from: shiftDate(today, -(days - 1)),
  to: today,
});

/**
 * Every week the period touches, Monday first, the quiet ones as zeros: the API only answers weeks
 * that had bookings, and a gap on a time axis would read as no gap at all.
 */
export function everyWeek(weekly: Week[], from: string, to: string): Week[] {
  const byMonday = new Map(weekly.map((w) => [w.weekOf, w]));
  const weeks: Week[] = [];
  for (let monday = weekStart(from); monday <= to; monday = shiftDate(monday, 7)) {
    weeks.push(
      byMonday.get(monday) ?? { weekOf: monday, booked: 0, completed: 0, cancellations: 0, noShows: 0 },
    );
  }
  return weeks;
}

/** Monday to Sunday, as people read a week (the API's days are 0 = Sunday). */
export function weekdaysInOrder(byWeekday: CancellationReport['byWeekday']) {
  return WEEK.map((day) => {
    const d = byWeekday.find((x) => x.dayOfWeek === day);
    return { day, name: DAY_NAMES[day], cancellations: d?.cancellations ?? 0, noShows: d?.noShows ?? 0 };
  });
}

/**
 * The hours from the first to the last that had any booking, the quiet ones between as zeros (the
 * API only answers hours that had bookings). Empty when nothing was booked.
 */
export function hoursInOrder(byHour: CancellationReport['byHour']) {
  if (byHour.length === 0) return [];
  const first = Math.min(...byHour.map((h) => h.hour));
  const last = Math.max(...byHour.map((h) => h.hour));
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const hour = first + i;
    const h = byHour.find((x) => x.hour === hour);
    return { hour, cancellations: h?.cancellations ?? 0, noShows: h?.noShows ?? 0 };
  });
}

/** 9 → "9 am", 12 → "12 pm", 0 → "12 am". */
export function hourLabel(hour: number): string {
  return `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'am' : 'pm'}`;
}

/** "3 Nov"; with `year`, "3 Nov 2026". */
export function shortDate(date: string, year = false): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    ...(year && { year: 'numeric' }),
  }).format(new Date(`${date}T12:00:00Z`));
}

/** Why customers cancelled, as the business reads it (the customer chose these in their own words). */
export const REASON_LABEL: Record<CancellationReport['reasons'][number]['reason'], string> = {
  schedule_conflict: 'Something else came up',
  illness: 'Unwell',
  found_alternative: 'Found another time or place',
  not_needed: 'Didn’t need it any more',
  too_expensive: 'Cost more than expected',
  other: 'Another reason',
  not_given: 'No reason given',
};

/** "6.4%"; "–" when there is nothing to count yet. */
export const percent = (rate: number | null) => (rate === null ? '–' : `${rate}%`);

/**
 * A clean top for a value axis and the ticks up to it: 0, then whole steps of 1, 2 or 5 × 10ⁿ,
 * about `count` of them. A chart of zeros still gets an axis (0 to 1).
 */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / count;
  const power = 10 ** Math.floor(Math.log10(rough));
  // Whole numbers only: these are counts of visits.
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * power >= rough) ?? 10) * power);
  const ticks = [0];
  while (ticks[ticks.length - 1]! < max) ticks.push(ticks[ticks.length - 1]! + step);
  return ticks;
}
