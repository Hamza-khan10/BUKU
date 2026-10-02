import {
  createJwtVerifierFromEnv,
  createRedisClient,
  createRevocationStore,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
  tcpPing,
} from '@buku/common';
import { createDatabaseClient, maintainPartitions, pingDatabase } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  startConsumer,
} from '@buku/kafka';
import { buildNotificationApp } from './app.js';
import { Env } from './config.js';
import { CONSUMED_TOPICS } from './events/handlers.js';
import { ExpoPushSender } from './push/expo.js';
import { LogPushSender } from './push/sender.js';

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
const push =
  env.PUSH_PROVIDER === 'expo'
    ? new ExpoPushSender({ accessToken: env.EXPO_ACCESS_TOKEN })
    : new LogPushSender();
logger.info({ push: push.name }, 'push sender');

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('valkey', () => redis.ping())
  .add('smtp', () => tcpPing(env.SMTP_HOST, env.SMTP_PORT))
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app, notifier, handler } = buildNotificationApp({
  db,
  redis,
  verifier,
  revocations: createRevocationStore(redis),
  push,
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// Booking and queue events → inbox and push.
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler,
  producer,
});

// ── Background jobs ──
const every = (minutes: number, name: string, job: () => Promise<unknown>) => {
  const timer = setInterval(() => {
    job().catch((err: unknown) => logger.error({ err, job: name }, 'background job failed'));
  }, minutes * 60_000);
  timer.unref();
  return timer;
};
// Expo receipts: delivered / failed, and devices that no longer exist are switched off.
const receipts = every(10, 'push-receipts', async () => {
  const r = await notifier.checkReceipts();
  if (r.checked) logger.info(r, 'push receipts checked');
});
// Monthly partitions (inbox, audit log, ad events) months ahead; rows in the catch-all are a red flag.
const partitionJob = async () => {
  const r = await maintainPartitions(db);
  if (Object.keys(r.strayRows).length)
    logger.warn({ strayRows: r.strayRows }, 'rows in DEFAULT partitions: a month was missing');
};
await partitionJob();
const partitions = every(24 * 60, 'partitions', partitionJob);

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
    name: 'jobs',
    fn: () => {
      clearInterval(receipts);
      clearInterval(partitions);
      return Promise.resolve();
    },
  },
];

await runService({
  app,
  port: env.PORT,
  logger,
  readiness,
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS,
  hooks,
});
