import { dayLabel, shiftDate } from './visits';

/**
 * Days that differ from the usual week (3.5e): the business closed (a holiday, a half day) and one
 * person's time off or extra hours. The API keeps one row per date; people think in stretches
 * ("closed 10 to 12 April for Eid"), so consecutive whole days with the same reason are shown,
 * and removed, as one.
 */

export type EntryKind = 'time_off' | 'extra_hours';

/** One date, as the API lists it (upcoming only). */
export interface ScheduleEntry {
  id: string;
  date: string;
  kind: EntryKind;
  /** Both set: part of the day; both null: the whole day. */
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

/** One stretch: consecutive dates with the same kind, hours and reason. */
export interface ScheduleGroup {
  ids: string[];
  from: string;
  to: string;
  kind: EntryKind;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

/** Joins consecutive whole days with the same kind and reason; part days stay on their own. */
export function groupEntries(entries: readonly ScheduleEntry[]): ScheduleGroup[] {
  const sorted = [...entries].sort((a, b) =>
    a.date === b.date ? (a.startTime ?? '').localeCompare(b.startTime ?? '') : a.date.localeCompare(b.date),
  );
  const groups: ScheduleGroup[] = [];
  for (const e of sorted) {
    const last = groups.at(-1);
    const wholeDay = e.startTime === null && e.endTime === null;
    if (
      last &&
      wholeDay &&
      last.startTime === null &&
      last.kind === e.kind &&
      last.reason === e.reason &&
      shiftDate(last.to, 1) === e.date
    ) {
      last.ids.push(e.id);
      last.to = e.date;
      continue;
    }
    groups.push({
      ids: [e.id],
      from: e.date,
      to: e.date,
      kind: e.kind,
      startTime: e.startTime,
      endTime: e.endTime,
      reason: e.reason,
    });
  }
  return groups;
}

/** "Tomorrow", "Fri 10 Apr – Sun 12 Apr", "Fri 10 Apr, 14:00–18:00". */
export function groupWhen(group: ScheduleGroup, today: string): string {
  const from = dayLabel(group.from, today);
  if (group.startTime && group.endTime) return `${from}, ${group.startTime}–${group.endTime}`;
  if (group.from === group.to) return from;
  return `${from} – ${dayLabel(group.to, today)}`;
}

/** How many days a stretch covers. */
export function groupDays(group: ScheduleGroup): number {
  return group.ids.length;
}

/** What the form sends; `to` only for more than one whole day, the times only for part of one. */
export interface ScheduleInput {
  from: string;
  to?: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

/** The API's own limit on one entry: about two months. */
export const MAX_DAYS = 62;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * The form's problems, as the API would see them, by field. `partDay` decides whether times are
 * used (one date only) or `to` (whole days). `extra` needs part of one day.
 */
export function scheduleProblems(
  form: { from: string; to: string; partDay: boolean; startTime: string; endTime: string },
  today: string,
  extra = false,
): Partial<Record<'from' | 'to' | 'startTime' | 'endTime', string>> {
  const problems: Partial<Record<'from' | 'to' | 'startTime' | 'endTime', string>> = {};
  if (!DATE.test(form.from)) problems.from = 'Choose the day.';
  else if (form.from < today) problems.from = 'Choose today or a later day.';
  if (form.partDay || extra) {
    if (!TIME.test(form.startTime)) problems.startTime = 'Choose a start time.';
    if (!TIME.test(form.endTime)) problems.endTime = 'Choose an end time.';
    else if (TIME.test(form.startTime) && form.startTime >= form.endTime)
      problems.endTime = 'The end must be after the start.';
  } else if (form.to) {
    if (!DATE.test(form.to)) problems.to = 'Choose the last day.';
    else if (DATE.test(form.from) && form.to < form.from)
      problems.to = 'The last day can’t be before the first.';
    else if (DATE.test(form.from) && daysBetween(form.from, form.to) > MAX_DAYS)
      problems.to = `At most ${MAX_DAYS} days at once.`;
  }
  return problems;
}

/** The days from one date to another, both counted. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000) + 1;
}

/** The body the API takes, from a form that passed `scheduleProblems`. */
export function scheduleInput(
  form: { from: string; to: string; partDay: boolean; startTime: string; endTime: string; reason: string },
  extra = false,
): ScheduleInput {
  const reason = form.reason.trim();
  return {
    from: form.from,
    ...(form.partDay || extra
      ? { startTime: form.startTime, endTime: form.endTime }
      : form.to && form.to !== form.from
        ? { to: form.to }
        : {}),
    ...(reason && { reason }),
  };
}
