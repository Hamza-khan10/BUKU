/**
 * When a scheduled message is due (pure, so every edge case is unit-tested).
 *
 * Reminders for a confirmed appointment:
 *  • day before — from 24 h before, until 3 h before (then the "soon" one takes
 *    over). Skipped if the booking was made under 30 h ahead: they've just had
 *    the confirmation.
 *  • soon — from 2 h before, until 20 min before. Skipped if the booking was made
 *    under 2½ h ahead (same reason).
 *  • Neither is sent at night (business's local time); it waits for morning and
 *    goes then if still inside its range — otherwise it's skipped, never sent late.
 *
 * A request nobody has answered: the approvers are reminded once, when it has
 * waited 2 h or the visit is under 24 h away (whichever first), at least
 * 15 min after it came in, and not later than 30 min before the visit.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

export type ReminderKind = 'r24' | 'r2' | 'pending';

export interface ReminderInput {
  status: string;
  startAt: Date;
  createdAt: Date;
}

export interface ReminderSettings {
  reminder24h: boolean;
  reminder2h: boolean;
  /** It is night where the business is. */
  quiet: boolean;
}

export function dueReminder(a: ReminderInput, now: Date, s: ReminderSettings): ReminderKind | null {
  if (s.quiet) return null;
  const untilStart = a.startAt.getTime() - now.getTime();
  const bookedAhead = a.startAt.getTime() - a.createdAt.getTime();
  const waited = now.getTime() - a.createdAt.getTime();

  if (a.status === 'confirmed') {
    if (s.reminder2h && untilStart <= 2 * HOUR && untilStart >= 20 * MIN && bookedAhead >= 150 * MIN)
      return 'r2';
    if (s.reminder24h && untilStart <= 24 * HOUR && untilStart > 3 * HOUR && bookedAhead >= 30 * HOUR)
      return 'r24';
    return null;
  }
  if (a.status === 'pending') {
    if (untilStart >= 30 * MIN && waited >= 15 * MIN && (waited >= 2 * HOUR || untilStart <= 24 * HOUR))
      return 'pending';
  }
  return null;
}

/** "Book again" reminders older than this are dropped (e.g. after an outage), not sent late. */
export const REBOOK_GRACE_MS = 3 * 24 * HOUR;

/** Plan notices: how long before the end each is sent. */
export const NOTICE_BEFORE = {
  trialEnding: 3 * 24 * HOUR,
  grantEnding: 7 * 24 * HOUR,
  planEnding: 3 * 24 * HOUR,
} as const;
/** "Trial over" / "payment failed" are only sent for changes this recent. */
export const NOTICE_RECENT_MS = 3 * 24 * HOUR;
