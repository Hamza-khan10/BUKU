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
import { buildBillingApp } from './app.js';
import { Env } from './config.js';

const env = loadConfig(Env);

// ── Dependencies ──
const db = createDatabaseClient({
  url: env.DATABASE_URL,
  maxConnections: env.DATABASE_POOL_SIZE,
  applicationName: env.SERVICE_NAME,
});
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const verifier = await createJwtVerifierFromEnv(env);

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness().add('postgres', () => pingDatabase(db)).add('valkey', () => redis.ping());

const { app, accounts } = buildBillingApp({
  db,
  redis,
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

// Trials and time-limited grants that ended are marked `expired` (they already stopped
// counting at their end date; this frees the account for a new plan). Idempotent.
const expiry = setInterval(
  () => {
    accounts
      .expireEnded()
      .then((n) => n > 0 && logger.info({ expired: n }, 'trials and grants expired'))
      .catch((err: unknown) => logger.error({ err }, 'expiring trials failed'));
  },
  10 * 60 * 1000,
);
expiry.unref();

// Hooks run in REVERSE order on shutdown.
const hooks: ShutdownHook[] = [
  {
    name: 'expiry',
    fn: () => {
      clearInterval(expiry);
      return Promise.resolve();
    },
  },
  { name: 'postgres', fn: () => db.$disconnect() },
  {
    name: 'valkey',
    fn: async () => {
      await redis.quit();
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
