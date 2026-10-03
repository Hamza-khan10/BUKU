import { customerShowUp } from '@buku/common';
import { showUpCounts, type Database } from '@buku/database';

const YEAR_MS = 365 * 86_400_000;

/** The customer's own view: the figure, what it's made of, and how to keep it high. */
export async function myReliability(db: Database, userId: string, now = new Date()) {
  const c = (await showUpCounts(db, [userId], now)).get(userId)!;
  const s = customerShowUp(c);
  return {
    ...s,
    visits: c.visits,
    noShows: c.noShows,
    lateCancellations: c.lateCancellations,
    period: { from: new Date(now.getTime() - YEAR_MS).toISOString(), to: now.toISOString() },
    /** Businesses see only `label`, never the counts. */
    businessesSee: s.label,
    tip:
      s.showsUpPercent === null
        ? 'Businesses see you as a new customer until you’ve had a few visits.'
        : s.showsUpPercent >= 90
          ? 'Great — businesses can count on you. Keep cancelling ahead when plans change.'
          : 'If you can’t make it, cancel before the business’s cancellation window — ordinary cancellations never count against you.',
  };
}
