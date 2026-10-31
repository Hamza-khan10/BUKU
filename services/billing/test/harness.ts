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
import { DataPlane, type BusinessTx } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { SERVICES_DIRECTORY, servicesWorld } from '../../../packages/database/test/services-world.js';
import { buildBillingApp, type BillingAppDeps } from '../src/app.js';

/**
 * Shared setup for billing-service integration tests on database v2 (D3g): the real app as
 * billing-service's own role on the services' test world (the directory holding the catalog, a
 * user shard and a business shard; packages/database/test/services-world.ts). Fixtures are
 * written as the other services write them, through a second data plane signed in as buku_app.
 * Call `useBillingHarness()` at the top of a test file.
 */

export interface Person {
  id: bigint;
  publicId: string;
  auth: Record<string, string>;
}

export interface Shop {
  id: bigint;
  publicId: string;
  name: string;
  slug: string;
  owner: Person;
}

export interface Harness {
  app: Express;
  /** billing-service's own data plane. */
  plane: DataPlane;
  /** Fixtures and checks, as buku_app (row-level security still applies, DB-020). */
  world: DataPlane;
  admin: Person;
  /** Another copy of the app, e.g. without Paddle. */
  build(paddle: BillingAppDeps['paddle']): Express;
}

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

export function useBillingHarness(name: string, paddle: () => BillingAppDeps['paddle'] = () => null) {
  const h = {} as Harness;
  let redis: Redis;
  let signer: JwtSigner;
  let verifier: JwtVerifier;

  h.build = (p) =>
    buildBillingApp({
      plane: h.plane,
      paddle: p,
      redis,
      verifier,
      revocations: createRevocationStore(redis),
      http: {
        service: name,
        logger: createLogger({ service: name, level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    }).app;

  beforeAll(async () => {
    h.plane = await DataPlane.start({
      service: 'billing',
      databaseUrl: servicesWorld.urlFor('billing'),
      directoryUrl: servicesWorld.urlFor('billing', SERVICES_DIRECTORY),
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
    redis = createRedisClient({ url: testEnv.redisUrl, connectionName: name });
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
    signer = await createJwtSigner({
      ...jwt,
      keyId: 'k1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    verifier = await createJwtVerifier({
      ...jwt,
      keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    });
    h.app = h.build(paddle());
    h.admin = await x.person('super_admin');
  });

  afterAll(async () => {
    await h.plane?.close();
    await h.world?.close();
    await redis?.quit();
  });

  const x = {
    /** A person on a user shard, as auth-service makes them, with an access token. */
    person: async (role: Role = 'user'): Promise<Person> => {
      const id = h.world.id();
      const pid = publicId();
      await (
        await h.world.placeUser(id)
      ).user.create({ data: { id, publicId: pid, name: `P ${randomUUID().slice(0, 6)}`, role } });
      await h.world.handles.claim('user.public_id', Buffer.from(pid, 'ascii'), id);
      const { token } = await signer.sign({
        sub: id.toString(),
        role,
        sid: h.world.id().toString(),
        mfa: role === 'super_admin',
      });
      return { id, publicId: pid, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
    },
    /** A business as business-service registers it (D3c): placed, its handles claimed, its row. */
    business: async (owner?: Person): Promise<Shop> => {
      const own = owner ?? (await x.person());
      const suffix = randomUUID().slice(-12);
      const id = h.world.id();
      const pid = publicId();
      const slug = `shop-${suffix}`;
      await h.world.placeBusiness(id);
      await h.world.handles.claim('business.slug', Buffer.from(slug, 'utf8'), id);
      await h.world.handles.claim('business.public_id', Buffer.from(pid, 'ascii'), id);
      await h.world.inBusiness(id, (tx) =>
        tx.business.create({
          data: {
            id,
            publicId: pid,
            ownerUserId: own.id,
            categoryId: 1n,
            name: `Shop ${suffix}`,
            slug,
            city: 'Lahore',
            country: 'PK',
            timezone: 'Asia/Karachi',
            currency: 'PKR',
          },
        }),
      );
      return { id, publicId: pid, name: `Shop ${suffix}`, slug, owner: own };
    },
    /** A team member in `role`, as auth-service adds them. */
    member: async (b: Shop, role: 'manager' | 'front_desk' | 'staff') => {
      const p = await x.person();
      await x.inShop(b, (tx) =>
        tx.businessMember.create({ data: { id: h.world.id(), businessId: b.id, userId: p.id, role } }),
      );
      return p;
    },
    inShop: <T>(b: Shop, work: (tx: BusinessTx) => Promise<T>) => h.world.inBusiness(b.id, work),
    shardOf: (p: Person) => h.world.user(p.id),
    get: (path: string, who?: Person) =>
      who ? request(h.app).get(path).set(who.auth) : request(h.app).get(path),
    send: (method: 'post' | 'put' | 'patch' | 'delete', path: string, who: Person, body: object = {}) =>
      request(h.app)[method](path).set(who.auth).send(body),
    /**
     * Billing on or off for an audience, as an admin does it (on the directory), once every
     * business shard's copy has it (replication, DB-015).
     */
    setBilling: async (audience: 'user' | 'business', enabled: boolean) => {
      const res = await x.send('put', `/v1/admin/billing/settings/${audience}`, h.admin, { enabled });
      if (res.status === 200) await x.replicated(audience, (s) => s?.enabled === enabled);
      return res;
    },
    /** Waits until every business shard's copy of an audience's billing settings passes `check`. */
    replicated: async (
      audience: 'user' | 'business',
      check: (s: { enabled: boolean; trialEnabled: boolean; trialDays: number } | null) => boolean,
    ) => {
      const deadline = Date.now() + 15_000;
      for (const shard of await h.world.router.shards('business')) {
        const copy = h.world.businesses.forShard(shard);
        while (!check(await copy.billingSettings.findUnique({ where: { audience } }))) {
          if (Date.now() > deadline) throw new Error(`billing settings didn't reach ${shard.databaseName}`);
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    },
    /** A business's subscriptions, newest first. */
    subscriptions: (b: Shop) =>
      x.inShop(b, (tx) =>
        tx.subscription.findMany({ where: { businessId: b.id }, orderBy: { createdAt: 'desc' } }),
      ),
  };

  return { h, x };
}
