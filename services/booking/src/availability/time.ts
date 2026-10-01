/**
 * Wall-clock time in a business's timezone ↔ real instants, with the
 * built-in Intl API (no date library). Every booking calculation goes
 * through these, so daylight-saving changes are handled in one place:
 *
 *  • a local time that doesn't exist (clocks jump forward, 02:30 on the
 *    spring-forward day) has no instant → `null`;
 *  • a local time that happens twice (clocks fall back) → the FIRST one.
 *
 * Dates are `YYYY-MM-DD`, times `HH:MM` (24h).
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The local wall-clock reading of an instant: { date: 'YYYY-MM-DD', time: 'HH:MM' }. */
export function wallClock(instant: Date | number, timezone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    formatter(timezone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Minutes the zone is ahead of UTC at an instant (e.g. +300 for Asia/Karachi). */
function offsetMinutes(ms: number, timezone: string): number {
  const p = Object.fromEntries(
    formatter(timezone)
      .formatToParts(new Date(ms))
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const asUtc = Date.UTC(p.year!, p.month! - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant at which the wall clock in `timezone` shows `date time`; null inside a DST gap. */
export function toInstant(date: string, time: string, timezone: string): Date | null {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  const local = Date.UTC(y, mo - 1, d, h, mi);
  // The offset in force can only be the one shortly before or after this moment.
  const candidates = [
    ...new Set([offsetMinutes(local - 43_200_000, timezone), offsetMinutes(local + 43_200_000, timezone)]),
  ]
    .map((offset) => local - offset * 60_000)
    .filter((ms) => {
      const w = wallClock(ms, timezone);
      return w.date === date && w.time === time;
    });
  return candidates.length ? new Date(Math.min(...candidates)) : null;
}

/** Start of the local day (midnight, or the first existing minute if midnight is skipped). */
export function startOfDay(date: string, timezone: string): Date {
  for (let minute = 0; minute < 24 * 60; minute += 30) {
    const t = toInstant(date, minutesToTime(minute), timezone);
    if (t) return t;
  }
  throw new Error(`no valid time on ${date} in ${timezone}`);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a calendar date (no timezone involved). */
export function dayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export const timeToMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

export const minutesToTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
