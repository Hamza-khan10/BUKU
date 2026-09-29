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

  const consumer = options.kafka.consumer({
    kafkaJS: {
      groupId: options.groupId,
      fromBeginning: options.fromBeginning ?? true,
      autoCommit: false,
      sessionTimeout: 30_000,
      heartbeatInterval: 3_000,
      allowAutoTopicCreation: false,
    },
  });

  await consumer.connect();
  await consumer.subscribe({ topics: options.topics });

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

  await consumer.run({
    partitionsConsumedConcurrently: options.partitionsConsumedConcurrently ?? 1,
    eachMessage: async (payload) => {
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
    },
  });

  log.info({ topics: options.topics }, 'consumer started');
  return {
    async stop() {
      await consumer.disconnect();
      log.info('consumer stopped');
    },
  };
}
