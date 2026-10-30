import type { UserTx } from '@buku/database';
import type { EventEnvelope } from './envelope.js';

/**
 * Handle an event at most once per consumer, atomically with the handler's own writes.
 *
 * Kafka delivers at-least-once, and Paddle retries webhooks, so the same event WILL arrive twice
 * sometimes. The ledger row and the side effects commit in one transaction: when the row is
 * already there, the caller skips the work. For side effects outside the database (sending a
 * message), claim the event first; a crash after claiming but before sending can then lose that
 * one message, which for notifications is preferable to duplicates.
 *
 * On a database v2 shard (D3), the ledger is partitioned by the event's own time (DB-019), so a
 * redelivery on another day is still caught. Runs inside the caller's transaction on the shard the
 * side effect lands on; false when the event was already handled.
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
