import { loadConfig, logger, Readiness, runService, type ShutdownHook } from '@buku/common';
import { createDatabaseClient, pingDatabase } from '@buku/database';
import { createKafka, EventProducer, kafkaConnectionFromEnv } from '@buku/kafka';
import { storageFromEnv } from '@buku/media';
import { buildSearchApp } from './app.js';
import { Env } from './config.js';
import { kafkaSearchAnalytics } from './routes.js';
import { refreshSearchStats } from './stats.js';

const env = loadConfig(Env);

// ── Dependencies ──
const db = createDatabaseClient({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_SIZE,
  applicationName: env.SERVICE_NAME,
});
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
await producer.connect();
const { links } = storageFromEnv(env);

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app } = buildSearchApp({
  db,
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

// Ranking figures (trending, reliability): now, then every 10 minutes.
const refresh = () =>
  refreshSearchStats(db)
    .then((n) => logger.debug({ businesses: n }, 'search stats refreshed'))
    .catch((err: unknown) => logger.error({ err }, 'search stats refresh failed'));
await refresh();
const statsTimer = setInterval(() => void refresh(), 10 * 60_000);
statsTimer.unref();

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
  {
    name: 'jobs',
    fn: () => {
      clearInterval(statsTimer);
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
