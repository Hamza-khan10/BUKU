import {
  createBlindIndexer,
  createFieldCipher,
  createHttpApp,
  createJwtSigner,
  createJwtVerifierFromEnv,
  createRedisClient,
  loadConfig,
  logger,
  parseKeyring,
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
const redis = createRedisClient({ url: env.REDIS_URL, connectionName: env.SERVICE_NAME });
const producer = new EventProducer(createKafka(kafkaConnectionFromEnv(env.SERVICE_NAME, process.env)));
const verifier = await createJwtVerifierFromEnv(env);

// Fail fast on bad key material: sign a probe token and verify it with the
// PUBLIC key every other service uses. A mismatched pair is caught here, at
// boot, instead of as "every login returns 401" in production.
const signer = await createJwtSigner({
  privateKeyPem: env.JWT_PRIVATE_KEY,
  keyId: env.JWT_KEY_ID,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.JWT_ACCESS_TTL_SECONDS,
});
await verifier.verify(
  (await signer.sign({ sub: '00000000-0000-4000-8000-000000000000', role: 'user' })).token,
);
const fieldCipher = createFieldCipher(
  parseKeyring(env.PII_ENCRYPTION_KEYS, env.PII_ENCRYPTION_ACTIVE_KEY_ID),
);
const blindIndexer = createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64'));
await producer.connect();

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
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
  routes: (router) =>
    registerRoutes(router, { db, redis, producer, verifier, signer, fieldCipher, blindIndexer }),
});

// Hooks run in REVERSE order on shutdown: stop producing before closing stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
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
