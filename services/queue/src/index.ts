import { hostname } from 'node:os';
import {
  createJwtVerifierFromEnv,
  createRevocationStore,
  createRedisClient,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
} from '@buku/common';
import { DataPlane } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  ShardOutboxRelays,
  startConsumer,
} from '@buku/kafka';
import { Env } from './config.js';
import { buildQueueApp } from './app.js';
import { CONSUMED_TOPICS, queueEventHandler } from './events/handlers.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3): sessions and tickets on business shards; each person's one ticket on theirs.
const plane = await DataPlane.start({
  service: 'queue',
  databaseUrl: env.DATABASE_URL,
  ...(env.DATABASE_DIRECTORY_URL && { directoryUrl: env.DATABASE_DIRECTORY_URL }),
  region: env.BUKU_REGION,
  instance: `${env.SERVICE_NAME}:${hostname()}:${process.pid}`,
  poolSize: env.DATABASE_SHARD_POOL_SIZE,
});
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const kafka = createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env));
const producer = new EventProducer(kafka);
const verifier = await createJwtVerifierFromEnv(env);
await producer.connect();

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', async () => {
    await plane.directory.$queryRaw`SELECT 1`;
  })
  .add('valkey', () => redis.ping())
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

// A subscribed Valkey connection can't run other commands: live updates get their own.
const subscriber = createRedisClient({ url: env.REDIS_URL, connectionName: `${env.SERVICE_NAME}-live` });
const { app, live, queue } = buildQueueApp({
  plane,
  redis,
  subscriber,
  verifier,
  revocations: createRevocationStore(redis),
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

await live.start();

// Reacts to other services' events (an account closed → its place in line given up) and to its
// own (how each ticket ended, for the person's reliability, D3e).
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler: queueEventHandler({ queue }),
  producer,
});

// Publishes this service's committed outbox events (queue.*, from business shards): each service
// its own (D-092).
const relays = new ShardOutboxRelays({ plane, producer, source: 'queue-service', families: ['business'] });
await relays.start();

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => plane.close() },
  {
    name: 'valkey',
    fn: async () => {
      await redis.quit();
    },
  },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
  { name: 'outbox-relay', fn: () => relays.stop() },
  { name: 'kafka-consumer', fn: () => consumer.stop() },
  {
    name: 'valkey-live',
    fn: async () => {
      await subscriber.quit();
    },
  },
];

await runService({
  app,
  port: env.PORT,
  logger,
  readiness,
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS,
  // Live streams never end on their own: close them first, viewers reconnect elsewhere.
  beforeClose: () => live.close(),
  hooks,
});
