import { randomUUID } from 'node:crypto';
import { createDatabaseClient, type Database } from '@buku/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../database/test/int-env.js';
import {
  createEvent,
  createKafka,
  enqueueEvent,
  EventProducer,
  OutboxRelay,
  processOnce,
  startConsumer,
  TOPICS,
  type EventEnvelope,
  type RunningConsumer,
} from '../src/index.js';

/**
 * End-to-end tests against the real Kafka broker and the `buku_test` database.
 * Each test uses a fresh consumer group and filters by its own event ids, so
 * tests are independent of whatever else is on the topic.
 */
const kafka = createKafka({ brokers: testEnv.kafkaBrokers.split(','), clientId: 'int-test' });
const producer = new EventProducer(kafka);
let db: Database;
const consumers: RunningConsumer[] = [];

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'kafka-int-test', maxConnections: 4 });
  await producer.connect();
});

afterAll(async () => {
  await Promise.all(consumers.map((c) => c.stop()));
  await producer.disconnect();
  await db.$disconnect();
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

describe('transactional outbox', () => {
  it('publishes an event only if the business transaction commits', async () => {
    const inbox = collect<EventEnvelope>();
    consumers.push(
      await startConsumer({
        kafka,
        producer,
        groupId: groupId(),
        topics: [TOPICS.BUSINESSES_UPDATED],
        handler: (event) => {
          inbox.push(event);
          return Promise.resolve();
        },
      }),
    );

    const committed = createEvent({
      type: TOPICS.BUSINESSES_UPDATED,
      source: 'int-test',
      subject: newSubject(),
      data: { v: 1 },
    });
    const rolledBack = createEvent({
      type: TOPICS.BUSINESSES_UPDATED,
      source: 'int-test',
      subject: newSubject(),
      data: { v: 2 },
    });

    await db.$transaction(async (tx) => {
      await enqueueEvent(tx, committed, 'business');
    });
    await db
      .$transaction(async (tx) => {
        await enqueueEvent(tx, rolledBack, 'business');
        throw new Error('business rule failed → roll back everything');
      })
      .catch(() => undefined);

    // Each service's relay publishes only that service's events (D-092): this one, 'int-test'.
    // Earlier runs may have left 'int-test' events too: run it until OUR event is out.
    const relay = new OutboxRelay({ db, producer, source: 'int-test', pollIntervalMs: 100 });
    const isPublished = async () =>
      (await db.outboxEvent.findFirst({ where: { aggregateId: committed.subject } }))?.publishedAt != null;
    for (let i = 0; i < 50 && !(await isPublished()); i++) await relay.runOnce();
    expect(await isPublished()).toBe(true);

    const got = await inbox.until((items) => items.some((e) => e.id === committed.id));
    expect(got.some((e) => e.id === committed.id)).toBe(true);

    // The rolled-back event never reached the outbox, so it can never be published.
    const rows = await db.outboxEvent.findMany({
      where: { aggregateId: { in: [committed.subject, rolledBack.subject] } },
    });
    expect(rows.map((r) => r.aggregateId)).toEqual([committed.subject]);
    expect(rows[0]!.publishedAt).not.toBeNull();
  });

  it('a service’s relay never publishes another service’s events (D-092)', async () => {
    const theirs = createEvent({
      type: TOPICS.BUSINESSES_UPDATED,
      source: 'other-int-test',
      subject: newSubject(),
      data: {},
    });
    await db.$transaction(async (tx) => {
      await enqueueEvent(tx, theirs, 'business');
    });
    const row = await db.outboxEvent.findFirstOrThrow({ where: { aggregateId: theirs.subject } });
    expect(row.source).toBe('other-int-test');

    const mine = new OutboxRelay({ db, producer, source: 'int-test', pollIntervalMs: 100 });
    for (let i = 0; i < 5; i++) await mine.runOnce();
    expect((await db.outboxEvent.findFirstOrThrow({ where: { id: row.id } })).publishedAt).toBeNull();

    // Its own relay does.
    const own = new OutboxRelay({ db, producer, source: 'other-int-test', pollIntervalMs: 100 });
    for (
      let i = 0;
      i < 50 && !(await db.outboxEvent.findFirstOrThrow({ where: { id: row.id } })).publishedAt;
      i++
    ) {
      await own.runOnce();
    }
    expect((await db.outboxEvent.findFirstOrThrow({ where: { id: row.id } })).publishedAt).not.toBeNull();
  });
});

describe('idempotent consumption', () => {
  it('runs a side effect once per event id, even if the event is delivered twice', async () => {
    const eventId = randomUUID();
    let sideEffects = 0;
    const run = () =>
      processOnce(db, 'int-test-consumer', eventId, () => {
        sideEffects++;
        return Promise.resolve();
      });
    expect(await run()).toBe(true);
    expect(await run()).toBe(false);
    expect(sideEffects).toBe(1);
  });

  it('does not mark the event processed if the side effect fails (so it will be retried)', async () => {
    const eventId = randomUUID();
    await expect(
      processOnce(db, 'int-test-consumer', eventId, () => Promise.reject(new Error('boom'))),
    ).rejects.toThrow('boom');
    expect(await processOnce(db, 'int-test-consumer', eventId, () => Promise.resolve())).toBe(true);
  });
});
