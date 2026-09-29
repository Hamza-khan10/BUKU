import { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import {
  createHttpApp,
  createJwtVerifierFromEnv,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
} from '@buku/common';
import { createDatabaseClient, pingDatabase } from '@buku/database';
import { createKafka, EventProducer, kafkaConnectionFromEnv } from '@buku/kafka';
import { Env } from './config.js';
import { registerRoutes } from './routes.js';

const env = loadConfig(Env);

// ── Dependencies ──
const db = createDatabaseClient({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_SIZE,
  applicationName: env.SERVICE_NAME,
});
const elasticsearch = new ElasticsearchClient({
  node: env.ELASTICSEARCH_URL,
  requestTimeout: 5_000,
  maxRetries: 2,
});
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
const verifier = await createJwtVerifierFromEnv(env);
await producer.connect();

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('elasticsearch', () => elasticsearch.ping())
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const app = createHttpApp({
  service: env.SERVICE_NAME,
  logger,
  readiness,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  bodyLimit: env.HTTP_BODY_LIMIT,
  routes: (router) => registerRoutes(router, { db, elasticsearch, producer, verifier }),
});

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
  { name: 'elasticsearch', fn: () => elasticsearch.close() },
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
