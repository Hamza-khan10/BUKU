/**
 * Reliability figures (D-035, D-077), the same everywhere they are shown.
 *
 * BUSINESS: of the last 90 days' visits, the share it kept — completed,
 * checked in, or the customer didn't come — against confirmed bookings it
 * cancelled itself. Declining a request isn't breaking a promise.
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
