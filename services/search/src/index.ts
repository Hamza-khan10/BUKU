import { hostname } from 'node:os';
import { loadConfig, logger, Readiness, runService, type ShutdownHook } from '@buku/common';
import { DataPlane } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  startConsumer,
} from '@buku/kafka';
import { storageFromEnv } from '@buku/media';
import { buildSearchApp } from './app.js';
import { refreshSearchStats, sweepCatalog } from './catalog/catalog-stats.js';
import { Env } from './config.js';
import { CONSUMED_TOPICS, searchEventHandler } from './events/handlers.js';
import { kafkaSearchAnalytics } from './routes.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3): search reads the catalog (DB-041) and keeps it from the business shards.
const plane = await DataPlane.start({
  service: 'search',
  databaseUrl: env.DATABASE_URL,
  ...(env.DATABASE_DIRECTORY_URL && { directoryUrl: env.DATABASE_DIRECTORY_URL }),
  useCatalog: true,
  ...(env.DATABASE_CATALOG_URL && { catalogUrl: env.DATABASE_CATALOG_URL }),
  region: env.BUKU_REGION,
  instance: `${env.SERVICE_NAME}:${hostname()}:${process.pid}`,
  poolSize: env.DATABASE_SHARD_POOL_SIZE,
});
const kafka = createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env));
const producer = new EventProducer(kafka);
await producer.connect();
const { links } = storageFromEnv(env);

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', async () => {
    await plane.catalog!.$queryRaw`SELECT 1`;
  })
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app, sync } = buildSearchApp({
  plane,
  links,
  analytics: kafkaSearchAnalytics(producer, (err) => logger.warn({ err }, 'search analytics event not sent')),
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// The catalog follows what businesses change (DB-041, D3h).
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler: searchEventHandler({ sync }),
  producer,
});

// Ranking figures (trending, reliability): now, then every 10 minutes.
const refresh = () =>
  refreshSearchStats(plane)
    .then((n) => logger.debug({ businesses: n }, 'search stats refreshed'))
    .catch((err: unknown) => logger.error({ err }, 'search stats refresh failed'));
// Every catalog row checked against its shard: the repair, and what fills an empty catalog.
const sweep = () =>
  sweepCatalog(plane, sync)
    .then((r) => logger.info(r, 'catalog swept'))
    .catch((err: unknown) => logger.error({ err }, 'catalog sweep failed'));
void sweep().then(refresh);
const statsTimer = setInterval(() => void refresh(), 10 * 60_000);
statsTimer.unref();
const sweepTimer = setInterval(() => void sweep(), env.CATALOG_SWEEP_MINUTES * 60_000);
sweepTimer.unref();

// Hooks run in REVERSE order on shutdown: stop consuming and producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => plane.close() },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
  { name: 'kafka-consumer', fn: () => consumer.stop() },
  {
    name: 'jobs',
    fn: () => {
      clearInterval(statsTimer);
      clearInterval(sweepTimer);
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
