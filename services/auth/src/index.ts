import {
  createBlindIndexer,
  createFieldCipher,
  createJwtSigner,
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
import { createDatabaseClient, pingDatabase } from '@buku/database';
import { createKafka, EventProducer, kafkaConnectionFromEnv, OutboxRelay } from '@buku/kafka';
import { PictureUploads, storageFromEnv } from '@buku/media';
import { buildAuthApp } from './app.js';
import { AccountPurger } from './users/data-rights.js';
import { Env } from './config.js';
import { createOidcVerifier } from './identity/oidc.js';
import { noBreachCheck, PwnedPasswords } from './members/breached-passwords.js';

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
const { storage, links } = storageFromEnv(env);
const signer = await createJwtSigner({
  privateKeyPem: env.JWT_PRIVATE_KEY,
  keyId: env.JWT_KEY_ID,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
  ttlSeconds: env.JWT_ACCESS_TTL_SECONDS,
});

// Fail fast on bad key material: sign a probe token and verify it with the
// PUBLIC key every other service uses. A mismatched pair is caught here, at
// boot, instead of as "every login returns 401" in production.
await verifier.verify(
  (await signer.sign({ sub: '00000000-0000-4000-8000-000000000000', role: 'user' })).token,
);

if (env.AUTH_DEV_LOGIN_ENABLED) logger.warn('DEV LOGIN IS ENABLED — development only');

await producer.connect();
// Publishes committed outbox events (e.g. users.registered) to Kafka.
const relay = new OutboxRelay({ db, producer });
relay.start();

// ── Readiness ──
const readiness = new Readiness()
  .add('postgres', () => pingDatabase(db))
  .add('valkey', () => redis.ping())
  .add('object-storage', () => storage.ping([env.S3_BUCKET_PRIVATE]))
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app, rights } = buildAuthApp({
  db,
  redis,
  signer,
  verifier,
  cipher: createFieldCipher(parseKeyring(env.PII_ENCRYPTION_KEYS, env.PII_ENCRYPTION_ACTIVE_KEY_ID)),
  indexer: createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64')),
  revocations: createRevocationStore(redis, env.JWT_ACCESS_TTL_SECONDS),
  storage,
  pictureUploads: new PictureUploads(storage, redis, { privateBucket: env.S3_BUCKET_PRIVATE }),
  mediaLinks: links,
  breaches: env.BREACHED_PASSWORD_CHECK
    ? new PwnedPasswords({ baseUrl: env.PWNED_PASSWORDS_URL, timeoutMs: env.PWNED_PASSWORDS_TIMEOUT_MS })
    : noBreachCheck,
  identity: {
    google: env.GOOGLE_CLIENT_IDS.length ? createOidcVerifier('google', env.GOOGLE_CLIENT_IDS) : null,
    apple: env.APPLE_SIGN_IN_ENABLED ? createOidcVerifier('apple', env.APPLE_CLIENT_IDS) : null,
  },
  settings: {
    termsVersion: env.TERMS_VERSION,
    devLoginEnabled: env.AUTH_DEV_LOGIN_ENABLED,
    sessionIdleTimeoutDays: env.SESSION_IDLE_TIMEOUT_DAYS,
    adminSessionIdleTimeoutHours: env.ADMIN_SESSION_IDLE_TIMEOUT_HOURS,
    refreshReuseGraceSeconds: env.REFRESH_REUSE_GRACE_SECONDS,
    deletionGraceDays: env.ACCOUNT_DELETION_GRACE_DAYS,
    reauthWindowMinutes: env.REAUTH_WINDOW_MINUTES,
    memberLoginMaxAttempts: env.MEMBER_LOGIN_MAX_ATTEMPTS,
    memberLockoutMinutes: env.MEMBER_LOCKOUT_MINUTES,
    maxMembersPerBusiness: env.MAX_MEMBERS_PER_BUSINESS,
  },
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// Hourly: anonymize accounts whose deletion grace period is over.
const purger = new AccountPurger(rights, (err) => logger.error({ err }, 'account purge failed'));
purger.start();

// Hooks run in REVERSE order on shutdown: stop the relay, flush Kafka, close stores.
const hooks: ShutdownHook[] = [
  { name: 'postgres', fn: () => db.$disconnect() },
  {
    name: 'valkey',
    fn: async () => {
      await redis.quit();
    },
  },
  { name: 'kafka-producer', fn: () => producer.disconnect() },
  { name: 'outbox-relay', fn: () => relay.stop() },
  { name: 'account-purger', fn: () => purger.stop() },
];

await runService({
  app,
  port: env.PORT,
  logger,
  readiness,
  shutdownDelayMs: env.SHUTDOWN_DELAY_MS,
  hooks,
});
