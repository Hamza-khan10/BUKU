/**
 * Reliability figures (D-035, D-077), the same everywhere they are shown.
 *
 * BUSINESS: of the last 90 days' visits, the share it kept — completed,
 * checked in, or the customer didn't come — against confirmed bookings it
 * cancelled itself. Declining a request isn't breaking a promise.
 *
 * CUSTOMER (encourage, don't punish): over 12 months and every business,
 * the share of their visits they came to. A no-show counts in full, a late
 * cancellation (inside the business's window) half; an ordinary cancellation
 * not at all. Businesses only ever see "Shows up 95%" or "New customer".
 *
 * Nothing is shown until there are enough bookings to mean something.
 */

export const MIN_DECIDED_FOR_RELIABILITY = 10;

export interface Reliability {
  /** Whole percent. */
  keptPercent: number;
  /** How many bookings it's based on. */
  basedOn: number;
}

export function businessReliability(kept: number, businessCancels: number): Reliability | null {
  const decided = kept + businessCancels;
  if (decided < MIN_DECIDED_FOR_RELIABILITY) return null;
  return { keptPercent: Math.round((kept / decided) * 100), basedOn: decided };
}

export const MIN_VISITS_FOR_SHOW_UP = 3;

export interface ShowUp {
  /** Whole percent; null for someone new (too few visits to say). */
  showsUpPercent: number | null;
  /** Visits, no-shows and late cancellations it's based on. */
  basedOn: number;
  /** What a business sees. */
  label: string;
}

export function customerShowUp(c: { visits: number; noShows: number; lateCancellations: number }): ShowUp {
  const basedOn = c.visits + c.noShows + c.lateCancellations;
  if (basedOn < MIN_VISITS_FOR_SHOW_UP) return { showsUpPercent: null, basedOn, label: 'New customer' };
  const percent = Math.round((100 * c.visits) / (c.visits + c.noShows + 0.5 * c.lateCancellations));
  return { showsUpPercent: percent, basedOn, label: `Shows up ${percent}%` };
}
