import { customerShowUp, type ShowUp } from '@buku/common';
import type { DataPlane } from '@buku/database';

/**
 * Customer reliability (D-035, D-078): from the last 12 months at every business — appointments
 * and queue tickets alike — kept on each person's own shard as one row per outcome
 * (`user_visit_outcomes`, D3d), so a business's list needs one small query per user shard, not a
 * visit to every business:
 *  • visits: completed, or checked in; queue tickets served;
 *  • no-shows: marked no-show (appointment or queue);
 *  • late cancellations: cancelled by the customer inside the business's window.
 */

export interface ShowUpCounts {
  visits: number;
  noShows: number;
  lateCancellations: number;
}

const YEAR_MS = 365 * 86_400_000;

export async function showUpCounts(
  plane: DataPlane,
  userIds: readonly bigint[],
  now = new Date(),
): Promise<Map<bigint, ShowUpCounts>> {
  const result = new Map<bigint, ShowUpCounts>(
    [...new Set(userIds)].map((id) => [id, { visits: 0, noShows: 0, lateCancellations: 0 }]),
  );
  const since = new Date(now.getTime() - YEAR_MS);
  for (const [db, ids] of await plane.usersByShard(userIds)) {
    const groups = await db.userVisitOutcome.groupBy({
      by: ['userId', 'kind'],
      where: { userId: { in: ids }, happenedAt: { gt: since, lte: now } },
      _count: { _all: true },
    });
    for (const g of groups) {
      const c = result.get(g.userId)!;
      if (g.kind === 'visit') c.visits = g._count._all;
      else if (g.kind === 'no_show') c.noShows = g._count._all;
      else if (g.kind === 'late_cancel') c.lateCancellations = g._count._all;
    }
  }
  return result;
}

/** What a business sees about each customer: "Shows up 95%" or "New customer". */
export async function showUpLabels(
  plane: DataPlane,
  userIds: readonly bigint[],
  now = new Date(),
): Promise<Map<bigint, ShowUp>> {
  const counts = await showUpCounts(plane, userIds, now);
  return new Map([...counts].map(([id, c]) => [id, customerShowUp(c)]));
}

/** The customer's own view: the figure, what it's made of, and how to keep it high. */
export async function myReliability(plane: DataPlane, userId: bigint, now = new Date()) {
  const c = (await showUpCounts(plane, [userId], now)).get(userId)!;
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
