import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  createBlindIndexer,
  createFieldCipher,
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  generateConfirmationCode,
  ID_EPOCH_MS,
  parseKeyring,
  publicId,
  Readiness,
  type BlindIndexer,
  type FieldCipher,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { DataPlane, type BusinessTx } from '@buku/database';
import { createEvent, type EventHandler, type Topic } from '@buku/kafka';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { SERVICES_DIRECTORY, servicesWorld } from '../../../packages/database/test/services-world.js';
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
 * notification-service on database v2 (D3f) and the real Valkey, with fake senders that record
 * what each person would get, as notification-service's own role on the services' test world
 * (packages/database/test/services-world.ts). Fixtures are written as the other services write
 * them, through a second data plane signed in as buku_app: people on user shards with their
 * public-ID handles, businesses on the business shard, appointments with the customer's side
 * (their list, how the visit ended) as booking-service keeps it. Push tokens containing "gone"
 * behave like uninstalled apps. Call `useNotificationHarness()` at the top of a test file.
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

export const TZ = 'Asia/Karachi';

export interface Person {
  id: bigint;
  publicId: string;
  name: string;
  /** An access token's headers. */
  auth: Record<string, string>;
}

export interface Harness {
  app: Express;
  /** notification-service's own data plane. */
  plane: DataPlane;
  /** Fixtures and checks, as buku_app (row-level security still applies, DB-020). */
  world: DataPlane;
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

export interface Shop {
  owner: Person;
  customer: Person;
  business: { id: bigint; publicId: string; slug: string; name: string; timezone: string };
  service: { id: bigint; name: string };
  staffA: { id: bigint; displayName: string };
  staffB: { id: bigint; displayName: string };
}
export interface Visit {
  id: bigint;
  publicId: string;
  code: string;
  startAt: Date;
}

/** An ID made at `at` (DB-002: an ID starts with its time), e.g. an appointment booked then. */
export const idAt = (at: Date): bigint =>
  (BigInt(at.getTime() - ID_EPOCH_MS) << 22n) | BigInt(randomInt(1 << 22));

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export function useNotificationHarness(name: string) {
  const h = {} as Harness;

  beforeAll(async () => {
    h.plane = await DataPlane.start({
      service: 'notification',
      databaseUrl: servicesWorld.urlFor('notification'),
      directoryUrl: servicesWorld.urlFor('notification', SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `${name}:${process.pid}`,
    });
    h.world = await DataPlane.start({
      service: 'business',
      databaseUrl: servicesWorld.appUrl(),
      directoryUrl: servicesWorld.appUrl(SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `${name}-fixtures:${process.pid}`,
    });
    h.redis = createRedisClient({ url: testEnv.redisUrl, connectionName: name });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
    h.signer = await createJwtSigner({
      ...jwt,
      keyId: 'k1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const verifier = await createJwtVerifier({
      ...jwt,
      keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    });
    h.push = new FakePush();
    h.email = new FakeEmail();
    h.wa = new FakeWhatsApp();
    h.openings = new FakeOpenings();
    h.cipher = createFieldCipher(
      parseKeyring(testEnv.piiKeyring, process.env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? 'k1'),
    );
    h.indexer = createBlindIndexer(randomBytes(32));
    h.appSecret = randomBytes(24).toString('hex');
    h.verifyToken = randomBytes(24).toString('hex');
    h.whatsappNumber = '+15550001234';
    const built = buildNotificationApp({
      plane: h.plane,
      redis: h.redis,
      verifier,
      revocations: createRevocationStore(h.redis),
      push: h.push,
      email: h.email,
      whatsapp: h.wa,
      cipher: h.cipher,
      indexer: h.indexer,
      urls: { webAppUrl: 'https://app.test', publicApiUrl: 'https://api.test' },
      openings: h.openings,
      whatsappConfig: {
        businessNumber: h.whatsappNumber,
        webhook: { appSecret: h.appSecret, verifyToken: h.verifyToken },
      },
      http: {
        service: name,
        logger: createLogger({ service: name, level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    });
    Object.assign(h, {
      app: built.app,
      handle: built.handler,
      notifier: built.notifier,
      scheduler: built.scheduler,
      suggestions: built.suggestions,
      settings: built.settings,
    });
  });

  afterAll(async () => {
    await h.plane?.close();
    await h.world?.close();
    await h.redis?.quit();
  });

  return { h, x: helpers(h) };
}

const ctx = { topic: 'test', partition: 0, offset: '0', key: null, attempt: 1 };
/** Events carry internal IDs as decimal strings (DB-042). */
const asEventData = (data: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]));

function helpers(h: Harness) {
  const shardOf = (p: { id: bigint }) => h.world.user(p.id);
  const x = {
    shardOf,
    inShop: <T>(s: Shop, work: (tx: BusinessTx) => Promise<T>) => h.world.inBusiness(s.business.id, work),

    /** A person on a user shard, as auth-service makes them. */
    person: async (
      name = `Customer ${randomUUID().slice(0, 6)}`,
      role: Role = 'user',
      extra: { createdAt?: Date; managedByBusinessId?: bigint; username?: string } = {},
    ): Promise<Person> => {
      const id = h.world.id();
      const pid = publicId();
      const db = await h.world.placeUser(id);
      await db.user.create({ data: { id, publicId: pid, name, role, ...extra } });
      await h.world.handles.claim('user.public_id', Buffer.from(pid, 'ascii'), id);
      return { id, publicId: pid, name, auth: await x.authFor({ id }, role) };
    },
    authFor: async (p: { id: bigint }, role: Role = 'user') => ({
      Authorization: `Bearer ${
        (
          await h.signer.sign({
            sub: p.id.toString(),
            role,
            sid: h.world.id().toString(),
            mfa: role === 'super_admin',
          })
        ).token
      }`,
      'X-Forwarded-For': newIp(),
    }),

    deliver: async (type: Topic, data: Record<string, unknown>) => {
      const event = createEvent({
        type,
        source: 'test',
        subject: String(data.appointmentId ?? data.entryId ?? data.userId),
        data: asEventData(data),
      });
      await h.handle(event, ctx);
      return event;
    },
    redeliver: (event: ReturnType<typeof createEvent>) => h.handle(event, ctx),

    device: async (p: { id: bigint }, label: string = randomUUID(), lastSeenAt = new Date()) => {
      const token = `ExponentPushToken[${label}]`;
      await (
        await shardOf(p)
      ).pushToken.create({
        data: { id: h.world.id(), userId: p.id, token, platform: 'android', lastSeenAt },
      });
      return token;
    },
    inbox: async (p: { id: bigint }) =>
      (await shardOf(p)).notification.findMany({
        where: { userId: p.id, channel: 'in_app' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    /** Give the person a verified email address, as auth-service stores it; returns it. */
    verifiedEmail: async (p: { id: bigint }, verified = true) => {
      const address = `${randomUUID().slice(0, 8)}@example.test`;
      await (
        await shardOf(p)
      ).user.update({
        where: { id: p.id },
        data: {
          emailEnc: h.cipher.encryptBytes(address, EMAIL_CONTEXT),
          emailHash: h.indexer.digest16(EMAIL_CONTEXT, address),
          emailVerifiedAt: verified ? new Date() : null,
        },
      });
      return address;
    },
    /** Opt in to suggestions (as the app's settings screen would). */
    optIn: async (
      p: { id: bigint },
      prefs: { suggestions?: boolean; marketingEmails?: boolean } = { suggestions: true },
      at = new Date(),
    ) =>
      (await shardOf(p)).notificationPreference.upsert({
        where: { userId: p.id },
        create: {
          userId: p.id,
          ...prefs,
          ...(prefs.suggestions && { suggestionsConsentAt: at }),
          ...(prefs.marketingEmails && { marketingConsentAt: at }),
        },
        update: {},
      }),

    /** A business with an owner, a customer, a Haircut and two employees (as business-service makes it). */
    shop: (opts: { status?: 'pending' | 'verified' | 'suspended' } = {}): Promise<Shop> =>
      makeShop(h, (name, role) => x.person(name, role), opts),
    /** A team member in `role`, as auth-service adds them. */
    member: async (s: Shop, role: 'manager' | 'front_desk' | 'staff') => {
      const p = await x.person(`Team ${role}`);
      await x.inShop(s, (tx) =>
        tx.businessMember.create({
          data: { id: h.world.id(), businessId: s.business.id, userId: p.id, role },
        }),
      );
      return p;
    },

    /**
     * An appointment on the business's shard (straight in: no booking rules), with the customer's
     * side kept as booking-service keeps it. Booked `bookedAt` (its ID says so; default: now).
     */
    appointment: async (
      s: Shop,
      opts: {
        customer?: Person;
        status?: 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'no_show';
        startAt?: Date;
        bookedAt?: Date;
        staffId?: bigint | null;
        checkedInAt?: Date;
      } = {},
    ): Promise<Visit> => {
      const day = new Date(Date.now() + 2 * 86_400_000);
      const startAt =
        opts.startAt ?? new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), 5, 30));
      const customer = opts.customer ?? s.customer;
      const id = opts.bookedAt ? idAt(opts.bookedAt) : h.world.id();
      const a = await x.inShop(s, (tx) =>
        tx.appointment.create({
          data: {
            id,
            businessId: s.business.id,
            serviceId: s.service.id,
            staffId: opts.staffId === undefined ? s.staffA.id : opts.staffId,
            userId: customer.id,
            status: opts.status ?? 'confirmed',
            startAt,
            endAt: new Date(startAt.getTime() + 30 * 60_000),
            blockedUntil: new Date(startAt.getTime() + 30 * 60_000),
            priceMinor: 80_000n,
            currency: 'PKR',
            code: generateConfirmationCode(),
            publicId: publicId(),
            customerName: customer.name,
            ...(opts.checkedInAt && { checkedInAt: opts.checkedInAt }),
          },
        }),
      );
      await x.sync(s, a.id);
      return { id: a.id, publicId: a.publicId, code: a.code, startAt: a.startAt };
    },
    /** Change an appointment on the business's shard, then the customer's side. */
    update: async (s: Shop, a: { id: bigint }, data: Record<string, unknown>) => {
      await x.inShop(s, (tx) => tx.appointment.updateMany({ where: { id: a.id }, data }));
      await x.sync(s, a.id);
    },
    /** The customer's side of an appointment (their list; how the visit ended), as booking keeps it. */
    sync: async (s: Shop, appointmentId: bigint) => {
      const a = await x.inShop(s, (tx) =>
        tx.appointment.findFirstOrThrow({ where: { id: appointmentId }, include: { service: true } }),
      );
      const db = await h.world.user(a.userId);
      const view = {
        businessId: a.businessId,
        version: BigInt(a.version),
        startAt: a.startAt,
        endAt: a.endAt,
        appointmentPublicId: a.publicId,
        status: a.status,
        businessName: s.business.name,
        serviceName: a.service.name,
      };
      const key = { userId_appointmentId: { userId: a.userId, appointmentId: a.id } };
      await db.userAppointment.upsert({
        where: key,
        create: { userId: a.userId, appointmentId: a.id, ...view },
        update: view,
      });
      const kind =
        a.status === 'completed' || (a.status === 'confirmed' && a.checkedInAt)
          ? 'visit'
          : a.status === 'no_show'
            ? 'no_show'
            : null;
      const outcome = { userId_refId: { userId: a.userId, refId: a.id } };
      if (!kind) await db.userVisitOutcome.deleteMany({ where: { userId: a.userId, refId: a.id } });
      else
        await db.userVisitOutcome.upsert({
          where: outcome,
          create: {
            userId: a.userId,
            refId: a.id,
            businessId: a.businessId,
            happenedAt: a.startAt,
            kind,
            source: 'appointment',
          },
          update: { kind, happenedAt: a.startAt },
        });
    },
  };
  return x;
}
export type Helpers = ReturnType<typeof helpers>;

/** A business as business-service registers it (D3c), with a menu and a team. */
async function makeShop(
  h: Harness,
  person: (name: string, role: Role) => Promise<Person>,
  opts: { status?: 'pending' | 'verified' | 'suspended' },
): Promise<Shop> {
  const { world } = h;
  const owner = await person('Owner', 'business_owner');
  const customer = await person('Ayesha Noor Khan', 'user');
  const suffix = randomUUID().slice(-12);
  const id = world.id();
  const pid = publicId();
  const slug = `barber-${suffix}`;
  const name = `Test Barber ${suffix}`;
  await world.placeBusiness(id);
  await world.handles.claim('business.slug', Buffer.from(slug, 'utf8'), id);
  await world.handles.claim('business.public_id', Buffer.from(pid, 'ascii'), id);
  const serviceId = world.id();
  const [staffA, staffB] = [
    { id: world.id(), displayName: 'Staff A' },
    { id: world.id(), displayName: 'Staff B' },
  ];
  await world.inBusiness(id, async (tx) => {
    await tx.business.create({
      data: {
        id,
        publicId: pid,
        ownerUserId: owner.id,
        categoryId: 1n,
        name,
        slug,
        city: 'Lahore',
        country: 'PK',
        timezone: TZ,
        currency: 'PKR',
        status: opts.status ?? 'pending',
      },
    });
    await tx.service.create({
      data: {
        id: serviceId,
        businessId: id,
        name: 'Haircut',
        durationMinutes: 30,
        priceMinor: 80_000n,
        currency: 'PKR',
      },
    });
    for (const s of [staffA, staffB]) await tx.staff.create({ data: { ...s, businessId: id } });
  });
  return {
    owner,
    customer,
    business: { id, publicId: pid, slug, name, timezone: TZ },
    service: { id: serviceId, name: 'Haircut' },
    staffA,
    staffB,
  };
}
