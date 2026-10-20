import { hostname } from 'node:os';
import {
  createHttpApp,
  createJwtVerifierFromEnv,
  createRedisClient,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
} from '@buku/common';
import { DataPlane } from '@buku/database';
import { createKafka, EventProducer, kafkaConnectionFromEnv } from '@buku/kafka';
import { Env } from './config.js';
import { registerRoutes } from './routes.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3h): campaigns on business shards; the ads that may run, in the catalog (DB-041).
const plane = await DataPlane.start({
  service: 'ads',
  databaseUrl: env.DATABASE_URL,
  ...(env.DATABASE_DIRECTORY_URL && { directoryUrl: env.DATABASE_DIRECTORY_URL }),
  useCatalog: true,
  ...(env.DATABASE_CATALOG_URL && { catalogUrl: env.DATABASE_CATALOG_URL }),
  region: env.BUKU_REGION,
  instance: `${env.SERVICE_NAME}:${hostname()}:${process.pid}`,
  poolSize: env.DATABASE_SHARD_POOL_SIZE,
});
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
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

const app = createHttpApp({
  service: env.SERVICE_NAME,
  logger,
  readiness,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  bodyLimit: env.HTTP_BODY_LIMIT,
  routes: (router) => registerRoutes(router, { plane, redis, producer, verifier }),
});

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
];

await runService({
  app,
  port: env.PORT,
  logger,
  readiness,
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS,
  hooks,
});
