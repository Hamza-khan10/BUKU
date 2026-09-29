import type { Database, Transaction } from '@buku/database';

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
