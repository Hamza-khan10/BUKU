import { logger } from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { CatalogSync } from './catalog-sync.js';

/**
 * The figures search ranks by (D-076), and the sweep that keeps the catalog whole (D3h).
 *
 * STATS — every business shard, through search-service's cross-business role, one statement per
 * shard into its `business_search_stats`, then copied onto the businesses' catalog rows:
 *  • bookings in the last 7 days and the 7 before — for "trending" (bookings the business itself
 *    cancelled don't count);
 *  • queue joins in the last 7 days;
 *  • last 90 days: visits kept (completed, checked in, or a customer no-show — the business was
 *    there) and confirmed bookings the business cancelled (declining a request isn't breaking a
 *    promise). Reliability = kept / (kept + cancelled).
 * Several replicas running it at once just write the same numbers.
 *
 * SWEEP — every business on every shard, a page at a time: each catalog row refreshed from its
 * shard. The repair should an event have been missed, and what fills an empty catalog.
 */

const PAGE = 500;

export async function refreshSearchStats(plane: DataPlane, now = new Date()): Promise<number> {
  const catalog = plane.catalog!;
  let total = 0;
  for (const { run } of await plane.businessShards()) {
    const rows = await run(async (tx) => {
      await tx.$executeRaw`
        WITH a AS (
          SELECT business_id,
            count(*) FILTER (WHERE created_at > ${now}::timestamptz - interval '7 days' AND created_at <= ${now}
              AND cancelled_by IS DISTINCT FROM 'business') AS b7,
            count(*) FILTER (WHERE created_at > ${now}::timestamptz - interval '14 days'
              AND created_at <= ${now}::timestamptz - interval '7 days'
              AND cancelled_by IS DISTINCT FROM 'business') AS bprev,
            count(*) FILTER (WHERE start_at > ${now}::timestamptz - interval '90 days' AND start_at <= ${now}
              AND (status IN ('completed', 'no_show') OR (status = 'confirmed' AND checked_in_at IS NOT NULL))) AS kept,
            count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'business'
              AND cancel_reason_code IS DISTINCT FROM 'declined'
              AND cancelled_at > ${now}::timestamptz - interval '90 days' AND cancelled_at <= ${now}) AS cancels
          FROM appointments
          WHERE created_at > ${now}::timestamptz - interval '14 days'
             OR start_at > ${now}::timestamptz - interval '90 days'
             OR cancelled_at > ${now}::timestamptz - interval '90 days'
          GROUP BY business_id
        ), q AS (
          SELECT business_id, count(*) AS j7
          FROM queue_tickets
          WHERE joined_at > ${now}::timestamptz - interval '7 days' AND joined_at <= ${now}
          GROUP BY business_id
        )
        INSERT INTO business_search_stats AS t
          (business_id, bookings_7d, bookings_prev_7d, queue_joins_7d, kept_90d, business_cancels_90d, refreshed_at)
        SELECT b.id, coalesce(a.b7, 0), coalesce(a.bprev, 0), coalesce(q.j7, 0),
               coalesce(a.kept, 0), coalesce(a.cancels, 0), ${now}
        FROM businesses b
        LEFT JOIN a ON a.business_id = b.id
        LEFT JOIN q ON q.business_id = b.id
        WHERE b.deleted_at IS NULL
        ON CONFLICT (business_id) DO UPDATE SET
          bookings_7d = EXCLUDED.bookings_7d,
          bookings_prev_7d = EXCLUDED.bookings_prev_7d,
          queue_joins_7d = EXCLUDED.queue_joins_7d,
          kept_90d = EXCLUDED.kept_90d,
          business_cancels_90d = EXCLUDED.business_cancels_90d,
          refreshed_at = EXCLUDED.refreshed_at`;
      return tx.businessSearchStats.findMany({ where: { refreshedAt: now } });
    });
    for (let i = 0; i < rows.length; i += PAGE) {
      const page = rows.slice(i, i + PAGE);
      await catalog.$executeRaw`
        UPDATE catalog.businesses AS c SET
          bookings_7d = v.b7, bookings_prev_7d = v.bprev, queue_joins_7d = v.j7,
          kept_90d = v.kept, business_cancels_90d = v.cancels
        FROM unnest(
          ${page.map((r) => r.businessId)}::bigint[], ${page.map((r) => r.bookings7d)}::int[],
          ${page.map((r) => r.bookingsPrev7d)}::int[], ${page.map((r) => r.queueJoins7d)}::int[],
          ${page.map((r) => r.kept90d)}::int[], ${page.map((r) => r.businessCancels90d)}::int[]
        ) AS v(id, b7, bprev, j7, kept, cancels)
        WHERE c.business_id = v.id`;
    }
    total += rows.length;
  }
  return total;
}

/** Every business on every shard, refreshed in the catalog a page at a time. */
export async function sweepCatalog(
  plane: DataPlane,
  sync: CatalogSync,
): Promise<{ refreshed: number; failed: number }> {
  const log = logger.child({ module: 'catalog-sweep' });
  const totals = { refreshed: 0, failed: 0 };
  for (const { run } of await plane.businessShards()) {
    let after = 0n;
    for (;;) {
      const ids = await run((tx) =>
        tx.business.findMany({
          where: { id: { gt: after } },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: PAGE,
        }),
      );
      for (const { id } of ids) {
        try {
          await sync.refresh(id);
          totals.refreshed++;
        } catch (err) {
          totals.failed++;
          log.warn({ err, businessId: id.toString() }, 'a catalog row could not be refreshed');
        }
      }
      if (ids.length < PAGE) break;
      after = ids.at(-1)!.id;
    }
  }
  return totals;
}
