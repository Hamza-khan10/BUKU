import { customerShowUp, type ShowUp } from '@buku/common';
import type { DataPlane } from './data-plane.js';

/**
 * Customer reliability on database v2 (D-035, D-078, D3d): from the last 12 months at every
 * business — appointments and queue tickets alike — kept on each person's own shard as one row per
 * outcome (`user_visit_outcomes`), so a business's list needs one small query per user shard:
 *  • visits: completed, or checked in; queue tickets served;
 *  • no-shows: marked no-show (appointment or queue);
 *  • late cancellations: cancelled by the customer inside the business's window.
 * Shared by booking's appointment views and queue's front-desk board.
 */

export interface PersonShowUpCounts {
  visits: number;
  noShows: number;
  lateCancellations: number;
}

const YEAR_MS = 365 * 86_400_000;

export async function showUpCountsOf(
  plane: DataPlane,
  userIds: readonly bigint[],
  now = new Date(),
): Promise<Map<bigint, PersonShowUpCounts>> {
  const result = new Map<bigint, PersonShowUpCounts>(
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
export async function showUpLabelsOf(
  plane: DataPlane,
  userIds: readonly bigint[],
  now = new Date(),
): Promise<Map<bigint, ShowUp>> {
  const counts = await showUpCountsOf(plane, userIds, now);
  return new Map([...counts].map(([id, c]) => [id, customerShowUp(c)]));
}
