/**
 * Who gets which suggestion, and when (D-075). Pure, so every edge case is
 * unit-tested. Three kinds of people:
 *
 *  • REGULARS — 3+ completed visits at one place within ~13 months, at a
 *    steady rhythm (typical gap 5–120 days). When their usual next visit is
 *    coming due (from ~85% of the gap) and they haven't booked it: "Time for
 *    your usual haircut? Ali has an opening on Thu at 10:30." Once per visit.
 *    If they're far past it (over 2× the gap), they're no longer "due" — the
 *    come-back message covers them later.
 *  • PEOPLE WHO STOPPED COMING — last booking or queue 45–180 days ago,
 *    nothing upcoming: their most-visited place is taking bookings. Once
 *    per quiet spell.
 *  • NEW ACCOUNTS THAT NEVER BOOKED — day 2 and day 10 (until day 30).
 *
 * For everyone, caps the admin can change: a gap between suggestions, a
 * monthly maximum, and stop after N suggestions with no booking in between.
 */

const DAY = 86_400_000;

export const RULES = {
  regular: { minVisits: 3, minEveryDays: 5, maxEveryDays: 120, lookbackDays: 400, dueAt: 0.85, overdue: 2 },
  comeBack: { afterDays: 45, untilDays: 180 },
  firstBooking: { stepDays: [2, 10] as const, untilDays: 30, minGapDays: 7 },
} as const;

/** The typical gap between visits, in days (median), or null if there's no steady rhythm. */
export function everyDays(visits: Date[]): number | null {
  if (visits.length < RULES.regular.minVisits) return null;
  const sorted = [...visits].sort((a, b) => a.getTime() - b.getTime());
  const gaps = sorted.slice(1).map((d, i) => (d.getTime() - sorted[i]!.getTime()) / DAY);
  const ordered = [...gaps].sort((a, b) => a - b);
  const mid = Math.floor(ordered.length / 2);
  const median = ordered.length % 2 ? ordered[mid]! : (ordered[mid - 1]! + ordered[mid]!) / 2;
  if (median < RULES.regular.minEveryDays || median > RULES.regular.maxEveryDays) return null;
  return median;
}

export type Due = 'not_yet' | 'due' | 'overdue';

export function usualDue(last: Date, every: number, now: Date): Due {
  const since = (now.getTime() - last.getTime()) / DAY;
  if (since < every * RULES.regular.dueAt) return 'not_yet';
  if (since > every * RULES.regular.overdue) return 'overdue';
  return 'due';
}

/** When their usual visit falls due: the day suggestions start looking for openings. */
export function dueDate(last: Date, every: number): Date {
  return new Date(last.getTime() + every * DAY);
}

/** Minute of the day (business-local) they usually come, or null. */
export function usualMinuteOfDay(visits: Date[], timezone: string): number | null {
  if (!visits.length) return null;
  const minutes = visits
    .map((v) => {
      const [h, m] = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      })
        .format(v)
        .split(':')
        .map(Number);
      return (h ?? 0) * 60 + (m ?? 0);
    })
    .sort((a, b) => a - b);
  return minutes[Math.floor(minutes.length / 2)]!;
}

export interface CapState {
  /** When the last suggestion went to them, or null. */
  lastSentAt: Date | null;
  /** Suggestions in the last 30 days. */
  sentLast30Days: number;
  /** Suggestions since they last booked or joined a queue (or ever, if they never did). */
  sentSinceLastBooking: number;
}

export interface CapSettings {
  suggestionMinDays: number;
  suggestionMaxPer30Days: number;
  suggestionMaxIgnored: number;
}

export function capsAllow(state: CapState, s: CapSettings, now: Date): boolean {
  if (state.lastSentAt && now.getTime() - state.lastSentAt.getTime() < s.suggestionMinDays * DAY)
    return false;
  if (state.sentLast30Days >= s.suggestionMaxPer30Days) return false;
  if (state.sentSinceLastBooking >= s.suggestionMaxIgnored) return false;
  return true;
}

/** Which first-booking step is due for an account this old (null: none). */
export function firstBookingStep(
  accountCreatedAt: Date,
  now: Date,
  step1SentAt: Date | null,
  step2Sent: boolean,
): 1 | 2 | null {
  const age = (now.getTime() - accountCreatedAt.getTime()) / DAY;
  if (age > RULES.firstBooking.untilDays) return null;
  const [first, second] = RULES.firstBooking.stepDays;
  if (!step1SentAt) return age >= first ? 1 : null;
  if (step2Sent) return null;
  const sinceStep1 = (now.getTime() - step1SentAt.getTime()) / DAY;
  return age >= second && sinceStep1 >= RULES.firstBooking.minGapDays ? 2 : null;
}
