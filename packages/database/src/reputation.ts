import { customerShowUp, type ShowUp } from '@buku/common';
import type { Database, Transaction } from './index.js';

/**
 * Customer reliability counts (D-035, D-078), shared by every service that
 * shows them (booking's appointment views, queue's front-desk board). From the
 * last 12 months at every business — appointments and queue tickets alike:
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
  db: Database | Transaction,
  userIds: string[],
  now = new Date(),
): Promise<Map<string, ShowUpCounts>> {
  const ids = [...new Set(userIds)];
  const result = new Map<string, ShowUpCounts>(
    ids.map((id) => [id, { visits: 0, noShows: 0, lateCancellations: 0 }]),
  );
  if (!ids.length) return result;
  const since = new Date(now.getTime() - YEAR_MS);
  const rows = await db.$queryRaw<{ user_id: string; visits: number; no_shows: number; late: number }[]>`
    SELECT user_id, sum(visits)::int AS visits, sum(no_shows)::int AS no_shows, sum(late)::int AS late
    FROM (
      SELECT user_id,
        count(*) FILTER (WHERE start_at > ${since} AND start_at <= ${now}
          AND (status = 'completed' OR (status = 'confirmed' AND checked_in_at IS NOT NULL))) AS visits,
        count(*) FILTER (WHERE start_at > ${since} AND start_at <= ${now} AND status = 'no_show') AS no_shows,
        count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user' AND late_cancellation
          AND cancelled_at > ${since} AND cancelled_at <= ${now}) AS late
      FROM appointments
      WHERE user_id = ANY(${ids}::uuid[])
        AND (start_at > ${since} OR cancelled_at > ${since})
      GROUP BY user_id
      UNION ALL
      SELECT user_id,
        count(*) FILTER (WHERE status = 'completed') AS visits,
        count(*) FILTER (WHERE status = 'no_show') AS no_shows,
        0 AS late
      FROM queue_entries
      WHERE user_id = ANY(${ids}::uuid[]) AND joined_at > ${since} AND joined_at <= ${now}
      GROUP BY user_id
    ) t
    GROUP BY user_id`;
  for (const r of rows)
    result.set(r.user_id, { visits: r.visits, noShows: r.no_shows, lateCancellations: r.late });
  return result;
}

/** What a business sees about each customer: "Shows up 95%" or "New customer". */
export async function showUpLabels(
  db: Database | Transaction,
  userIds: string[],
  now = new Date(),
): Promise<Map<string, ShowUp>> {
  const counts = await showUpCounts(db, userIds, now);
  return new Map([...counts].map(([id, c]) => [id, customerShowUp(c)]));
}
