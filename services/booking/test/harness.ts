import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  generateConfirmationCode,
  Readiness,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import { createS3Storage, MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildBookingApp } from '../src/app.js';

/**
 * Shared setup for booking-service integration tests: the real app against
 * the test database, plus helpers to create people and a ready-to-book salon.
 * Call `useBookingHarness()` at the top of a test file.
 */

export const TZ = 'Asia/Karachi';

export interface Harness {
  app: Express;
  db: Database;
  person(role?: Role, name?: string): Promise<Person>;
  salon(opts?: SalonOptions): Promise<Salon>;
  /** An appointment written straight to the database, `startInMinutes` from now (bypasses booking rules). */
  appointment(
    s: Salon,
    customer: Person,
    startInMinutes: number,
    opts?: AppointmentOptions,
  ): Promise<{ id: string; code: string }>;
}

export interface Person {
  id: string;
  name: string;
  auth: Record<string, string>;
}

export interface SalonOptions {
  staffCount?: number;
  buffer?: number;
  settings?: Record<string, unknown>;
}

export interface AppointmentOptions {
  minutes?: number;
  status?: 'pending' | 'confirmed';
  staffIndex?: number;
}

export type Salon = Awaited<ReturnType<typeof makeSalon>>;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const hex64 = () => randomBytes(32).toString('hex');

export function useBookingHarness(): Harness {
  const h = {} as Harness & { redis: Redis; signer: JwtSigner };

  beforeAll(async () => {
    h.db = createDatabaseClient({
      url: testEnv.appUrl,
      applicationName: 'booking-harness',
      maxConnections: 10,
    });
    h.redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'booking-harness' });
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
    const storage = createS3Storage({
      endpoint: testEnv.s3.endpoint,
      publicEndpoint: testEnv.s3.endpoint,
      region: 'us-east-1',
      accessKeyId: testEnv.s3.accessKeyId,
      secretAccessKey: testEnv.s3.secretAccessKey,
      forcePathStyle: true,
    });
    ({ app: h.app } = buildBookingApp({
      db: h.db,
      redis: h.redis,
      verifier,
      revocations: createRevocationStore(h.redis),
      mediaLinks: new MediaLinks(storage, {
        mediaBucket: testEnv.s3.mediaBucket,
        privateBucket: testEnv.s3.privateBucket,
      }),
      http: {
        service: 'booking-test',
        logger: createLogger({ service: 'booking-test', level: 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    }));
  });

  afterAll(async () => {
    await h.db.$disconnect();
    await h.redis.quit();
  });

  h.person = async (role: Role = 'user', name = `Customer ${randomUUID().slice(0, 6)}`) => {
    const user = await h.db.user.create({ data: { name, emailHash: hex64(), role } });
    const { token } = await h.signer.sign({
      sub: user.id,
      role,
      sid: randomUUID(),
      mfa: role === 'super_admin',
    });
    return { id: user.id, name, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
  };
  h.salon = (opts: SalonOptions = {}) => makeSalon(h, opts);
  h.appointment = async (s, customer, startInMinutes, opts = {}) => {
    const minutes = opts.minutes ?? 30;
    const startAt = new Date(Date.now() + startInMinutes * 60_000);
    const endAt = new Date(startAt.getTime() + minutes * 60_000);
    const a = await h.db.appointment.create({
      data: {
        businessId: s.b.id,
        serviceId: s.service.id,
        staffId: s.staff[opts.staffIndex ?? 0]!.id,
        userId: customer.id,
        status: opts.status ?? 'confirmed',
        startAt,
        endAt,
        blockedUntil: endAt,
        price: 800,
        currency: 'PKR',
        confirmationCode: generateConfirmationCode(),
      },
    });
    return { id: a.id, code: a.confirmationCode };
  };
  return h;
}

/** A salon open every day 09:00–17:00 with `staffCount` people who all do a 30-minute haircut. */
async function makeSalon(h: Harness, opts: SalonOptions) {
  const owner = await h.person();
  const suffix = randomUUID().slice(-12);
  const category = await h.db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const b = await h.db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Salon ${suffix}`,
      slug: `salon-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: TZ,
      currency: 'PKR',
    },
  });
  const service = await h.db.service.create({
    data: {
      businessId: b.id,
      name: 'Haircut',
      durationMinutes: 30,
      bufferMinutes: opts.buffer ?? 0,
      price: 800,
      currency: 'PKR',
    },
  });
  const staff: { id: string; displayName: string }[] = [];
  for (let i = 0; i < (opts.staffCount ?? 1); i++) {
    const s = await h.db.staff.create({ data: { businessId: b.id, displayName: `Stylist ${i + 1}` } });
    await h.db.staffService.create({ data: { staffId: s.id, serviceId: service.id } });
    await h.db.availabilityRule.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        businessId: b.id,
        staffId: s.id,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '17:00',
      })),
    });
    staff.push(s);
  }
  if (opts.settings) await h.db.bookingSettings.create({ data: { businessId: b.id, ...opts.settings } });
  /** A team member in `role`, optionally linked to a staff profile. */
  const member = async (role: 'manager' | 'front_desk' | 'staff', linkStaffIndex?: number) => {
    const p = await h.person();
    await h.db.businessMember.create({ data: { businessId: b.id, userId: p.id, role } });
    if (linkStaffIndex !== undefined) {
      await h.db.staff.update({ where: { id: staff[linkStaffIndex]!.id }, data: { userId: p.id } });
    }
    return p;
  };
  return { owner, b, service, staff, member, base: `/v1/businesses/${b.id}` };
}
