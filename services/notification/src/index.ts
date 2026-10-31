import { hostname } from 'node:os';
import {
  createBlindIndexer,
  createFieldCipher,
  createJwtVerifierFromEnv,
  createRedisClient,
  createRevocationStore,
  loadConfig,
  logger,
  parseKeyring,
  Readiness,
  runService,
  type ShutdownHook,
  tcpPing,
} from '@buku/common';
import { DataPlane } from '@buku/database';
import {
  consumerGroupId,
  createKafka,
  EventProducer,
  kafkaConnectionFromEnv,
  startConsumer,
} from '@buku/kafka';
import { buildNotificationApp } from './app.js';
import { Env } from './config.js';
import { SmtpEmailSender } from './email/sender.js';
import { CONSUMED_TOPICS } from './events/handlers.js';
import { ExpoPushSender } from './push/expo.js';
import { LogPushSender } from './push/sender.js';
import { HttpOpeningsFinder } from './scheduler/openings.js';
import { LogWhatsAppSender, MetaWhatsAppSender } from './whatsapp/sender.js';

const env = loadConfig(Env);

// ── Dependencies ──
// Database v2 (D3): people's inboxes, marks and connections on their user shards; what messages
// are about on business shards; the admin settings on the directory.
const plane = await DataPlane.start({
  service: 'notification',
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
await producer.connect();
const push =
  env.PUSH_PROVIDER === 'expo'
    ? new ExpoPushSender({ accessToken: env.EXPO_ACCESS_TOKEN })
    : new LogPushSender();
const email = new SmtpEmailSender({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  user: env.SMTP_USER,
  password: env.SMTP_PASSWORD,
  from: env.EMAIL_FROM,
  requireTls: env.SMTP_REQUIRE_TLS,
});
const whatsapp =
  env.WHATSAPP_PROVIDER === 'meta'
    ? new MetaWhatsAppSender({
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID!,
        accessToken: env.WHATSAPP_ACCESS_TOKEN!,
        graphVersion: env.WHATSAPP_GRAPH_VERSION,
      })
    : new LogWhatsAppSender();
logger.info({ push: push.name, whatsapp: whatsapp.name }, 'senders');

// ── Readiness: every dependency must answer before traffic is routed here ──
const readiness = new Readiness()
  .add('postgres', async () => {
    await plane.directory.$queryRaw`SELECT 1`;
  })
  .add('valkey', () => redis.ping())
  .add('smtp', () => tcpPing(env.SMTP_HOST, env.SMTP_PORT))
  .add('kafka', () =>
    producer.isConnected ? Promise.resolve() : Promise.reject(new Error('producer not connected')),
  );

const { app, notifier, scheduler, suggestions, handler } = buildNotificationApp({
  plane,
  redis,
  verifier,
  revocations: createRevocationStore(redis),
  push,
  email,
  whatsapp,
  cipher: createFieldCipher(parseKeyring(env.PII_ENCRYPTION_KEYS, env.PII_ENCRYPTION_ACTIVE_KEY_ID)),
  indexer: createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64')),
  urls: { webAppUrl: env.WEB_APP_URL, publicApiUrl: env.PUBLIC_API_URL },
  openings: new HttpOpeningsFinder(env.GATEWAY_URL),
  whatsappConfig: {
    businessNumber: env.WHATSAPP_BUSINESS_NUMBER,
    templateLanguage: env.WHATSAPP_TEMPLATE_LANGUAGE,
    webhook:
      env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN
        ? { appSecret: env.WHATSAPP_APP_SECRET, verifyToken: env.WHATSAPP_VERIFY_TOKEN }
        : undefined,
  },
  http: {
    service: env.SERVICE_NAME,
    logger,
    readiness,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    bodyLimit: env.HTTP_BODY_LIMIT,
  },
});

// Booking, review and queue events → inbox and push; a closed account's WhatsApp number let go.
const consumer = await startConsumer({
  kafka,
  groupId: consumerGroupId(env.SERVICE_NAME),
  topics: CONSUMED_TOPICS,
  handler,
  producer,
});

// ── Background jobs ──
const every = (minutes: number, name: string, job: () => Promise<unknown>) => {
  const timer = setInterval(() => {
    job().catch((err: unknown) => logger.error({ err, job: name }, 'background job failed'));
  }, minutes * 60_000);
  timer.unref();
  return timer;
};
// Expo receipts: delivered / failed, and devices that no longer exist are switched off.
const receipts = every(10, 'push-receipts', async () => {
  const r = await notifier.checkReceipts();
  if (r.checked) logger.info(r, 'push receipts checked');
});
// Timed messages. Each run is skipped if another instance is running it; each message goes once anyway.
const reminders = every(1, 'reminders', async () => {
  const r = await scheduler.exclusive('reminders', 55_000, () => scheduler.appointmentReminders());
  if (r && r.r24 + r.r2 + r.pending) logger.info(r, 'appointment reminders sent');
});
const rebook = every(5, 'rebook', async () => {
  const n = await scheduler.exclusive('rebook', 4 * 60_000, () => scheduler.rebookReminders());
  if (n) logger.info({ sent: n }, '"book again" reminders sent');
  const r = await scheduler.exclusive('review-requests', 4 * 60_000, () => scheduler.reviewRequests());
  if (r) logger.info({ sent: r }, 'review requests sent');
});
const plans = every(15, 'plan-notices', async () => {
  const n = await scheduler.exclusive('plan-notices', 14 * 60_000, () => scheduler.planNotices());
  if (n) logger.info({ sent: n }, 'plan notices sent');
});
const suggest = every(30, 'suggestions', async () => {
  const r = await scheduler.exclusive('suggestions', 29 * 60_000, () => suggestions.run());
  if (r && r.usual + r.comeBack + r.firstBooking) logger.info(r, 'suggestions sent');
});
const marks = every(24 * 60, 'purge-marks', () => scheduler.purgeMarks());
// Partitions and retention on v2's shards are pg_partman's, run by pg_cron (DB-019): nothing here.

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
  { name: 'kafka-consumer', fn: () => consumer.stop() },
  {
    name: 'jobs',
    fn: () => {
      for (const t of [receipts, reminders, rebook, plans, suggest, marks]) clearInterval(t);
      email.close();
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
