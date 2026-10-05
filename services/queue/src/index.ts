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
import { createDatabaseClient, pingDatabase } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  startConsumer,
} from '@buku/kafka';
import { Env } from './config.js';
import { buildQueueApp } from './app.js';
import { CONSUMED_TOPICS, queueEventHandler } from './events/handlers.js';

const env = loadConfig(Env);

// ── Dependencies ──
const db = createDatabaseClient({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_SIZE,
  applicationName: env.SERVICE_NAME,
});
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const kafka = createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env));
const producer = new EventProducer(kafka);
const verifier = await createJwtVerifierFromEnv(env);
await producer.connect();

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('valkey', () => redis.ping())
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

// A subscribed Valkey connection can't run other commands: live updates get their own.
const subscriber = createRedisClient({ url: env.REDIS_URL, connectionName: `${env.SERVICE_NAME}-live` });
const { app, live, queue } = buildQueueApp({
  db,
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

// Reacts to other services' events (an account closed → its places in line given up).
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler: queueEventHandler({ queue }),
  producer,
});

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
  {
    name: 'valkey',
    fn: async () => {
      await redis.quit();
    },
  },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
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
