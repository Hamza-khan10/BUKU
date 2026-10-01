import {
  addDays,
  dayOfWeek,
  minutesToTime,
  startOfDay,
  timeToMinutes,
  toInstant,
  wallClock,
} from './time.js';

/**
 * The slot calculator: which start times can be booked for a service on a
 * date, and with whom. A pure function of its inputs (no database, no clock),
 * so it is tested exhaustively and used both to SHOW times and to CHECK a
 * booking (a customer can only book what this function offers).
 *
 * For each employee who performs the service, on the local date:
 *   working time = weekly hours for that weekday ∪ extra hours that date
 *                − their time off − business closures
 * A start time is offered when [start, start + duration + buffer) fits inside
 * working time, doesn't touch any existing appointment's blocked time, and is
 * within [earliest, latest] (minimum notice … booking horizon). Start times
 * step from the beginning of each working range by `stepMinutes`.
 *
 * Everything is computed as real instants, so a daylight-saving change in the
 * middle of a working day still yields correct times.
 */

export interface LocalRange {
  start: string; // HH:MM
  end: string;
}

export interface DateException {
  date: string; // YYYY-MM-DD
  /** Absent → the whole day. */
  start?: string | null;
  end?: string | null;
}

export interface StaffSchedule {
  id: string;
  /** dayOfWeek (0 = Sunday) → ranges. */
  weekly: Map<number, LocalRange[]>;
  timeOff: DateException[];
  extraHours: (DateException & { start: string; end: string })[];
  /** Existing appointments: [start, blockedUntil) as epoch ms. */
  busy: Interval[];
}

export interface SlotQuery {
  date: string;
  timezone: string;
  durationMinutes: number;
  bufferMinutes: number;
  stepMinutes: number;
  /** No start before this (now + minimum notice). */
  earliest: Date;
  /** No start after this (booking horizon). */
  latest: Date;
  staff: StaffSchedule[];
  closures: DateException[];
}

export interface Slot {
  startAt: Date;
  /** What the customer sees (without the buffer). */
  endAt: Date;
  /** Local wall-clock start, e.g. "10:30". */
  time: string;
  staffIds: string[];
}

export type Interval = [number, number]; // [start, end) epoch ms

export function computeSlots(q: SlotQuery): Slot[] {
  const occupyMs = (q.durationMinutes + q.bufferMinutes) * 60_000;
  const stepMs = q.stepMinutes * 60_000;
  const dayStart = startOfDay(q.date, q.timezone).getTime();
  const dayEnd = startOfDay(addDays(q.date, 1), q.timezone).getTime();
  const closed = q.closures
    .filter((c) => c.date === q.date)
    .map((c) => exceptionInterval(c, q, dayStart, dayEnd));

  const byStart = new Map<number, Set<string>>();
  for (const member of q.staff) {
    const ranges = [
      ...(member.weekly.get(dayOfWeek(q.date)) ?? []),
      ...member.extraHours.filter((e) => e.date === q.date),
    ];
    const off = member.timeOff
      .filter((t) => t.date === q.date)
      .map((t) => exceptionInterval(t, q, dayStart, dayEnd));
    const working = subtract(
      ranges.map((r) => rangeInterval(r, q.date, q.timezone)).filter((i): i is Interval => i !== null),
      [...off, ...closed],
    );
    const busy = member.busy;
    for (const [from, to] of working) {
      for (let start = from; start + occupyMs <= to; start += stepMs) {
        if (start < q.earliest.getTime() || start > q.latest.getTime()) continue;
        const end = start + occupyMs;
        if (busy.some(([bs, be]) => start < be && end > bs)) continue;
        let set = byStart.get(start);
        if (!set) byStart.set(start, (set = new Set()));
        set.add(member.id);
      }
    }
  }

  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, staffIds]) => ({
      startAt: new Date(start),
      endAt: new Date(start + q.durationMinutes * 60_000),
      time: wallClock(start, q.timezone).time,
      staffIds: [...staffIds].sort(),
    }));
}

/** A local working range as instants. A boundary inside a DST gap moves to the nearest real minute inside the range. */
function rangeInterval(r: LocalRange, date: string, timezone: string): Interval | null {
  const start = nearestInstant(date, timeToMinutes(r.start), +1, timezone);
  const end = nearestInstant(date, timeToMinutes(r.end), -1, timezone);
  return start !== null && end !== null && start < end ? [start, end] : null;
}

function exceptionInterval(e: DateException, q: SlotQuery, dayStart: number, dayEnd: number): Interval {
  if (!e.start || !e.end) return [dayStart, dayEnd];
  return rangeInterval({ start: e.start, end: e.end }, q.date, q.timezone) ?? [0, 0];
}

function nearestInstant(date: string, minute: number, direction: 1 | -1, timezone: string): number | null {
  for (let m = minute, tries = 0; tries <= 120 && m >= 0 && m < 24 * 60; m += direction, tries++) {
    const t = toInstant(date, minutesToTime(m), timezone);
    if (t) return t.getTime();
  }
  return null;
}

/** `ranges` minus `holes`, merged and sorted. */
export function subtract(ranges: Interval[], holes: Interval[]): Interval[] {
  let result = merge(ranges);
  for (const [hs, he] of holes) {
    result = result.flatMap(([s, e]): Interval[] => {
      if (he <= s || hs >= e) return [[s, e]];
      const parts: Interval[] = [];
      if (hs > s) parts.push([s, hs]);
      if (he < e) parts.push([he, e]);
      return parts;
    });
  }
  return result;
}

function merge(ranges: Interval[]): Interval[] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const [s, e] of sorted) {
    const last = out[out.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else out.push([s, e]);
  }
  return out;
}
