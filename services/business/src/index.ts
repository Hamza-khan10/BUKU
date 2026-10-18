import { hostname } from 'node:os';
import {
  createBlindIndexer,
  createFieldCipher,
  createJwtVerifierFromEnv,
  createRedisClient,
  createRevocationStore,
  loadConfig,
  logger,
  parseKeyring,
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
import { PictureUploads, storageFromEnv } from '@buku/media';
import { buildBusinessApp } from './app.js';
import { Env } from './config.js';
import { businessEventHandler, CONSUMED_TOPICS } from './events/handlers.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3): businesses on business shards, owners' lists on user shards, the directory.
const plane = await DataPlane.start({
  service: 'business',
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
const { storage, links } = storageFromEnv(env);
await producer.connect();
// Publishes this service's committed outbox events (businesses.*, from business shards): each
// service its own (D-092). One replica at a time per shard (advisory lock per service).
const relays = new ShardOutboxRelays({ plane, producer, source: 'business-service', families: ['business'] });
await relays.start();

// ── Readiness ──
const readiness = new Readiness()
  .add('postgres', async () => {
    await plane.directory.$queryRaw`SELECT 1`;
  })
  .add('valkey', () => redis.ping())
  .add('object-storage', () =>
    storage.ping([env.S3_BUCKET_DOCUMENTS, env.S3_BUCKET_MEDIA, env.S3_BUCKET_PRIVATE]),
  )
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app, pictures } = buildBusinessApp({
  plane,
  redis,
  verifier,
  revocations: createRevocationStore(redis),
  cipher: createFieldCipher(parseKeyring(env.PII_ENCRYPTION_KEYS, env.PII_ENCRYPTION_ACTIVE_KEY_ID)),
  indexer: createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64')),
  storage,
  pictureUploads: new PictureUploads(storage, redis, { privateBucket: env.S3_BUCKET_PRIVATE }),
  mediaLinks: links,
  settings: {
    documentsBucket: env.S3_BUCKET_DOCUMENTS,
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

// Reacts to other services' events (e.g. an employee left → remove their photo).
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler: businessEventHandler({ pictures }),
  producer,
});

// Hooks run in REVERSE order on shutdown.
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
];

await runService({ app, port: env.PORT, logger, readiness, shutdownDelayMs: env.SHUTDOWN_DELAY_MS, hooks });
