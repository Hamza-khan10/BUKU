import { hostname } from 'node:os';
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
import { DataPlane } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  ShardOutboxRelays,
  startConsumer,
} from '@buku/kafka';
import { storageFromEnv } from '@buku/media';
import { buildBookingApp } from './app.js';
import { Env } from './config.js';
import { bookingEventHandler, CONSUMED_TOPICS } from './events/handlers.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3): appointments on business shards, each customer's side on their user shard.
const plane = await DataPlane.start({
  service: 'booking',
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
const { links } = storageFromEnv(env);
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

const { app, staff, appointments, persons, sweeper } = buildBookingApp({
  plane,
  redis,
  verifier,
  revocations: createRevocationStore(redis),
  mediaLinks: links,
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// Reacts to other services' events (an employee left → no longer bookable; an account closed →
// its upcoming visits cancelled) and to its own (each customer's side of an appointment, D3d).
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler: bookingEventHandler({ staff, appointments, persons }),
  producer,
});

// Publishes this service's committed outbox events (bookings.*, reviews.*, from business shards):
// each service its own (D-092).
const relays = new ShardOutboxRelays({ plane, producer, source: 'booking-service', families: ['business'] });
await relays.start();
// Claims on people's shards that lapsed, ended, or are too old to count.
sweeper.start();

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
  { name: 'claim-sweeper', fn: () => sweeper.stop() },
  { name: 'kafka-consumer', fn: () => consumer.stop() },
];

await runService({
  app,
  port: env.PORT,
  logger,
  readiness,
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS,
  hooks,
});
