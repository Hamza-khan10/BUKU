import type { Receipt } from '@/features/booking/types';

/**
 * The review rules, as the API applies them (booking-service REVIEW_RULES),
 * so the pages offer reviewing only when it will be accepted. Pure, tested.
 */
export const REVIEW_WINDOW_DAYS = 30;
export const REVIEW_EDIT_DAYS = 7;
const DAY = 86_400_000;

/** A visit that happened: completed, or checked in and started. */
export function visited(r: Receipt, now: number): boolean {
  return (
    r.status === 'completed' ||
    (r.status === 'confirmed' && r.checkedInAt !== null && Date.parse(r.startAt) <= now)
  );
}

/** Can this visit be reviewed now (it happened, within the last 30 days)? */
export function reviewable(r: Receipt, now: number): boolean {
  return visited(r, now) && now - Date.parse(r.startAt) <= REVIEW_WINDOW_DAYS * DAY;
}

/** How a business page shows a reviewer: first name and last initial ("Ayesha K."). */
export function reviewerName(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? 'A customer');
}

/** The words for each star, so a rating means the same to everyone. */
export const STAR_WORDS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'] as const;

/** The parts people may rate besides the whole visit (all optional). */
export const DETAILS = [
  { key: 'waitTime', label: 'Waiting time' },
  { key: 'staff', label: 'Staff' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'value', label: 'Value for money' },
] as const;
