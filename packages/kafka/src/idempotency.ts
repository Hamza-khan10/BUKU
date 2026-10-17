import type { Database, Transaction, UserTx } from '@buku/database';
import type { EventEnvelope } from './envelope.js';

/**
 * Run `fn` at most once per (consumer, eventId), atomically with its DB writes.
 *
 * Kafka delivers at-least-once, and Paddle retries webhooks, so the same event
 * WILL arrive twice sometimes. The ledger row and the side effects commit in
 * one transaction: if the row already exists, `fn` is skipped.
 *
 * For side effects outside the database (sending an SMS), call this first to
 * claim the event; a crash after claiming but before sending can then lose
 * that one message, which for notifications is preferable to duplicates.
 *
 * Returns true if `fn` ran, false if the event was a duplicate.
 */
export async function processOnce(
  db: Database,
  consumer: string,
  eventId: string,
  fn: (tx: Transaction) => Promise<void>,
): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const inserted = await tx.$executeRaw`
      INSERT INTO processed_events (consumer, event_id) VALUES (${consumer}, ${eventId})
      ON CONFLICT DO NOTHING`;
    if (inserted === 0) return false;
    await fn(tx);
    return true;
  });
}

/**
 * The same on a database v2 shard (D3): the ledger there is partitioned by the event's own time
 * (DB-019), so a redelivery on another day is still caught. Runs inside the caller's transaction
 * on the shard the side effect lands on; false when the event was already handled.
 */
export async function processOnceOnShard(
  tx: Pick<UserTx, '$executeRaw'>,
  consumer: string,
  event: Pick<EventEnvelope, 'id' | 'occurredAt'>,
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO processed_events (consumer, event_id, occurred_at)
    VALUES (${consumer}, ${event.id}, ${new Date(event.occurredAt)})
    ON CONFLICT DO NOTHING`;
  return inserted > 0;
}
