import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { logger } from '@buku/common';
import { parseEnvelope, type EventEnvelope } from './envelope.js';
import type { EventProducer } from './producer.js';
import { TOPICS, type Topic } from './topics.js';

/**
 * Consumer with the delivery guarantees every BUKU consumer needs:
 *
 *  • AT-LEAST-ONCE: offsets are committed manually, only after the handler
 *    succeeded (or the message was parked in the DLQ). A crash mid-handler
 *    means the message is redelivered — so handlers must be IDEMPOTENT
 *    (use `processOnce`, keyed by the event id).
 *  • RETRY with exponential backoff for transient failures (DB blip, 5xx).
 *  • POISON-MESSAGE ISOLATION: after `maxAttempts`, or immediately if the
 *    message is not a valid envelope, it is published to a dead-letter topic
 *    with full context and the partition moves on. One bad message never
 *    blocks a partition forever.
 *  • If even the DLQ write fails, the offset is NOT committed and the error
 *    propagates, so the message is retried rather than silently lost.
 *  • SELF-HEALING: after Kafka has been away, the client can lose its
 *    partitions and never rejoin — the service still answers HTTP, but no
 *    event is handled again until someone restarts it. A watchdog checks
 *    every `watchEveryMs`; a consumer that has held no partitions for
 *    `stuckAfterMs` is replaced by a fresh one (committed offsets mean
 *    nothing is lost or handled twice), and says so in the log.
 */

export interface MessageContext {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  attempt: number;
}

export type EventHandler = (event: EventEnvelope, context: MessageContext) => Promise<void>;

export interface ConsumerOptions {
  kafka: KafkaJS.Kafka;
  groupId: string;
  topics: Topic[];
  handler: EventHandler;
  /** Used to publish to the dead-letter topic. */
  producer: EventProducer;
  dlqTopic?: Topic;
  maxAttempts?: number;
  /** Start from the earliest offset when the group has no committed offset (critical topics). */
  fromBeginning?: boolean;
  partitionsConsumedConcurrently?: number;
  /** How often the watchdog looks (default 15 s). */
  watchEveryMs?: number;
  /** Replace a consumer that has held no partitions this long (default 90 s; joining takes seconds). */
  stuckAfterMs?: number;
}

export interface RunningConsumer {
  stop(): Promise<void>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const backoffMs = (attempt: number) => Math.min(200 * 2 ** (attempt - 1), 10_000);

export async function startConsumer(options: ConsumerOptions): Promise<RunningConsumer> {
  const log = logger.child({ module: 'kafka-consumer', groupId: options.groupId });
  const maxAttempts = options.maxAttempts ?? 5;
  const dlqTopic = options.dlqTopic ?? TOPICS.DLQ_FAILED_EVENTS;

  const makeConsumer = () =>
    options.kafka.consumer({
      kafkaJS: {
        groupId: options.groupId,
        fromBeginning: options.fromBeginning ?? true,
        autoCommit: false,
        sessionTimeout: 30_000,
        heartbeatInterval: 3_000,
        allowAutoTopicCreation: false,
      },
    });

  const deadLetter = async (
    payload: KafkaJS.EachMessagePayload,
    reason: string,
    error: unknown,
    attempts: number,
  ) => {
    const { topic, partition, message } = payload;
    await options.producer.sendRaw(dlqTopic, {
      key: message.key ?? null,
      value: JSON.stringify({
        reason,
        error: error instanceof Error ? error.message : String(error),
        consumerGroup: options.groupId,
        sourceTopic: topic,
        sourcePartition: partition,
        sourceOffset: message.offset,
        attempts,
        failedAt: new Date().toISOString(),
        rawValue: message.value?.toString('utf8') ?? null,
      }),
      headers: { 'dlq-reason': reason, 'dlq-source-topic': topic },
    });
    log.error(
      { topic, partition, offset: message.offset, reason, attempts, err: error },
      'message dead-lettered',
    );
  };

  const handle = async (consumer: KafkaJS.Consumer, payload: KafkaJS.EachMessagePayload) => {
    const { topic, partition, message } = payload;

    let event: EventEnvelope | undefined;
    try {
      event = parseEnvelope(message.value);
    } catch (err) {
      await deadLetter(payload, 'invalid_envelope', err, 0);
    }

    if (event) {
      for (let attempt = 1; ; attempt++) {
        try {
          await options.handler(event, {
            topic,
            partition,
            offset: message.offset,
            key: message.key?.toString('utf8') ?? null,
            attempt,
          });
          break;
        } catch (err) {
          if (attempt >= maxAttempts) {
            await deadLetter(payload, 'handler_failed', err, attempt);
            break;
          }
          log.warn({ topic, partition, offset: message.offset, attempt, err }, 'handler failed, retrying');
          await sleep(backoffMs(attempt));
        }
      }
    }

    // Commit the NEXT offset to consume.
    await consumer.commitOffsets([{ topic, partition, offset: (BigInt(message.offset) + 1n).toString() }]);
  };

  const start = async (): Promise<KafkaJS.Consumer> => {
    const consumer = makeConsumer();
    await consumer.connect();
    await consumer.subscribe({ topics: options.topics });
    await consumer.run({
      partitionsConsumedConcurrently: options.partitionsConsumedConcurrently ?? 1,
      eachMessage: (payload) => handle(consumer, payload),
    });
    return consumer;
  };

  let consumer = await start();
  log.info({ topics: options.topics }, 'consumer started');

  // ── The watchdog ──
  const watchEveryMs = options.watchEveryMs ?? 15_000;
  const stuckAfterMs = options.stuckAfterMs ?? 90_000;
  let emptySince: number | null = null;
  let busy = false;
  let stopped = false;

  const holdsPartitions = () => {
    try {
      return consumer.assignment().length > 0;
    } catch {
      return false;
    }
  };

  const watch = async () => {
    if (stopped || busy) return;
    if (holdsPartitions()) {
      emptySince = null;
      return;
    }
    emptySince ??= Date.now();
    const emptyForMs = Date.now() - emptySince;
    if (emptyForMs < stuckAfterMs) return;
    busy = true;
    log.warn({ emptyForMs }, 'consumer has held no partitions for too long; replacing it');
    try {
      await consumer.disconnect().catch(() => undefined);
      if (stopped) return;
      consumer = await start();
      emptySince = null;
      log.info('consumer replaced');
    } catch (err) {
      // Kafka may still be away: try again on the next look.
      log.error({ err }, 'replacing the consumer failed; will try again');
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void watch(), watchEveryMs);
  timer.unref();

  return {
    async stop() {
      stopped = true;
      clearInterval(timer);
      await consumer.disconnect();
      log.info('consumer stopped');
    },
  };
}
