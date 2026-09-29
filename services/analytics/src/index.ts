import { createClient as createClickHouseClient } from '@clickhouse/client';
import {
  createHttpApp,
  createJwtVerifierFromEnv,
  loadConfig,
  logger,
  Readiness,
  runService,
  type ShutdownHook,
} from '@buku/common';
import { createKafka, EventProducer, kafkaConnectionFromEnv } from '@buku/kafka';
import { Env } from './config.js';
import { registerRoutes } from './routes.js';

const env = loadConfig(Env);

// ── Dependencies ──
const clickhouse = createClickHouseClient({
  url: env.CLICKHOUSE_URL,
  username: env.CLICKHOUSE_USER,
  password: env.CLICKHOUSE_PASSWORD,
  database: env.CLICKHOUSE_DATABASE,
  request_timeout: 10_000,
});
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
const verifier = await createJwtVerifierFromEnv(env);
await producer.connect();

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('clickhouse', async () => {
    const { success } = await clickhouse.ping();
    if (!success) throw new Error('clickhouse ping failed');
  })
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const app = createHttpApp({
  service: env.SERVICE_NAME,
  logger,
  readiness,
  trustProxyHops: env.TRUST_PROXY_HOPS,
  bodyLimit: env.HTTP_BODY_LIMIT,
  routes: (router) => registerRoutes(router, { clickhouse, producer, verifier }),
});

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'clickhouse', fn: () => clickhouse.close() },
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
