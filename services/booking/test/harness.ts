import { generateKeyPairSync, randomInt, randomUUID } from 'node:crypto';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  generateConfirmationCode,
  publicId,
  Readiness,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { DataPlane, type BusinessTx, type UserShardClient } from '@buku/database';
import { createS3Storage, MediaLinks } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { SERVICES_DIRECTORY, servicesWorld } from '../../../packages/database/test/services-world.js';
import { buildBookingApp, type BookingApp } from '../src/app.js';

/**
 * Shared setup for booking-service integration tests on database v2 (D3d): the real app as
 * booking-service's own role on the services' test world (a directory, a user shard and a business
 * shard; packages/database/test/services-world.ts), plus helpers to create people and a
 * ready-to-book salon. Fixtures are written as the other services write them, through a second
 * data plane signed in as buku_app. Call `useBookingHarness()` at the top of a test file.
 */

export const TZ = 'Asia/Karachi';

export interface Harness {
  app: Express;
  /** booking-service's own pieces (the event handler and sweeper in tests). */
  booking: BookingApp;
  /** booking-service's own data plane. */
  plane: DataPlane;
  /** Fixtures and checks, as buku_app (row-level security still applies, DB-020). */
  world: DataPlane;
  signer: JwtSigner;
  person(role?: Role, name?: string): Promise<Person>;
  salon(opts?: SalonOptions): Promise<Salon>;
  /** A business with no menu or team yet (as business-service registers it), in `status`. */
  business(status?: 'pending' | 'verified' | 'suspended'): Promise<Business>;
  /**
   * An appointment written straight to the business's shard, `startInMinutes` from now (bypasses
   * booking rules), with the customer's side brought up to date as booking-service does.
   */
  appointment(
    s: Salon,
    customer: Person,
    startInMinutes: number,
    opts?: AppointmentOptions,
  ): Promise<{ id: string; internalId: bigint; code: string }>;
  /** Change an appointment straight on the business's shard, then bring the customer's side up to date. */
  update(s: Salon, a: { internalId: bigint }, data: Record<string, unknown>): Promise<void>;
  /** Work inside the salon's business. */
  inSalon<T>(s: Salon, work: (tx: BusinessTx) => Promise<T>): Promise<T>;
  /** A person's own shard. */
  shardOf(p: Person): Promise<UserShardClient>;
  /** The internal ID of an appointment of the salon, by its public ID. */
  appointmentId(s: Salon, appointmentPublicId: string): Promise<bigint>;
}

export interface Person {
  id: bigint;
  publicId: string;
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
export type Business = Awaited<ReturnType<typeof makeBusiness>>;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export function useBookingHarness(): Harness {
  const h = {} as Harness & { redis: Redis };

  beforeAll(async () => {
    h.plane = await DataPlane.start({
      service: 'booking',
      databaseUrl: servicesWorld.urlFor('booking'),
      directoryUrl: servicesWorld.urlFor('booking', SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `booking-int-test:${process.pid}`,
    });
    h.world = await DataPlane.start({
      service: 'business',
      databaseUrl: servicesWorld.appUrl(),
      directoryUrl: servicesWorld.appUrl(SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `booking-int-fixtures:${process.pid}`,
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
    h.booking = buildBookingApp({
      plane: h.plane,
      redis: h.redis,
      verifier,
      revocations: createRevocationStore(h.redis),
      mediaLinks: new MediaLinks(storage, {
        mediaBucket: testEnv.s3.mediaBucket,
        privateBucket: testEnv.s3.privateBucket,
      }),
      http: {
        service: 'booking-test',
        logger: createLogger({
          service: 'booking-test',
          level: process.env.TEST_LOG_LEVEL ?? 'silent',
        }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    });
    h.app = h.booking.app;
  });

  afterAll(async () => {
    await h.plane?.close();
    await h.world?.close();
    await h.redis?.quit();
  });

  /** A person on a user shard, as auth-service makes them, with a valid access token. */
  h.person = async (role: Role = 'user', name = `Customer ${randomUUID().slice(0, 6)}`) => {
    const id = h.world.id();
    const pid = publicId();
    const db = await h.world.placeUser(id);
    await db.user.create({ data: { id, publicId: pid, name, role } });
    await h.world.handles.claim('user.public_id', Buffer.from(pid, 'ascii'), id);
    const { token } = await h.signer.sign({
      sub: id.toString(),
      role,
      sid: h.world.id().toString(),
      mfa: role === 'super_admin',
    });
    return {
      id,
      publicId: pid,
      name,
      auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() },
    };
  };
  h.salon = (opts: SalonOptions = {}) => makeSalon(h, opts);
  h.business = (status = 'pending') => makeBusiness(h, status);
  h.inSalon = (s, work) => h.world.inBusiness(s.b.id, work);
  h.update = async (s, a, data) => {
    await h.inSalon(s, (tx) => tx.appointment.updateMany({ where: { id: a.internalId }, data }));
    await h.booking.persons.sync(s.b.id, a.internalId);
  };
  h.shardOf = (p) => h.world.user(p.id);
  h.appointmentId = async (s, appointmentPublicId) =>
    (
      await h.inSalon(s, (tx) =>
        tx.appointmentIndex.findUniqueOrThrow({ where: { publicId: appointmentPublicId } }),
      )
    ).appointmentId;
  h.appointment = async (s, customer, startInMinutes, opts = {}) => {
    const minutes = opts.minutes ?? 30;
    const startAt = new Date(Date.now() + startInMinutes * 60_000);
    const endAt = new Date(startAt.getTime() + minutes * 60_000);
    const id = h.world.id();
    const a = await h.inSalon(s, (tx) =>
      tx.appointment.create({
        data: {
          id,
          businessId: s.b.id,
          serviceId: s.service.id,
          staffId: s.staff[opts.staffIndex ?? 0]!.id,
          userId: customer.id,
          status: opts.status ?? 'confirmed',
          startAt,
          endAt,
          blockedUntil: endAt,
          priceMinor: 80_000n,
          currency: 'PKR',
          code: generateConfirmationCode(),
          publicId: publicId(),
          customerName: customer.name,
        },
      }),
    );
    await h.booking.persons.sync(s.b.id, id);
    return { id: a.publicId, internalId: id, code: a.code };
  };
  return h;
}

/** A business as business-service registers it (D3c): placed, its handles claimed, its row. */
async function makeBusiness(h: Harness, status: 'pending' | 'verified' | 'suspended') {
  const { world } = h;
  const owner = await h.person();
  const suffix = randomUUID().slice(-12);
  const id = world.id();
  const pid = publicId();
  const slug = `salon-${suffix}`;
  await world.placeBusiness(id);
  await world.handles.claim('business.slug', Buffer.from(slug, 'utf8'), id);
  await world.handles.claim('business.public_id', Buffer.from(pid, 'ascii'), id);
  await world.inBusiness(id, (tx) =>
    tx.business.create({
      data: {
        id,
        publicId: pid,
        ownerUserId: owner.id,
        categoryId: 1n,
        name: `Salon ${suffix}`,
        slug,
        city: 'Lahore',
        country: 'PK',
        timezone: TZ,
        currency: 'PKR',
        status,
      },
    }),
  );
  /** A team member in `role`, as auth-service adds them. */
  const member = async (role: 'manager' | 'front_desk' | 'staff') => {
    const p = await h.person();
    await world.inBusiness(id, (tx) =>
      tx.businessMember.create({ data: { id: world.id(), businessId: id, userId: p.id, role } }),
    );
    return p;
  };
  return {
    owner,
    b: { id, publicId: pid, slug, name: `Salon ${suffix}`, timezone: TZ },
    member,
    base: `/v1/businesses/${pid}`,
  };
}

/** A salon open every day 09:00–17:00 with `staffCount` people who all do a 30-minute haircut. */
async function makeSalon(h: Harness, opts: SalonOptions) {
  const { world } = h;
  const { owner, b, member: addMember, base } = await makeBusiness(h, 'pending');
  const id = b.id;
  const serviceId = world.id();
  const staff: { id: bigint; displayName: string }[] = [];
  await world.inBusiness(id, async (tx) => {
    await tx.service.create({
      data: {
        id: serviceId,
        businessId: id,
        name: 'Haircut',
        durationMinutes: 30,
        bufferMinutes: opts.buffer ?? 0,
        priceMinor: 80_000n,
        currency: 'PKR',
      },
    });
    for (let i = 0; i < (opts.staffCount ?? 1); i++) {
      const s = await tx.staff.create({
        data: { id: world.id(), businessId: id, displayName: `Stylist ${i + 1}` },
      });
      await tx.staffService.create({ data: { staffId: s.id, serviceId, businessId: id } });
      await tx.availabilityRule.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          id: world.id(),
          businessId: id,
          staffId: s.id,
          dayOfWeek: d,
          startTime: '09:00',
          endTime: '17:00',
        })),
      });
      staff.push({ id: s.id, displayName: s.displayName });
    }
    if (opts.settings) await tx.bookingSettings.create({ data: { businessId: id, ...opts.settings } });
  });
  /** A team member in `role` (as auth-service adds them), optionally linked to a staff profile. */
  const member = async (role: 'manager' | 'front_desk' | 'staff', linkStaffIndex?: number) => {
    const p = await addMember(role);
    if (linkStaffIndex !== undefined) {
      await world.inBusiness(id, (tx) =>
        tx.staff.update({ where: { id: staff[linkStaffIndex]!.id }, data: { userId: p.id } }),
      );
    }
    return p;
  };
  return { owner, b, service: { id: serviceId }, staff, member, base };
}
