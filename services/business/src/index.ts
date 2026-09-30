import {
  createJwtVerifierFromEnv,
  createRedisClient,
  createRevocationStore,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
} from '@buku/common';
import { createDatabaseClient, pingDatabase } from '@buku/database';
import { createKafka, EventProducer, kafkaConnectionFromEnv, OutboxRelay } from '@buku/kafka';
import { buildBusinessApp } from './app.js';
import { Env } from './config.js';

const env = loadConfig(Env);

// ── Dependencies ──
const db = createDatabaseClient({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_SIZE,
  applicationName: env.SERVICE_NAME,
});
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
const verifier = await createJwtVerifierFromEnv(env);
await producer.connect();
// Publishes committed outbox events (businesses.*). Only one relay across all
// services is active at a time (advisory lock), so running one here is safe.
const relay = new OutboxRelay({ db, producer });
relay.start();

// ── Readiness ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('valkey', () => redis.ping())
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const app = buildBusinessApp({
  db,
  redis,
  verifier,
  revocations: createRevocationStore(redis),
  settings: {
    businessTermsVersion: env.BUSINESS_TERMS_VERSION,
    maxBusinessesPerOwner: env.MAX_BUSINESSES_PER_OWNER,
  },
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// Hooks run in REVERSE order on shutdown.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
  {
    name: 'valkey',
    fn: async () => {
      await redis.quit();
    },
  },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
  { name: 'outbox-relay', fn: () => relay.stop() },
];

await runService({ app, port: env.PORT, logger, readiness, shutdownDelayMs: env.SHUTDOWN_DELAY_MS, hooks });
