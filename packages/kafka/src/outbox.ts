import { logger } from '@buku/common';
import type { Database, Prisma, Transaction } from '@buku/database';
import type { EventEnvelope } from './envelope.js';
import type { EventProducer } from './producer.js';

/**
 * TRANSACTIONAL OUTBOX
 *
 * The problem: "INSERT appointment; then publish bookings.created" is two
 * separate operations. If the process dies between them, the booking exists
 * but no other service ever hears about it (no confirmation SMS, no
 * analytics, no search update).
 *
 * The fix: write the event into `outbox_events` IN THE SAME DATABASE
 * TRANSACTION as the business change. Either both commit or neither does.
 * The relay below then publishes committed-but-unpublished rows to Kafka and
 * marks them published. If it crashes, it resumes where it left off.
 *
 *   await db.$transaction(async (tx) => {
 *     const appt = await tx.appointment.create({ ... });
 *     await enqueueEvent(tx, createEvent({ type: TOPICS.BOOKINGS_CREATED, subject: appt.id, ... }), 'appointment');
 *   });
 *
 * Delivery is at-least-once (a crash after publishing but before marking
 * the row can publish it twice), which is why consumers dedupe on event.id.
 */

export async function enqueueEvent(
  tx: Transaction,
  event: EventEnvelope,
  aggregateType: string,
  options: { partitionKey?: string; headers?: Record<string, string> } = {},
): Promise<void> {
  await tx.outboxEvent.create({
    data: {
      aggregateType,
      aggregateId: event.subject,
      topic: event.type,
      partitionKey: options.partitionKey ?? event.subject,
      payload: event as unknown as Prisma.InputJsonValue,
      ...(options.headers ? { headers: options.headers } : {}),
    },
  });
}

interface OutboxRow {
  id: string;
  partition_key: string;
  payload: EventEnvelope;
  headers: Record<string, string> | null;
}

export interface OutboxRelayOptions {
  db: Database;
  producer: EventProducer;
  batchSize?: number;
  pollIntervalMs?: number;
  /** Published rows older than this are deleted. Default 7 days. */
  retentionDays?: number;
}

// Arbitrary constant; all relay instances contend for the same advisory lock.
const RELAY_LOCK_KEY = 718_281_828;

export class OutboxRelay {
  private readonly log = logger.child({ module: 'outbox-relay' });
  private running = false;
  private loop: Promise<void> | undefined;
  private lastPrune = 0;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly retentionDays: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.retentionDays = options.retentionDays ?? 7;
  }

  /**
   * Publish one batch. Returns how many events were published.
   *
   * Only ONE relay instance works at a time (transaction-scoped advisory
   * lock), which preserves per-aggregate event order even when several
   * replicas of a service run a relay. The others simply find the lock taken.
   */
  async runOnce(): Promise<number> {
    const { db, producer } = this.options;
    return db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${RELAY_LOCK_KEY}) AS locked`;
        if (!lock?.locked) return 0;

        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, partition_key, payload, headers
          FROM outbox_events
          WHERE published_at IS NULL
          ORDER BY created_at, id
          LIMIT ${this.batchSize}
          FOR UPDATE SKIP LOCKED`;
        if (rows.length === 0) return 0;

        const ids = rows.map((r) => r.id);
        try {
          await producer.publishMany(
            rows.map((r) => ({
              event: r.payload,
              key: r.partition_key,
              ...(r.headers ? { headers: r.headers } : {}),
            })),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message.slice(0, 1000) : String(err);
          await tx.$executeRaw`
            UPDATE outbox_events SET attempts = attempts + 1, last_error = ${message}
            WHERE id = ANY(${ids}::uuid[])`;
          this.log.error({ err, count: rows.length }, 'outbox publish failed; will retry');
          return 0;
        }

        await tx.$executeRaw`
          UPDATE outbox_events SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = ANY(${ids}::uuid[])`;
        return rows.length;
      },
      { timeout: 45_000, maxWait: 5_000 },
    );
  }

  /** Delete published rows past retention (they are already in Kafka). */
  async prune(): Promise<number> {
    return this.options.db.$executeRaw`
      DELETE FROM outbox_events
      WHERE published_at IS NOT NULL AND published_at < now() - make_interval(days => ${this.retentionDays})`;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      let idleDelay = this.pollIntervalMs;
      while (this.running) {
        try {
          const published = await this.runOnce();
          // Drain quickly while there is a backlog; back off when idle.
          idleDelay = published === this.batchSize ? 0 : this.pollIntervalMs;
          if (Date.now() - this.lastPrune > 60 * 60 * 1000) {
            this.lastPrune = Date.now();
            const pruned = await this.prune();
            if (pruned) this.log.info({ pruned }, 'pruned published outbox rows');
          }
        } catch (err) {
          this.log.error({ err }, 'outbox relay iteration failed');
          idleDelay = Math.min(Math.max(idleDelay * 2, 1_000), 30_000);
        }
        if (idleDelay > 0 && this.running) await new Promise((r) => setTimeout(r, idleDelay));
      }
    })();
    this.log.info('outbox relay started');
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
    this.log.info('outbox relay stopped');
  }
}
