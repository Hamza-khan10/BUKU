import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import {
  createBlindIndexer,
  createFieldCipher,
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  generateConfirmationCode,
  parseKeyring,
  Readiness,
  type BlindIndexer,
  type FieldCipher,
  type JwtSigner,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import { createEvent, type EventHandler, type Topic } from '@buku/kafka';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { createBusinessFixture, type BusinessFixture } from '../../../packages/database/test/fixtures.js';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildNotificationApp } from '../src/app.js';
import type { EmailMessage, EmailResult, EmailSender } from '../src/email/sender.js';
import type { Notifier } from '../src/notifier.js';
import { EMAIL_CONTEXT } from '../src/notifier.js';
import type { PushMessage, PushReceipt, PushSender, PushTicket } from '../src/push/sender.js';
import type { OpeningsFinder, Slot } from '../src/scheduler/openings.js';
import type { Scheduler } from '../src/scheduler/scheduler.js';
import type { Suggestions } from '../src/scheduler/suggestions.js';
import type { NotificationSettings } from '../src/settings.js';
import type { WhatsAppResult, WhatsAppSender } from '../src/whatsapp/sender.js';

/**
 * notification-service against the real database and Valkey, with fake
 * senders that record what each person would get. Push tokens containing
 * "gone" behave like uninstalled apps.
 */

export class FakePush implements PushSender {
  readonly name = 'fake';
  sent: PushMessage[] = [];
  private tickets = new Map<string, string>();
  accepts = () => true;
  send(messages: PushMessage[]): Promise<PushTicket[]> {
    this.sent.push(...messages);
    return Promise.resolve(
      messages.map((m) => {
        if (m.token.includes('gone-now'))
          return { ok: false as const, error: 'DeviceNotRegistered', deviceGone: true };
        const id = randomUUID();
        this.tickets.set(id, m.token);
        return { ok: true as const, id };
      }),
    );
  }
  receipts(ids: string[]): Promise<Map<string, PushReceipt>> {
    return Promise.resolve(
      new Map(
        ids.map((id) => [
          id,
          this.tickets.get(id)?.includes('gone-later')
            ? { ok: false as const, error: 'DeviceNotRegistered', deviceGone: true }
            : { ok: true as const },
        ]),
      ),
    );
  }
  to(token: string) {
    return this.sent.filter((m) => m.token === token);
  }
}

export class FakeEmail implements EmailSender {
  readonly name = 'fake';
  sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<EmailResult> {
    this.sent.push(message);
    return Promise.resolve({ ok: true, id: `<${randomUUID()}@test>` });
  }
  to(address: string) {
    return this.sent.filter((m) => m.to === address);
  }
}

export class FakeWhatsApp implements WhatsAppSender {
  readonly name = 'fake';
  sent: {
    to: string;
    kind: 'text' | 'template';
    body?: string;
    template?: string;
    params?: string[];
    id: string;
  }[] = [];
  sendText(to: string, body: string): Promise<WhatsAppResult> {
    const id = `wamid.${randomUUID()}`;
    this.sent.push({ to, kind: 'text', body, id });
    return Promise.resolve({ ok: true, id });
  }
  sendTemplate(to: string, template: string, _language: string, params: string[]): Promise<WhatsAppResult> {
    const id = `wamid.${randomUUID()}`;
    this.sent.push({ to, kind: 'template', template, params, id });
    return Promise.resolve({ ok: true, id });
  }
  to(phone: string) {
    return this.sent.filter((m) => m.to === phone);
  }
}

/** Free times as booking-service would answer; set `slots` per test, or `down` to fail. */
export class FakeOpenings implements OpeningsFinder {
  slots: Slot[] = [];
  down = false;
  asked: { businessId: string; serviceId: string; date: string; staffId?: string | undefined }[] = [];
  find(input: {
    businessId: string;
    serviceId: string;
    date: string;
    days: number;
    staffId?: string | undefined;
  }) {
    this.asked.push(input);
    if (this.down) return Promise.resolve(null);
    return Promise.resolve(this.slots.filter((s) => !input.staffId || s.staffIds.includes(input.staffId)));
  }
}

export interface Harness {
  app: Express;
  db: Database;
  redis: Redis;
  signer: JwtSigner;
  handle: EventHandler;
  notifier: Notifier;
  scheduler: Scheduler;
  suggestions: Suggestions;
  settings: NotificationSettings;
  openings: FakeOpenings;
  push: FakePush;
  email: FakeEmail;
  wa: FakeWhatsApp;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  whatsappNumber: string;
  appSecret: string;
  verifyToken: string;
}

export async function createHarness(name: string): Promise<Harness> {
  const db = createDatabaseClient({ url: testEnv.appUrl, applicationName: name, maxConnections: 5 });
  const redis = createRedisClient({ url: testEnv.redisUrl, connectionName: name });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
  const signer = await createJwtSigner({
    ...jwt,
    keyId: 'k1',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const verifier = await createJwtVerifier({
    ...jwt,
    keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
  });
  const push = new FakePush();
  const email = new FakeEmail();
  const wa = new FakeWhatsApp();
  const openings = new FakeOpenings();
  const cipher = createFieldCipher(
    parseKeyring(testEnv.piiKeyring, process.env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? 'k1'),
  );
  const indexer = createBlindIndexer(randomBytes(32));
  const appSecret = randomBytes(24).toString('hex');
  const verifyToken = randomBytes(24).toString('hex');
  const whatsappNumber = '+15550001234';
  const built = buildNotificationApp({
    db,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    push,
    email,
    whatsapp: wa,
    cipher,
    indexer,
    urls: { webAppUrl: 'https://app.test', publicApiUrl: 'https://api.test' },
    openings,
    whatsappConfig: { businessNumber: whatsappNumber, webhook: { appSecret, verifyToken } },
    http: {
      service: name,
      logger: createLogger({ service: name, level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  });
  return {
    app: built.app,
    db,
    redis,
    signer,
    handle: built.handler,
    notifier: built.notifier,
    scheduler: built.scheduler,
    suggestions: built.suggestions,
    settings: built.settings,
    openings,
    push,
    email,
    wa,
    cipher,
    indexer,
    whatsappNumber,
    appSecret,
    verifyToken,
  };
}

const ctx = { topic: 'test', partition: 0, offset: '0', key: null, attempt: 1 };

export function helpers(h: Harness) {
  const { db } = h;
  return {
    deliver: async (type: Topic, data: Record<string, unknown>) => {
      const event = createEvent({
        type,
        source: 'test',
        subject: String(data.appointmentId ?? data.entryId),
        data,
      });
      await h.handle(event, ctx);
      return event;
    },
    redeliver: (event: ReturnType<typeof createEvent>) => h.handle(event, ctx),
    device: async (userId: string, label: string = randomUUID(), lastSeenAt = new Date()) => {
      const token = `ExponentPushToken[${label}]`;
      await db.pushToken.create({ data: { userId, token, platform: 'android', lastSeenAt } });
      return token;
    },
    inbox: (userId: string) =>
      db.notification.findMany({ where: { userId, channel: 'in_app' }, orderBy: { createdAt: 'asc' } }),
    authFor: async (userId: string, role: 'user' | 'super_admin' | 'business_owner' = 'user') => ({
      Authorization: `Bearer ${(await h.signer.sign({ sub: userId, role, sid: randomUUID() })).token}`,
    }),
    /** Give the person a verified email address; returns it. */
    verifiedEmail: async (userId: string, verified = true) => {
      const address = `${randomUUID().slice(0, 8)}@example.test`;
      await db.user.update({
        where: { id: userId },
        data: {
          emailEncrypted: h.cipher.encrypt(address, EMAIL_CONTEXT),
          emailVerifiedAt: verified ? new Date() : null,
        },
      });
      return address;
    },
    member: async (businessId: string, role: 'manager' | 'front_desk' | 'staff') => {
      const u = await db.user.create({
        data: { name: `Team ${role}`, emailHash: randomUUID().replace(/-/g, '').padEnd(64, '0') },
      });
      await db.businessMember.create({ data: { businessId, userId: u.id, role } });
      return u;
    },
  };
}

/** A business with a customer and an appointment (default: two days ahead, 10:30 Lahore time). */
export async function booking(
  db: Database,
  opts: {
    staffUserId?: string;
    status?: 'pending' | 'confirmed';
    startAt?: Date;
    createdAt?: Date;
  } = {},
): Promise<{ f: BusinessFixture; a: Awaited<ReturnType<Database['appointment']['create']>> }> {
  const f = await createBusinessFixture(db);
  await db.user.update({ where: { id: f.customer.id }, data: { name: 'Ayesha Noor Khan' } });
  if (opts.staffUserId)
    await db.staff.update({ where: { id: f.staffA.id }, data: { userId: opts.staffUserId } });
  const day = new Date(Date.now() + 2 * 86_400_000);
  const startAt =
    opts.startAt ?? new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 5, 30));
  const a = await db.appointment.create({
    data: {
      businessId: f.business.id,
      serviceId: f.service.id,
      staffId: f.staffA.id,
      userId: f.customer.id,
      status: opts.status ?? 'confirmed',
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      blockedUntil: new Date(startAt.getTime() + 30 * 60_000),
      price: 800,
      currency: 'PKR',
      confirmationCode: generateConfirmationCode(),
      ...(opts.createdAt && { createdAt: opts.createdAt }),
    },
  });
  return { f, a };
}
