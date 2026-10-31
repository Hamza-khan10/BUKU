import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../database/test/int-env.js';
import {
  createEvent,
  createKafka,
  EventProducer,
  startConsumer,
  TOPICS,
  type EventEnvelope,
  type RunningConsumer,
} from '../src/index.js';

/**
 * End-to-end tests against the real Kafka broker. Each test uses a fresh consumer group and
 * filters by its own event ids, so tests are independent of whatever else is on the topic. (The
 * outbox and handling each event once live on the shards: packages/database/test/business-shard.)
 */
const kafka = createKafka({
  brokers: testEnv.kafkaBrokers.split(','),
  clientId: 'int-test',
  sasl: testEnv.kafkaSasl,
});
const producer = new EventProducer(kafka);
const consumers: RunningConsumer[] = [];

beforeAll(async () => {
  await producer.connect();
});

afterAll(async () => {
  await Promise.all(consumers.map((c) => c.stop()));
  await producer.disconnect();
});

/** Resolves when `predicate` has been true for a received event, or rejects on timeout. */
function collect<T>(timeoutMs = 45_000) {
  const received: T[] = [];
  const waiters: { predicate: (items: T[]) => boolean; resolve: () => void }[] = [];
  return {
    push(item: T) {
      received.push(item);
      for (const w of waiters) if (w.predicate(received)) w.resolve();
    },
    until(predicate: (items: T[]) => boolean): Promise<T[]> {
      if (predicate(received)) return Promise.resolve(received);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timed out; got ${received.length} items`)),
          timeoutMs,
        );
        waiters.push({
          predicate,
          resolve: () => {
            clearTimeout(timer);
            resolve(received);
          },
        });
      });
    },
  };
}

const groupId = () => `int-test-${randomUUID()}`;
const newSubject = () => randomUUID();

describe('producer → consumer', () => {
  it('delivers a validated envelope with its headers and key', async () => {
    const inbox = collect<{ event: EventEnvelope; key: string | null }>();
    consumers.push(
      await startConsumer({
        kafka,
        producer,
        groupId: groupId(),
        topics: [TOPICS.ANALYTICS_EVENTS],
        handler: (event, ctx) => {
          inbox.push({ event, key: ctx.key });
          return Promise.resolve();
        },
      }),
    );

    const event = createEvent({
      type: TOPICS.ANALYTICS_EVENTS,
      source: 'int-test',
      subject: newSubject(),
      data: { hello: 'world' },
      correlationId: 'req-123',
    });
    await producer.publish(event);

    const got = await inbox.until((items) => items.some((i) => i.event.id === event.id));
    const match = got.find((i) => i.event.id === event.id)!;
    expect(match.event).toEqual(event);
    expect(match.key).toBe(event.subject);
  });
});

describe('failure handling', () => {
  it('retries a failing handler, then parks the message in the dead-letter topic', async () => {
    const subject = newSubject();
    let attempts = 0;
    consumers.push(
      await startConsumer({
        kafka,
        producer,
        groupId: groupId(),
        topics: [TOPICS.ANALYTICS_SEARCH],
        maxAttempts: 3,
        handler: (event) => {
          if (event.subject === subject) attempts++;
          return event.subject === subject
            ? Promise.reject(new Error('downstream is down'))
            : Promise.resolve();
        },
      }),
    );

    const dlq = collect<{ sourceTopic: string; reason: string; attempts: number; rawValue: string }>();
    const dlqReader = kafka.consumer({ kafkaJS: { groupId: groupId(), fromBeginning: true } });
    await dlqReader.connect();
    await dlqReader.subscribe({ topics: [TOPICS.DLQ_FAILED_EVENTS] });
    await dlqReader.run({
      eachMessage: ({ message }) => {
        dlq.push(JSON.parse(message.value!.toString()) as never);
        return Promise.resolve();
      },
    });
    consumers.push({ stop: () => dlqReader.disconnect() });

    await producer.publish(
      createEvent({ type: TOPICS.ANALYTICS_SEARCH, source: 'int-test', subject, data: {} }),
    );

    const parked = await dlq.until((items) => items.some((i) => i.rawValue.includes(subject)));
    const record = parked.find((i) => i.rawValue.includes(subject))!;
    expect(record).toMatchObject({
      sourceTopic: TOPICS.ANALYTICS_SEARCH,
      reason: 'handler_failed',
      attempts: 3,
    });
    expect(attempts).toBe(3);
  });
});
