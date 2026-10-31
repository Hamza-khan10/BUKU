/**
 * Who worked when (3.5g): clocking in and out, and the day's shifts, as the attendance API keeps
 * them. Times are shown, and corrected, in the business's own time zone.
 */

export interface Shift {
  id: string;
  staffId: string;
  displayName: string;
  checkInAt: string;
  checkOutAt: string | null;
  open: boolean;
  /** Minutes worked (so far, if still open). */
  minutes: number;
  note: string | null;
}

export interface ShiftDay {
  date: string;
  timezone: string;
  items: Shift[];
}

/** Someone clocked in now. */
export interface Present {
  staffId: string;
  displayName: string;
  since: string;
}

/** The API's limit: a shift is at most a day long. */
export const MAX_SHIFT_HOURS = 24;

/** "45 min", "7 h", "7 h 30 min". */
export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** "14:05" in the business's time zone. */
export function clockTime(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(
    new Date(iso),
  );
}

/** "2026-10-31T14:05", the business's wall clock (for a datetime-local field). */
export function wallClock(iso: string, timezone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** The business's offset from UTC at an instant, in minutes (Karachi: +300). */
function offsetMinutes(at: number, timezone: string): number {
  const wall = wallClock(new Date(at).toISOString(), timezone);
  return Math.round((Date.parse(`${wall}:00Z`) - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/**
 * The instant a wall-clock time in the business's time zone means, as ISO ("2026-10-31T09:05:00.000Z"),
 * or null if the text isn't a time. Checked once more after a guess, for the days clocks change.
 */
export function zonedToIso(local: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const asUtc = Date.parse(`${local}:00Z`);
  if (Number.isNaN(asUtc)) return null;
  let at = asUtc - offsetMinutes(asUtc, timezone) * 60_000;
  at = asUtc - offsetMinutes(at, timezone) * 60_000;
  return new Date(at).toISOString();
}

/** A correction's problems, as the API would refuse them. */
export function correctionProblems(
  form: { checkIn: string; checkOut: string },
  timezone: string,
  now: number,
): Partial<Record<'checkIn' | 'checkOut', string>> {
  const problems: Partial<Record<'checkIn' | 'checkOut', string>> = {};
  const inAt = zonedToIso(form.checkIn, timezone);
  const outAt = form.checkOut ? zonedToIso(form.checkOut, timezone) : null;
  if (!inAt) problems.checkIn = 'Choose when they clocked in.';
  else if (Date.parse(inAt) > now) problems.checkIn = 'That’s in the future.';
  if (form.checkOut && !outAt) problems.checkOut = 'Choose when they clocked out.';
  else if (outAt) {
    if (Date.parse(outAt) > now) problems.checkOut = 'That’s in the future.';
    else if (inAt && Date.parse(outAt) <= Date.parse(inAt))
      problems.checkOut = 'Clocking out must be after clocking in.';
    else if (inAt && Date.parse(outAt) - Date.parse(inAt) > MAX_SHIFT_HOURS * 3_600_000)
      problems.checkOut = `A shift can be at most ${MAX_SHIFT_HOURS} hours.`;
  }
  return problems;
}
