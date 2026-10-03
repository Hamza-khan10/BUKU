import type { Database } from '@buku/database';

/**
 * Recomputes the figures search ranks by (D-076), for every business, in one
 * statement. Runs every 10 minutes; several replicas running it at once just
 * write the same numbers.
 *
 *  • bookings in the last 7 days and the 7 before — for "trending" (bookings
 *    the business itself cancelled don't count);
 *  • queue joins in the last 7 days;
 *  • last 90 days: visits kept (completed, checked in, or a customer no-show —
 *    the business was there) and confirmed bookings the business cancelled
 *    (declining a request isn't breaking a promise). Reliability = kept / (kept + cancelled).
 */
export async function refreshSearchStats(db: Database, now = new Date()): Promise<number> {
  return db.$executeRaw`
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
      SELECT s.business_id, count(*) AS j7
      FROM queue_entries e JOIN queue_sessions s ON s.id = e.session_id
      WHERE e.joined_at > ${now}::timestamptz - interval '7 days' AND e.joined_at <= ${now}
      GROUP BY s.business_id
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
}
