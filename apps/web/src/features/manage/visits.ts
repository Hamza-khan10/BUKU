import { can } from '@buku/validation';
import type { TeamRole } from './api';

/**
 * A business's visits (3.5b): what each visit is, where it stands, and what the front desk can
 * do with it right now (the calls are in visits-api.ts). The rules mirror the booking service (D-057, 2.3 part 3), so a
 * button only shows when the API would accept it; the API still decides.
 */

export type VisitStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show' | 'rescheduled';

/** One appointment as the team sees it (GET /v1/businesses/:id/appointments): a name, never contact details. */
export interface Visit {
  id: string;
  code: string;
  status: VisitStatus;
  customer: {
    id: string;
    name: string;
    reliability?: { label: string; showsUpPercent: number | null };
  };
  service: { id: string; name: string; durationMinutes: number };
  staff: { id: string; displayName: string } | null;
  startAt: string;
  endAt: string;
  local: { date: string; startTime: string; endTime: string; timezone: string };
  price: string;
  currency: string;
  notes: string | null;
  internalNotes: string | null;
  checkedInAt: string | null;
  cancellation: { cancelledBy: string | null; reason: string | null; late: boolean } | null;
  rescheduledFromId: string | null;
  createdAt: string;
}

/** A day's list (`date` is null for a search, which spans a month back to a year ahead). */
export interface VisitList {
  date: string | null;
  timezone: string;
  items: Visit[];
}

export interface VisitQuery {
  date?: string | undefined;
  /** Days from `date` (the calendar asks for a week: 7). */
  days?: number | undefined;
  staffId?: string | undefined;
  status?: VisitStatus | undefined;
  q?: string | undefined;
}

/**
 * "BK-7KQ2MX": what a receipt code looks like, read the way people type it (any case, with or
 * without "BK", the dash or spaces). Codes use the booking service's alphabet (no I, L, O, 0 or
 * 1, which are easy to confuse); anything else isn't a code.
 */
export function normaliseCode(input: string): string | null {
  if (/[^A-Za-z0-9\s-]/.test(input)) return null;
  const raw = input.toUpperCase().replace(/[\s-]/g, '');
  const body = raw.length === 8 && raw.startsWith('BK') ? raw.slice(2) : raw;
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(body) ? `BK-${body}` : null;
}

const CHECK_IN_OPENS_MS = 2 * 60 * 60_000;
/** The booking service's default; a business may set longer, and the API says so if it's too soon. */
export const NO_SHOW_GRACE_MINUTES = 15;

/** Where a visit stands, in the front desk's words. */
export type Stage = 'to_confirm' | 'booked' | 'here' | 'done' | 'missed' | 'cancelled' | 'moved';

export function stageOf(v: Visit): Stage {
  switch (v.status) {
    case 'pending':
      return 'to_confirm';
    case 'confirmed':
      return v.checkedInAt ? 'here' : 'booked';
    case 'completed':
      return 'done';
    case 'no_show':
      return 'missed';
    case 'cancelled':
      return 'cancelled';
    case 'rescheduled':
      return 'moved';
  }
}

export const STAGE_LABEL: Record<Stage, string> = {
  to_confirm: 'Waiting for you to confirm',
  booked: 'Booked',
  here: 'Here',
  done: 'Done',
  missed: 'Didn’t come',
  cancelled: 'Cancelled',
  moved: 'Moved to another time',
};

export type VisitAction = 'confirm' | 'decline' | 'check_in' | 'complete' | 'no_show' | 'cancel';

/**
 * What this person can do with this visit right now. Staff handle their own customers (the API
 * shows them only those); confirming, declining and cancelling are for the front desk and up.
 */
export function actionsFor(v: Visit, role: TeamRole, now = Date.now()): VisitAction[] {
  const all = can(role, 'appointments.manage_all');
  const start = Date.parse(v.startAt);
  const end = Date.parse(v.endAt);
  const actions: VisitAction[] = [];
  const checkInOpen = now >= start - CHECK_IN_OPENS_MS && now <= end;
  if (v.status === 'pending' && all) {
    if (checkInOpen) actions.push('check_in');
    actions.push('confirm', 'decline');
  }
  if (v.status === 'confirmed') {
    if (!v.checkedInAt && checkInOpen) actions.push('check_in');
    if (now >= start) actions.push('complete');
    if (!v.checkedInAt && now >= start + NO_SHOW_GRACE_MINUTES * 60_000) actions.push('no_show');
    if (!v.checkedInAt && all && now < end) actions.push('cancel');
  }
  return actions;
}

export interface DayCounts {
  booked: number;
  toConfirm: number;
  toCome: number;
  here: number;
  done: number;
  missed: number;
  cancelled: number;
}

/** The day at a glance: everything that still matters, and how it went. */
export function countDay(items: Visit[], now = Date.now()): DayCounts {
  const c: DayCounts = { booked: 0, toConfirm: 0, toCome: 0, here: 0, done: 0, missed: 0, cancelled: 0 };
  for (const v of items) {
    const stage = stageOf(v);
    if (stage === 'moved') continue;
    if (stage === 'cancelled') {
      c.cancelled++;
      continue;
    }
    c.booked++;
    if (stage === 'to_confirm') c.toConfirm++;
    if (stage === 'here') c.here++;
    if (stage === 'done') c.done++;
    if (stage === 'missed') c.missed++;
    if ((stage === 'booked' || stage === 'to_confirm') && Date.parse(v.endAt) > now) c.toCome++;
  }
  return c;
}

/** The next customer still to arrive, if any. */
export function nextUp(items: Visit[], now = Date.now()): Visit | null {
  return (
    items.find(
      (v) =>
        (v.status === 'confirmed' || v.status === 'pending') && !v.checkedInAt && Date.parse(v.endAt) > now,
    ) ?? null
  );
}

/** "YYYY-MM-DD" in a time zone. */
export function dateIn(timezone: string, at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** Moves a "YYYY-MM-DD" by whole days (calendar arithmetic, no time zone involved). */
export function shiftDate(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "Today", "Tomorrow", "Yesterday", or "Wed 15 Oct" (with the year when it isn't this one). */
export function dayLabel(date: string, today: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  if (date === today) return 'Today';
  if (date === shiftDate(today, 1)) return 'Tomorrow';
  if (date === shiftDate(today, -1)) return 'Yesterday';
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
      .formatToParts(new Date(`${date}T12:00:00Z`))
      .map((p) => [p.type, p.value]),
  );
  const label = `${parts.weekday} ${parts.day} ${parts.month}`;
  return date.slice(0, 4) === today.slice(0, 4) ? label : `${label} ${parts.year}`;
}

/** The full date, for headings: "Wednesday 14 October". */
export function longDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(`${date}T12:00:00Z`));
}
