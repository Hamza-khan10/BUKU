import { shiftDate, type Visit } from './visits';

/**
 * The calendar's arithmetic (3.5h): which week, which hours to show, and where each visit sits.
 * Dates are the business's own calendar days ("YYYY-MM-DD"); times are its wall clock, as the
 * API gives them in `local`. Nothing here knows about time zones.
 */

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return shiftDate(date, -((day + 6) % 7));
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => shiftDate(start, i));

/** "3 – 9 November 2026", "27 October – 2 November 2026", "29 Dec 2026 – 4 Jan 2027". */
export function weekLabel(start: string): string {
  const end = shiftDate(start, 6);
  const f = (d: string, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }).format(new Date(`${d}T12:00:00Z`));
  if (start.slice(0, 4) !== end.slice(0, 4))
    return `${f(start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${f(end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (start.slice(0, 7) !== end.slice(0, 7))
    return `${f(start, { day: 'numeric', month: 'long' })} – ${f(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `${f(start, { day: 'numeric' })} – ${f(end, { day: 'numeric', month: 'long', year: 'numeric' })}`;
}

/** "14:30" → 870. */
export const minutesOf = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * The hours worth showing: 08:00–20:00, widened to whole hours around any visit outside them, so
 * an early or late booking is never cut off.
 */
export function hoursShown(visits: Visit[], from = 8, to = 20): { from: number; to: number } {
  for (const v of visits) {
    from = Math.min(from, Math.floor(minutesOf(v.local.startTime) / 60));
    const end = minutesOf(v.local.endTime);
    to = Math.max(to, Math.ceil((end === 0 ? 24 * 60 : end) / 60));
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

export interface Placed {
  visit: Visit;
  /** Minutes from the top of the shown hours. */
  top: number;
  height: number;
  /** Side by side with the visits it overlaps: its lane, of how many. */
  lane: number;
  lanes: number;
}

/**
 * One day's visits laid out: each as tall as it lasts, overlapping ones side by side in lanes
 * (each group of visits that overlap one another shares its number of lanes).
 */
export function layDay(visits: Visit[], from: number): Placed[] {
  const sorted = [...visits].sort(
    (a, b) => minutesOf(a.local.startTime) - minutesOf(b.local.startTime) || a.id.localeCompare(b.id),
  );
  const placed: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const laneEnds: number[] = [];
  const close = () => {
    const lanes = Math.max(1, ...group.map((p) => p.lane + 1));
    for (const p of group) p.lanes = lanes;
    group = [];
    laneEnds.length = 0;
  };
  for (const visit of sorted) {
    const start = minutesOf(visit.local.startTime);
    const rawEnd = minutesOf(visit.local.endTime);
    const end = Math.max(start + 15, rawEnd === 0 ? 24 * 60 : rawEnd);
    if (start >= groupEnd) close();
    let lane = laneEnds.findIndex((e) => e <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = end;
    const p: Placed = { visit, top: start - from * 60, height: end - start, lane, lanes: 1 };
    group.push(p);
    placed.push(p);
    groupEnd = Math.max(groupEnd, end);
  }
  close();
  return placed;
}
