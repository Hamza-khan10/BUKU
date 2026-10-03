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
 * The monthly periods are fixed in the database function, so this job (the
 * app role) can run them but never shorten them. Each run is recorded in the
 * audit log with what was removed.
 */
export const RETENTION = {
  processedEventsDays: 120,
  publishedOutboxDays: 7,
  expiredSessionsDays: 30,
} as const;

const DAY = 86_400_000;
const BATCH = 5000;

export interface RetentionResult {
  ran: boolean;
  droppedPartitions: string[];
  processedEvents: number;
  outboxEvents: number;
  sessions: number;
}

/** Deletes in batches so no single statement holds locks for long. */
async function deleteInBatches(run: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await run();
    total += n;
    if (n < BATCH) return total;
  }
}

export async function applyRetention(db: Database, now = new Date()): Promise<RetentionResult> {
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

  const processedBefore = new Date(now.getTime() - RETENTION.processedEventsDays * DAY);
  const outboxBefore = new Date(now.getTime() - RETENTION.publishedOutboxDays * DAY);
  const sessionsBefore = new Date(now.getTime() - RETENTION.expiredSessionsDays * DAY);

  const processedEvents = await deleteInBatches(
    () =>
      db.$executeRaw`DELETE FROM processed_events WHERE ctid IN (
        SELECT ctid FROM processed_events WHERE processed_at < ${processedBefore} LIMIT ${BATCH})`,
  );
  const outboxEvents = await deleteInBatches(
    () =>
      db.$executeRaw`DELETE FROM outbox_events WHERE ctid IN (
        SELECT ctid FROM outbox_events WHERE published_at < ${outboxBefore} LIMIT ${BATCH})`,
  );
  const sessions = await deleteInBatches(
    () =>
      db.$executeRaw`DELETE FROM refresh_tokens WHERE ctid IN (
        SELECT ctid FROM refresh_tokens WHERE expires_at < ${sessionsBefore} LIMIT ${BATCH})`,
  );

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
