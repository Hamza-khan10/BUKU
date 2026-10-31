import { idFromString, logger } from '@buku/common';
import type { BusinessTx, DataPlane, UserShard, UserTx } from '@buku/database';
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
 * The fix: write the event into the shard's `outbox_events` IN THE SAME DATABASE TRANSACTION as
 * the business change. Either both commit or neither does. The relay below then publishes
 * committed-but-unpublished rows to Kafka and marks them published. If it crashes, it resumes
 * where it left off.
 *
 *   await plane.inBusiness(businessId, async (tx) => {
 *     const appointment = await tx.appointment.create({ ... });
 *     await enqueueShardEvent(tx, plane.id(), createEvent({ type: TOPICS.BOOKINGS_CREATED, ... }), 'appointment');
 *   });
 *
 * Delivery is at-least-once (a crash after publishing but before marking the row can publish it
 * twice), which is why consumers dedupe on the event (processOnceOnShard).
 */

/**
 * On a database v2 shard (D3): the row gets its own snowflake ID, and the aggregate's ID is a v2 ID
 * too. Written in the shard transaction that makes the change it announces.
 */
export async function enqueueShardEvent(
  tx: UserTx | BusinessTx,
  id: bigint,
  event: EventEnvelope,
  aggregateType: string,
  options: { partitionKey?: string; headers?: Record<string, string> } = {},
): Promise<void> {
  const aggregateId = idFromString(event.subject);
  if (aggregateId === null)
    throw new Error(`a v2 event's subject must be an ID, not ${JSON.stringify(event.subject)}`);
  await (tx as UserTx).outboxEvent.create({
    data: {
      id,
      aggregateType,
      aggregateId,
      source: event.source,
      topic: event.type,
      partitionKey: options.partitionKey ?? event.subject,
      payload: event as unknown as UserShard.Prisma.InputJsonValue,
      ...(options.headers ? { headers: options.headers } : {}),
    },
  });
}

/** A shard the relay publishes from. */
interface RelayDatabase {
  $transaction<T>(
    fn: (tx: RelayTransaction) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}
interface RelayTransaction {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

interface OutboxRow {
  id: bigint;
  partition_key: string;
  payload: EventEnvelope;
  headers: Record<string, string> | null;
}

export interface OutboxRelayOptions {
  /** A user or business shard (old days are dropped with their partitions, DB-006). */
  db: RelayDatabase;
  producer: EventProducer;
  /**
   * The service whose events this relay publishes ("booking-service"): each
   * service publishes only its own (D-092), so its Kafka credentials need only
   * its own topics.
   */
  source: string;
  batchSize?: number;
  pollIntervalMs?: number;
}

// Arbitrary constant; all relay instances contend for the same advisory lock.
const RELAY_LOCK_KEY = 718_281_828;

export class OutboxRelay {
  private readonly log = logger.child({ module: 'outbox-relay' });
  private running = false;
  private loop: Promise<void> | undefined;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;

  constructor(private readonly options: OutboxRelayOptions) {
    this.batchSize = options.batchSize ?? 100;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
  }

  /**
   * Publish one batch. Returns how many events were published.
   *
   * Only ONE relay instance per service works at a time (a transaction-scoped
   * advisory lock keyed by the service), which preserves per-aggregate event
   * order even when several replicas run a relay. The others find it taken.
   */
  async runOnce(): Promise<number> {
    const { producer, db } = this.options;
    return db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${RELAY_LOCK_KEY}::int, hashtext(${this.options.source})) AS locked`;
        if (!lock?.locked) return 0;

        const rows = await tx.$queryRaw<OutboxRow[]>`
          SELECT id, partition_key, payload, headers
          FROM outbox_events
          WHERE source = ${this.options.source} AND published_at IS NULL
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
          await tx.$executeRaw`UPDATE outbox_events SET attempts = attempts + 1, last_error = ${message}
            WHERE id = ANY(${ids}::bigint[])`;
          this.log.error({ err, count: rows.length }, 'outbox publish failed; will retry');
          return 0;
        }

        await tx.$executeRaw`UPDATE outbox_events SET published_at = now(), attempts = attempts + 1, last_error = NULL
          WHERE id = ANY(${ids}::bigint[])`;
        return rows.length;
      },
      { timeout: 45_000, maxWait: 5_000 },
    );
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

/**
 * One relay per shard a service writes events on (user and business shards, D3), started and
 * stopped together; shards opened later are picked up within a minute.
 */
export class ShardOutboxRelays {
  private readonly log = logger.child({ module: 'outbox-relay' });
  private readonly relays = new Map<string, OutboxRelay>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly options: {
      plane: DataPlane;
      producer: EventProducer;
      source: string;
      families: readonly ('user' | 'business')[];
      pollIntervalMs?: number;
    },
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(
      () => void this.refresh().catch((err: unknown) => this.log.error({ err }, 'relay refresh failed')),
      60_000,
    );
    this.timer.unref();
  }

  private async refresh(): Promise<void> {
    const { plane } = this.options;
    for (const family of this.options.families) {
      for (const shard of await plane.router.shards(family)) {
        const key = `${shard.clusterId}/${shard.databaseName}`;
        if (this.relays.has(key)) continue;
        const db = family === 'user' ? plane.users.forShard(shard) : plane.businesses.forShard(shard);
        const relay = new OutboxRelay({
          db,
          producer: this.options.producer,
          source: this.options.source,
          ...(this.options.pollIntervalMs !== undefined && { pollIntervalMs: this.options.pollIntervalMs }),
        });
        relay.start();
        this.relays.set(key, relay);
      }
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await Promise.all([...this.relays.values()].map((r) => r.stop()));
    this.relays.clear();
  }
}
