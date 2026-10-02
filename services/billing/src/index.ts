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
import { PaddleClient } from './paddle/client.js';

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

// Online checkout runs only when Paddle is configured (all three keys).
const paddle =
  env.PADDLE_API_KEY && env.PADDLE_CLIENT_TOKEN && env.PADDLE_WEBHOOK_SECRET
    ? {
        client: new PaddleClient({
          apiUrl:
            env.PADDLE_API_URL ??
            (env.PADDLE_ENVIRONMENT === 'production'
              ? 'https://api.paddle.com'
              : 'https://sandbox-api.paddle.com'),
          apiKey: env.PADDLE_API_KEY,
        }),
        config: {
          environment: env.PADDLE_ENVIRONMENT,
          clientToken: env.PADDLE_CLIENT_TOKEN,
          webhookSecret: env.PADDLE_WEBHOOK_SECRET,
          webhookToleranceSeconds: env.PADDLE_WEBHOOK_TOLERANCE_SECONDS,
          taxCategory: env.PADDLE_TAX_CATEGORY,
        },
      }
    : null;
if (!paddle) logger.warn('Paddle is not configured: online checkout is unavailable');

const { app, accounts } = buildBillingApp({
  db,
  paddle,
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
