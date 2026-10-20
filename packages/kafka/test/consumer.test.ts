import { describe, expect, it } from 'vitest';
import type { KafkaJS } from '@confluentinc/kafka-javascript';
import { z } from 'zod';
import { startConsumer } from '../src/consumer.js';
import { createEvent } from '../src/envelope.js';
import type { EventProducer } from '../src/producer.js';
import { TOPICS } from '../src/topics.js';

/**
 * The consumer's watchdog, with a stand-in for Kafka (no broker needed): each
 * consumer it hands out says how many partitions it holds, and can fail to
 * connect — what a consumer looks like after Kafka was away.
 */

interface FakeConsumer {
  connected: boolean;
  runs: number;
  partitions: number;
  failConnect: boolean;
}

function fakeKafka(plan: { partitions: number; failConnect?: boolean }[]) {
  const made: FakeConsumer[] = [];
  const kafka = {
    consumer: () => {
      const step = plan[Math.min(made.length, plan.length - 1)]!;
      const state: FakeConsumer = {
        connected: false,
        runs: 0,
        partitions: step.partitions,
        failConnect: Boolean(step.failConnect),
      };
      made.push(state);
      return {
        connect: () => {
          if (state.failConnect) return Promise.reject(new Error('all broker connections are down'));
          state.connected = true;
          return Promise.resolve();
        },
        subscribe: () => Promise.resolve(),
        run: () => {
          state.runs++;
          return Promise.resolve();
        },
        disconnect: () => {
          state.connected = false;
          return Promise.resolve();
        },
        commitOffsets: () => Promise.resolve(),
        assignment: () => Array.from({ length: state.partitions }, (_, i) => ({ topic: 'x', partition: i })),
      };
    },
  } as unknown as KafkaJS.Kafka;
  return { kafka, made };
}

const options = (kafka: KafkaJS.Kafka) => ({
  kafka,
  groupId: 'test-group',
  topics: [TOPICS.BOOKINGS_CREATED],
  handler: () => Promise.resolve(),
  producer: {} as EventProducer,
  watchEveryMs: 5,
  stuckAfterMs: 20,
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('a consumer that lost its partitions recovers by itself', () => {
  it('is replaced by a fresh one once it has held nothing for too long', async () => {
    const { kafka, made } = fakeKafka([{ partitions: 0 }, { partitions: 4 }]);
    const running = await startConsumer(options(kafka));
    await wait(80);
    expect(made).toHaveLength(2);
    expect(made[0]!.connected).toBe(false); // the stuck one let go
    expect(made[1]).toMatchObject({ connected: true, runs: 1 });
    await wait(60);
    expect(made).toHaveLength(2); // the fresh one holds partitions: left alone
    await running.stop();
  });

  it('a consumer holding partitions is never replaced', async () => {
    const { kafka, made } = fakeKafka([{ partitions: 3 }]);
    const running = await startConsumer(options(kafka));
    await wait(80);
    expect(made).toHaveLength(1);
    await running.stop();
    expect(made[0]!.connected).toBe(false);
  });

  it('keeps trying while Kafka is still away, and stops looking once stopped', async () => {
    const { kafka, made } = fakeKafka([
      { partitions: 0 },
      { partitions: 0, failConnect: true },
      { partitions: 2 },
    ]);
    const running = await startConsumer(options(kafka));
    await wait(150);
    expect(made.length).toBeGreaterThanOrEqual(3);
    expect(made.at(-1)).toMatchObject({ connected: true, partitions: 2 });
    await running.stop();
    const count = made.length;
    await wait(60);
    expect(made).toHaveLength(count);
  });
});

/** A consumer handed one message, with a stand-in dead-letter topic: where did it go, and how often was it tried? */
async function deliverOnce(handler: () => Promise<void>) {
  const deadLettered: string[] = [];
  const committed: string[] = [];
  const event = createEvent({
    type: TOPICS.BOOKINGS_CREATED,
    source: 'booking-service',
    subject: '42',
    data: { businessId: '6f1c0d1e-uuid' },
  });
  const kafka = {
    consumer: () => ({
      connect: () => Promise.resolve(),
      subscribe: () => Promise.resolve(),
      run: async ({ eachMessage }: { eachMessage: (p: unknown) => Promise<void> }) => {
        await eachMessage({
          topic: TOPICS.BOOKINGS_CREATED,
          partition: 0,
          message: { offset: '7', key: null, value: Buffer.from(JSON.stringify(event)) },
        });
      },
      commitOffsets: (offsets: { offset: string }[]) => {
        committed.push(offsets[0]!.offset);
        return Promise.resolve();
      },
      assignment: () => [{ topic: 'x', partition: 0 }],
      disconnect: () => Promise.resolve(),
    }),
  } as unknown as KafkaJS.Kafka;
  const producer = {
    sendRaw: (_topic: string, m: { headers: Record<string, string> }) => {
      deadLettered.push(m.headers['dlq-reason']!);
      return Promise.resolve();
    },
  } as unknown as EventProducer;
  const running = await startConsumer({ ...options(kafka), producer, handler, maxAttempts: 2 });
  await running.stop();
  return { deadLettered, committed };
}

describe('a message its handler cannot take', () => {
  it('a payload the schema refuses goes to the dead-letter topic at once; the partition moves on', async () => {
    let tries = 0;
    const result = await deliverOnce(() => {
      tries++;
      z.object({ businessId: z.string().regex(/^[1-9][0-9]*$/) }).parse({ businessId: '6f1c0d1e-uuid' });
      return Promise.resolve();
    });
    expect(tries).toBe(1);
    expect(result).toEqual({ deadLettered: ['invalid_payload'], committed: ['8'] });
  });

  it('any other failure is retried first', async () => {
    let tries = 0;
    const result = await deliverOnce(() => {
      tries++;
      return Promise.reject(new Error('database blip'));
    });
    expect(tries).toBe(2);
    expect(result).toEqual({ deadLettered: ['handler_failed'], committed: ['8'] });
  });
});
