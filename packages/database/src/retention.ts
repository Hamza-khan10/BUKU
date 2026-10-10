import { recordAudit } from './audit.js';
import type { Database } from './index.js';

/**
 * The retention schedule (D-080), applied daily. Anything not listed here is
 * a business record kept while the account exists (and anonymised when a
 * person deletes their account, D-043).
 *
 * | What                                     | Kept                            | How                         |
 * | ---------------------------------------- | ------------------------------- | --------------------------- |
 * | Audit log                                | 24 months                       | whole months dropped (DB)   |
 * | Notifications (inbox + delivery records) | 13 months                       | whole months dropped (DB)   |
 * | Ad events                                | 13 months                       | whole months dropped (DB)   |
 * | Processed-event markers (idempotency)    | 120 days (Kafka keeps ≤ 90)     | rows deleted                |
 * | Published outbox events                  | 7 days after publishing         | rows deleted                |
 * | Sign-in sessions (refresh tokens)        | 30 days after they expire       | rows deleted                |
 *
 * Every period is fixed in a database function (drop_expired_partitions,
 * delete_expired_rows), so this job can run them but never shorten them — and
 * needs no delete rights of its own on other services' tables (D-092). Rows
 * are deleted in batches so no statement holds locks for long. Each run is recorded in the
 * audit log with what was removed.
 */
export const RETENTION = {
  processedEventsDays: 120,
  publishedOutboxDays: 7,
  expiredSessionsDays: 30,
} as const;

const BATCH = 5000;

export interface RetentionResult {
  ran: boolean;
  droppedPartitions: string[];
  processedEvents: number;
  outboxEvents: number;
  sessions: number;
}

export async function applyRetention(db: Database): Promise<RetentionResult> {
  // One replica at a time drops partitions (the lock ends with the transaction;
  // the row deletes below are safe to repeat if two replicas ever overlap).
  const dropped = await db.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(314_159_265) AS locked`;
    if (!lock?.locked) return null;
    const [row] = await tx.$queryRaw<{ parts: string[] }[]>`SELECT drop_expired_partitions() AS parts`;
    return row?.parts ?? [];
  });
  if (dropped === null)
    return { ran: false, droppedPartitions: [], processedEvents: 0, outboxEvents: 0, sessions: 0 };

  // The periods are fixed in the database function: this job can run it, never shorten them.
  let processedEvents = 0;
  let outboxEvents = 0;
  let sessions = 0;
  for (;;) {
    const [row] = await db.$queryRaw<{ processed_events: bigint; outbox_events: bigint; sessions: bigint }[]>`
      SELECT * FROM delete_expired_rows(${BATCH}::int)`;
    const p = Number(row?.processed_events ?? 0);
    const o = Number(row?.outbox_events ?? 0);
    const s = Number(row?.sessions ?? 0);
    processedEvents += p;
    outboxEvents += o;
    sessions += s;
    if (p < BATCH && o < BATCH && s < BATCH) break;
  }

  const result = {
    ran: true,
    droppedPartitions: dropped,
    processedEvents,
    outboxEvents,
    sessions,
  };
  await recordAudit(db, {
    action: 'retention.applied',
    resourceType: 'system',
    newValues: result,
  });
  return result;
}
