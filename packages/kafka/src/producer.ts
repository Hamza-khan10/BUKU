import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { logger } from '@buku/common';
import type { EventEnvelope } from './envelope.js';

/**
 * Idempotent event producer.
 *
 *  acks = all (-1)   the write is acknowledged only when every in-sync
 *                    replica has it → no loss if the leader broker dies
 *  idempotent        broker de-duplicates producer retries → no duplicates
 *                    and no reordering caused by retries
 *  zstd              compression: JSON events compress ~5-10x
 *
 * Services should NOT usually publish directly after a DB write — that is a
 * "dual write" that can lose events if the process dies in between. Write the
 * event to the outbox inside the DB transaction instead (see outbox.ts); the
 * relay uses this producer.
 */
export class EventProducer {
  private readonly producer: KafkaJS.Producer;
  private connected = false;
  private readonly log = logger.child({ module: 'kafka-producer' });

  constructor(kafka: KafkaJS.Kafka) {
    this.producer = kafka.producer({
      // librdkafka settings (outside the kafkaJS block)
      'linger.ms': 5,
      'compression.type': 'zstd',
      'message.timeout.ms': 30_000,
      kafkaJS: {
        idempotent: true,
        acks: -1,
        maxInFlightRequests: 5,
        allowAutoTopicCreation: false,
      },
    });
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.producer.connect();
    this.connected = true;
    this.log.info('producer connected');
  }

  /** Publish one event. `key` defaults to the event subject (aggregate id) for per-aggregate ordering. */
  async publish(
    event: EventEnvelope,
    options: { key?: string; headers?: Record<string, string> } = {},
  ): Promise<void> {
    await this.publishMany([{ event, ...options }]);
  }

  async publishMany(
    items: { event: EventEnvelope; key?: string; headers?: Record<string, string> }[],
  ): Promise<void> {
    if (!this.connected) throw new Error('Producer is not connected');
    const byTopic = new Map<string, KafkaJS.Message[]>();
    for (const { event, key, headers } of items) {
      const messages = byTopic.get(event.type) ?? [];
      messages.push({
        key: key ?? event.subject,
        value: JSON.stringify(event),
        headers: {
          'content-type': 'application/json',
          'event-id': event.id,
          'event-type': event.type,
          'event-version': String(event.version),
          ...(event.correlationId ? { 'correlation-id': event.correlationId } : {}),
          ...headers,
        },
      });
      byTopic.set(event.type, messages);
    }
    await Promise.all([...byTopic].map(([topic, messages]) => this.producer.send({ topic, messages })));
  }

  /** Raw send, used for dead-letter records that are not event envelopes. */
  async sendRaw(topic: string, message: KafkaJS.Message): Promise<void> {
    if (!this.connected) throw new Error('Producer is not connected');
    await this.producer.send({ topic, messages: [message] });
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.producer.flush({ timeout: 10_000 });
    } finally {
      await this.producer.disconnect();
      this.connected = false;
      this.log.info('producer disconnected');
    }
  }
}
