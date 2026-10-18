import { generateKeyPairSync, randomInt, randomUUID } from 'node:crypto';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  publicId,
  Readiness,
  type JwtSigner,
  type JwtVerifier,
  type Role,
} from '@buku/common';
import { DataPlane, type BusinessTx, type UserShardClient } from '@buku/database';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { SERVICES_DIRECTORY, servicesWorld } from '../../../packages/database/test/services-world.js';
import { buildQueueApp, type QueueAppDeps } from '../src/app.js';

/**
 * Shared setup for queue-service integration tests on database v2 (D3e): the real app as
 * queue-service's own role on the services' test world (a directory, a user shard and a business
 * shard; packages/database/test/services-world.ts), plus helpers to create people and a shop.
 * Fixtures are written as the other services write them, through a second data plane signed in as
 * buku_app. Call `useQueueHarness()` at the top of a test file.
 */

export const TZ = 'Asia/Karachi';
/** A shop in Gulberg, Lahore. */
export const SHOP_LOCATION = { lat: 31.5204, lng: 74.3587 };

export interface Person {
  id: bigint;
  publicId: string;
  name: string;
  token: string;
  auth: Record<string, string>;
}

export interface ShopOptions {
  settings?: Record<string, unknown>;
  /** false: a business with no address on the map. */
  location?: boolean;
}

export type Shop = Awaited<ReturnType<typeof makeShop>>;
export type QueueApp = ReturnType<typeof buildQueueApp>;

export interface Harness {
  /** queue-service's own data plane. */
  plane: DataPlane;
  /** Fixtures and checks, as buku_app (row-level security still applies, DB-020). */
  world: DataPlane;
  signer: JwtSigner;
  /** The app the test file uses. */
  queue: QueueApp;
  /** Another copy of the service (a replica), with Valkey connections of its own; closed afterwards. */
  build(live?: QueueAppDeps['live']): QueueApp;
  person(role?: Role, name?: string): Promise<Person>;
  /** A business with an owner, as business-service registers it; its queue isn't open yet. */
  shop(opts?: ShopOptions): Promise<Shop>;
  /** Work inside the shop's business. */
  inShop<T>(s: Shop, work: (tx: BusinessTx) => Promise<T>): Promise<T>;
  /** A person's own shard. */
  shardOf(p: Person): Promise<UserShardClient>;
  /** The events written for a ticket, oldest first. */
  events(s: Shop, ticketId: string): Promise<Awaited<ReturnType<BusinessTx['outboxEvent']['findMany']>>>;
}

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export function useQueueHarness(): Harness {
  const h = {} as Harness;
  const redisClients: Redis[] = [];
  const hubs: QueueApp['live'][] = [];
  let verifier: JwtVerifier;

  h.build = (live) => {
    const [redis, subscriber] = [0, 1].map((i) =>
      createRedisClient({ url: testEnv.redisUrl, connectionName: `queue-int-test-${i}` }),
    ) as [Redis, Redis];
    redisClients.push(redis, subscriber);
    const built = buildQueueApp({
      plane: h.plane,
      redis,
      subscriber,
      verifier,
      revocations: createRevocationStore(redis),
      ...(live && { live }),
      http: {
        service: 'queue-test',
        logger: createLogger({ service: 'queue-test', level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    });
    hubs.push(built.live);
    return built;
  };

  beforeAll(async () => {
    h.plane = await DataPlane.start({
      service: 'queue',
      databaseUrl: servicesWorld.urlFor('queue'),
      directoryUrl: servicesWorld.urlFor('queue', SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `queue-int-test:${process.pid}`,
    });
    h.world = await DataPlane.start({
      service: 'business',
      databaseUrl: servicesWorld.appUrl(),
      directoryUrl: servicesWorld.appUrl(SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `queue-int-fixtures:${process.pid}`,
    });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
    h.signer = await createJwtSigner({
      ...jwt,
      keyId: 'k1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    verifier = await createJwtVerifier({
      ...jwt,
      keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    });
    h.queue = h.build();
  });

  afterAll(async () => {
    for (const hub of hubs) await hub.close();
    for (const c of redisClients) await c.quit();
    await h.plane?.close();
    await h.world?.close();
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
      token,
      auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() },
    };
  };
  h.shop = (opts = {}) => makeShop(h, opts);
  h.inShop = (s, work) => h.world.inBusiness(s.b.id, work);
  h.shardOf = (p) => h.world.user(p.id);
  h.events = (s, ticketId) =>
    h.inShop(s, (tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: BigInt(ticketId) },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  return h;
}

/** A business as business-service registers it (D3c): placed, its handles claimed, its row. */
async function makeShop(h: Harness, opts: ShopOptions) {
  const { world } = h;
  const owner = await h.person();
  const suffix = randomUUID().slice(-12);
  const id = world.id();
  const pid = publicId();
  const slug = `passport-${suffix}`;
  await world.placeBusiness(id);
  await world.handles.claim('business.slug', Buffer.from(slug, 'utf8'), id);
  await world.handles.claim('business.public_id', Buffer.from(pid, 'ascii'), id);
  await world.inBusiness(id, async (tx) => {
    await tx.business.create({
      data: {
        id,
        publicId: pid,
        ownerUserId: owner.id,
        categoryId: 1n,
        name: `Passport Office ${suffix}`,
        slug,
        city: 'Lahore',
        country: 'PK',
        timezone: TZ,
        currency: 'PKR',
        ...(opts.location !== false && SHOP_LOCATION),
      },
    });
    if (opts.settings) await tx.queueSettings.create({ data: { businessId: id, ...opts.settings } });
  });
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
    b: { id, publicId: pid, slug, name: `Passport Office ${suffix}` },
    member,
    base: `/v1/businesses/${pid}/queue`,
  };
}
