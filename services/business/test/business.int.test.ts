import { generateKeyPairSync, randomBytes, randomInt, randomUUID } from 'node:crypto';
import {
  createBlindIndexer,
  createFieldCipher,
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  parseKeyring,
  publicId,
  Readiness,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { createDirectoryClient, DataPlane, type BusinessTx, type DirectoryClient } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import {
  givePlan,
  SERVICES_DIRECTORY,
  servicesWorld,
  withBusinessBilling,
} from '../../../packages/database/test/services-world.js';
import { buildBusinessApp } from '../src/app.js';
import { createS3Storage, MediaLinks, PictureUploads, type ObjectStorage } from '@buku/media';
import sharp from 'sharp';
import { createEvent, TOPICS } from '@buku/kafka';
import { businessEventHandler } from '../src/events/handlers.js';
import type { PictureService } from '../src/media/picture-service.js';

/**
 * business-service against database v2 (D3c): its own role on the services' test world (a
 * directory, a user shard and a business shard; packages/database/test/services-world.ts).
 * People and team members are written as auth-service will have written them, through a second
 * data plane signed in as buku_app (the tools' and tests' role); BUKU's own kinds of business on
 * the directory as its owner.
 */

let app: Express;
let pictures: PictureService;
let storage: ObjectStorage;
/** business-service's own way into database v2. */
let plane: DataPlane;
/** Fixtures and checks, as buku_app. */
let world: DataPlane;
/** The directory as its owner: BUKU's own kinds of business. */
let curator: DirectoryClient;
let redis: Redis;
let signer: JwtSigner;
/** One of BUKU's own kinds of business (reference data). */
let categoryId: string;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** A person on a user shard (as auth-service makes them) plus a valid access token. */
async function person(role: Role = 'user') {
  const id = world.id();
  const db = await world.placeUser(id);
  await db.user.create({
    data: { id, publicId: publicId(), name: `U ${randomUUID().slice(0, 6)}`, role },
  });
  const { token } = await signer.sign({
    sub: id.toString(),
    role,
    sid: world.id().toString(),
    mfa: role === 'super_admin',
  });
  return { id, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

type Person = Awaited<ReturnType<typeof person>>;

/** The internal ID behind a business's public one. */
const idOf = async (businessPublicId: string) => (await world.idOfPublic('business', businessPublicId))!;
/** Work inside one business, as buku_app (row-level security applies, DB-020). */
const inBusiness = async <T>(businessPublicId: string, work: (tx: BusinessTx) => Promise<T>) =>
  world.inBusiness(await idOf(businessPublicId), work);
/** A team member, as auth-service adds them (D3b). */
const addMember = async (businessPublicId: string, userId: bigint, role: string, status = 'active') => {
  const businessId = await idOf(businessPublicId);
  return world.inBusiness(businessId, (tx) =>
    tx.businessMember.create({ data: { id: world.id(), businessId, userId, role, status } }),
  );
};

const validBusiness = (overrides: Record<string, unknown> = {}) => ({
  name: `Fade Masters ${randomUUID().slice(0, 4)}`,
  categoryId,
  description: 'Classic cuts and hot-towel shaves.',
  phone: '+924235550000',
  website: 'https://fademasters.example',
  address: '12 Main Boulevard, Gulberg',
  city: 'Lahore',
  country: 'PK',
  lat: 31.5204,
  lng: 74.3587,
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  acceptedBusinessTermsVersion: '1.0',
  ...overrides,
});

async function createBusiness(
  owner: Awaited<ReturnType<typeof person>>,
  overrides: Record<string, unknown> = {},
) {
  const res = await request(app).post('/v1/businesses').set(owner.auth).send(validBusiness(overrides));
  expect(res.status).toBe(201);
  return res.body.data as { id: string; slug: string; status: string };
}

beforeAll(async () => {
  plane = await DataPlane.start({
    service: 'business',
    databaseUrl: servicesWorld.urlFor('business'),
    directoryUrl: servicesWorld.urlFor('business', SERVICES_DIRECTORY),
    env: servicesWorld.env,
    instance: `business-int-test:${process.pid}`,
  });
  world = await DataPlane.start({
    service: 'business',
    databaseUrl: servicesWorld.appUrl(),
    directoryUrl: servicesWorld.appUrl(SERVICES_DIRECTORY),
    env: servicesWorld.env,
    instance: `business-int-fixtures:${process.pid}`,
  });
  curator = createDirectoryClient({ url: servicesWorld.ownerUrl(), applicationName: 'business-int-test' });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'business-int-test' });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwt = { issuer: 'https://auth.test', audience: 'buku-api' };
  signer = await createJwtSigner({
    ...jwt,
    keyId: 'k1',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  const verifier = await createJwtVerifier({
    ...jwt,
    keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
  });
  // A kind of business that isn't regulated (health businesses need a licence; tested below).
  const barber = await curator.category.findFirstOrThrow({
    where: { depth: 1, isActive: true, pending: false, parent: { slug: { not: 'health-medical' } } },
    orderBy: { id: 'asc' },
  });
  categoryId = barber.id.toString();

  storage = createS3Storage({
    endpoint: testEnv.s3.endpoint,
    publicEndpoint: testEnv.s3.endpoint,
    region: 'us-east-1',
    accessKeyId: testEnv.s3.accessKeyId,
    secretAccessKey: testEnv.s3.secretAccessKey,
    forcePathStyle: true,
  });
  ({ app, pictures } = buildBusinessApp({
    plane,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    cipher: createFieldCipher(parseKeyring(`k1:${randomBytes(32).toString('base64')}`, 'k1')),
    indexer: createBlindIndexer(randomBytes(32)),
    storage,
    pictureUploads: new PictureUploads(storage, redis, { privateBucket: testEnv.s3.privateBucket }),
    mediaLinks: new MediaLinks(storage, {
      mediaBucket: testEnv.s3.mediaBucket,
      privateBucket: testEnv.s3.privateBucket,
    }),
    settings: {
      businessTermsVersion: '1.0',
      maxBusinessesPerOwner: 3,
      documentsBucket: testEnv.s3.documentsBucket,
    },
    http: {
      service: 'business-test',
      logger: createLogger({
        service: 'business-test',
        level: process.env.TEST_LOG_LEVEL ?? 'silent',
      }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
});

afterAll(async () => {
  await plane?.close();
  await world?.close();
  await curator?.$disconnect();
  await redis?.quit();
});

describe('Registering a business', () => {
  it('creates a pending, NOT verified business owned by the caller, with an event and audit entry', async () => {
    const owner = await person();
    const res = await request(app)
      .post('/v1/businesses')
      .set(owner.auth)
      .send(validBusiness({ name: 'Fade Masters' }));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'pending',
      myRole: 'owner',
      verification: { status: 'not_verified' },
      address: { country: 'PK', city: 'Lahore' },
    });
    expect(res.body.data.slug).toMatch(/^fade-masters-lahore/);
    expect(res.body.data.id).toMatch(/^[0-9A-Za-z]{12}$/); // its public ID (DB-042)
    const id = await idOf(res.body.data.id as string);
    await world.inBusiness(id, async (tx) => {
      expect((await tx.outboxEvent.findMany({ where: { aggregateId: id } })).map((e) => e.topic)).toEqual([
        'businesses.created',
      ]);
      expect(await tx.auditLog.count({ where: { resourceId: id, action: 'business.created' } })).toBe(1);
      // the location column is maintained by the DB trigger
      const [row] = await tx.$queryRaw<
        { has_location: boolean }[]
      >`SELECT location IS NOT NULL AS has_location FROM businesses WHERE id = ${id}`;
      expect(row!.has_location).toBe(true);
    });
    // Found again by its address and its public ID on every shard (global handles, DB-018).
    expect(await world.handles.find('business.slug', Buffer.from(res.body.data.slug as string))).toBe(id);
    // And in the owner's own list of their businesses, on their shard (DB-014).
    const list = await (
      await world.user(owner.id)
    ).userBusinessRole.findMany({ where: { userId: owner.id } });
    expect(list).toEqual([expect.objectContaining({ businessId: id, role: 'owner', status: 'active' })]);
  });

  it('gives each business a unique URL even with the same name and city', async () => {
    const a = await createBusiness(await person(), { name: 'Twin Salon' });
    const b = await createBusiness(await person(), { name: 'Twin Salon' });
    expect(a.slug).not.toBe(b.slug);
  });

  it('requires accepting the Business Terms', async () => {
    const res = await request(app)
      .post('/v1/businesses')
      .set((await person()).auth)
      .send(validBusiness({ acceptedBusinessTermsVersion: '0.9' }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('TERMS_NOT_ACCEPTED');
  });

  it.each([
    ['country as a name', { country: 'Pakistan' }],
    ['unknown country code', { country: 'ZZ' }],
    ['unknown currency', { currency: 'XYZ' }],
    ['invalid timezone', { timezone: 'Mars/Base' }],
    ['plain-http website', { website: 'http://phish.example' }],
    ['javascript: website', { website: 'javascript:alert(1)' }],
    ['latitude out of range', { lat: 123 }],
    ['unknown category', { categoryId: '999999999' }],
    ['category as a UUID', { categoryId: randomUUID() }],
    ['privileged field', { status: 'verified' }],
  ])('rejects %s', async (_label, bad) => {
    const res = await request(app)
      .post('/v1/businesses')
      .set((await person()).auth)
      .send(validBusiness(bad));
    expect(res.status).toBe(400);
  });

  it('strips HTML/script from text fields', async () => {
    const owner = await person();
    const b = await createBusiness(owner, { description: '<script>alert(1)</script>Best <b>cuts</b>' });
    const pub = await request(app).get(`/v1/businesses/${b.slug}`);
    expect(pub.body.data.description).toBe('Best cuts');
  });

  it('refuses emoji and invisible characters with a message people understand (D-083)', async () => {
    const owner = await person();
    for (const name of ['Best Cuts \u2702\uFE0F', 'Best\u200BCuts', 'Cuts\u202Egnp']) {
      const res = await request(app).post('/v1/businesses').set(owner.auth).send(validBusiness({ name }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const res = await request(app)
      .post('/v1/businesses')
      .set(owner.auth)
      .send(validBusiness({ name: 'Best Cuts \u{1F488}' }));
    expect(JSON.stringify(res.body.error)).toContain('Emojis and picture symbols can\u2019t be used here.');
    // Styled "fancy" letters are turned into ordinary ones rather than refused.
    const b = await createBusiness(owner, { name: '\u{1D401}\u{1D404}\u{1D412}\u{1D413} Cuts' });
    const pub = await request(app).get(`/v1/businesses/${b.slug}`);
    expect(pub.body.data.name).toBe('BEST Cuts');
  });

  it('caps businesses per owner (anti-abuse)', async () => {
    const owner = await person();
    for (let i = 0; i < 3; i++) await createBusiness(owner);
    const res = await request(app).post('/v1/businesses').set(owner.auth).send(validBusiness());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
  });

  it('requires signing in', async () => {
    expect((await request(app).post('/v1/businesses').send(validBusiness())).status).toBe(401);
  });

  it('employee accounts cannot register a business', async () => {
    const employee = await person('staff');
    const res = await request(app).post('/v1/businesses').set(employee.auth).send(validBusiness());
    expect(res.status).toBe(403);
  });
});

describe('Public profile', () => {
  it('is reachable by slug or id, shows the "Not verified" badge and no private fields', async () => {
    const b = await createBusiness(await person());
    for (const key of [b.slug, b.id]) {
      const res = await request(app).get(`/v1/businesses/${key}`);
      expect(res.status).toBe(200);
      expect(res.body.data.verification).toEqual({
        status: 'not_verified',
        label: 'Not verified by BUKU',
        verifiedAt: null,
      });
      for (const secret of [
        'status',
        'rejectionReason',
        'settings',
        'ownerId',
        'myRole',
        'businessTermsVersion',
      ]) {
        expect(res.body.data).not.toHaveProperty(secret);
      }
    }
  });

  it('404s for unknown businesses and rejects malformed keys', async () => {
    expect((await request(app).get('/v1/businesses/no-such-business')).status).toBe(404);
    expect((await request(app).get(`/v1/businesses/${encodeURIComponent("x' OR 1=1")}`)).status).toBe(400);
  });
});

describe('Managing a business (roles)', () => {
  it('owner and manager can edit; front desk and staff cannot; strangers get 404', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const [manager, frontDesk, staff, stranger] = [
      await person(),
      await person(),
      await person(),
      await person(),
    ];
    await addMember(b.id, manager.id, 'manager');
    await addMember(b.id, frontDesk.id, 'front_desk');
    await addMember(b.id, staff.id, 'staff');
    const edit = (who: { auth: Record<string, string> }) =>
      request(app).patch(`/v1/businesses/${b.id}`).set(who.auth).send({ description: 'Updated' });
    expect((await edit(owner)).status).toBe(200);
    expect((await edit(manager)).status).toBe(200);
    expect((await edit(frontDesk)).status).toBe(403);
    expect((await edit(staff)).status).toBe(403);
    expect((await edit(stranger)).status).toBe(404);

    // Team members can see the private view with their own role.
    const view = await request(app).get(`/v1/businesses/${b.id}/manage`).set(staff.auth);
    expect(view.status).toBe(200);
    expect(view.body.data.myRole).toBe('staff');
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(stranger.auth)).status).toBe(404);
  });

  it('a disabled member loses access immediately', async () => {
    const b = await createBusiness(await person());
    const manager = await person();
    const m = await addMember(b.id, manager.id, 'manager');
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(manager.auth)).status).toBe(200);
    await inBusiness(b.id, (tx) =>
      tx.businessMember.update({ where: { id: m.id }, data: { status: 'disabled' } }),
    );
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(manager.auth)).status).toBe(404);
  });

  it('lists my businesses with my role in each', async () => {
    const me = await person();
    const own = await createBusiness(me);
    const other = await createBusiness(await person());
    await addMember(other.id, me.id, 'front_desk');
    // auth-service keeps a member's own list (D3b); here, as it would.
    await (
      await world.user(me.id)
    ).userBusinessRole.create({
      data: {
        userId: me.id,
        businessId: await idOf(other.id),
        role: 'front_desk',
        status: 'active',
        businessName: 'Other',
        version: world.id(),
      },
    });
    const res = await request(app).get('/v1/businesses/mine').set(me.auth);
    const roles = Object.fromEntries(
      (res.body.data as { id: string; myRole: string }[]).map((b) => [b.id, b.myRole]),
    );
    expect(roles).toEqual({ [own.id]: 'owner', [other.id]: 'front_desk' });
  });

  it('a member still on a temporary password has no access until they choose their own (D-034)', async () => {
    const b = await createBusiness(await person());
    const manager = await person();
    await addMember(b.id, manager.id, 'manager');
    const { token } = await signer.sign({ sub: manager.id.toString(), role: 'user', pwc: true });
    const temporary = { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() };
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(temporary)).status).toBe(404);
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(manager.auth)).status).toBe(200);
  });

  it('a renamed business is renamed in its owner’s and team’s own lists', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const renamed = await request(app)
      .patch(`/v1/businesses/${b.id}`)
      .set(owner.auth)
      .send({ name: 'Fade Masters Gulberg' });
    expect(renamed.status).toBe(200);
    const list = await (
      await world.user(owner.id)
    ).userBusinessRole.findFirstOrThrow({
      where: { userId: owner.id, businessId: await idOf(b.id) },
    });
    expect(list.businessName).toBe('Fade Masters Gulberg');
  });

  it('the business in the URL is its public ID; anything else is refused before any lookup', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const internal = (await idOf(b.id)).toString();
    expect((await request(app).get(`/v1/businesses/${internal}/manage`).set(owner.auth)).status).toBe(400);
    expect((await request(app).get(`/v1/businesses/${publicId()}/manage`).set(owner.auth)).status).toBe(404);
  });

  it('changing name or address of a VERIFIED business sends it back to review', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    await inBusiness(b.id, (tx) =>
      tx.business.updateMany({ data: { status: 'verified', verifiedAt: new Date() } }),
    );

    const cosmetic = await request(app)
      .patch(`/v1/businesses/${b.id}`)
      .set(owner.auth)
      .send({ description: 'New description' });
    expect(cosmetic.body.data).toMatchObject({ status: 'verified', verification: { status: 'verified' } });

    const identity = await request(app)
      .patch(`/v1/businesses/${b.id}`)
      .set(owner.auth)
      .send({ name: 'Totally Different Clinic' });
    expect(identity.body.data).toMatchObject({ status: 'pending', verification: { status: 'not_verified' } });
    const events = await inBusiness(b.id, async (tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: await idOf(b.id), topic: 'businesses.updated' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(
      (events.at(-1)!.payload as { data: { reverificationRequired: boolean } }).data.reverificationRequired,
    ).toBe(true);
  });

  it('sets weekly hours (split shifts ok) and refuses overlapping or inverted ones', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const ok = await request(app)
      .put(`/v1/businesses/${b.id}/hours`)
      .set(owner.auth)
      .send({
        hours: [
          { dayOfWeek: 1, openTime: '09:00', closeTime: '13:00' },
          { dayOfWeek: 1, openTime: '14:00', closeTime: '18:00' },
        ],
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.hours).toHaveLength(2);
    const overlap = await request(app)
      .put(`/v1/businesses/${b.id}/hours`)
      .set(owner.auth)
      .send({
        hours: [
          { dayOfWeek: 2, openTime: '09:00', closeTime: '13:00' },
          { dayOfWeek: 2, openTime: '12:00', closeTime: '18:00' },
        ],
      });
    expect(overlap.status).toBe(400);
    const inverted = await request(app)
      .put(`/v1/businesses/${b.id}/hours`)
      .set(owner.auth)
      .send({ hours: [{ dayOfWeek: 3, openTime: '18:00', closeTime: '09:00' }] });
    expect(inverted.status).toBe(400);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.hours).toHaveLength(2);
  });
});

describe('Reports', () => {
  it('lets a signed-in person report a business once, but not their own', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const reporter = await person();
    const first = await request(app)
      .post(`/v1/businesses/${b.id}/reports`)
      .set(reporter.auth)
      .send({ reason: 'fake_business', details: 'Address does not exist' });
    expect(first.status).toBe(201);
    const again = await request(app)
      .post(`/v1/businesses/${b.id}/reports`)
      .set(reporter.auth)
      .send({ reason: 'other' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REPORTED');
    expect(
      (await request(app).post(`/v1/businesses/${b.id}/reports`).set(owner.auth).send({ reason: 'other' }))
        .status,
    ).toBe(400);
  });
});

describe('Platform admin moderation', () => {
  it('is admin-only', async () => {
    const res = await request(app)
      .get('/v1/admin/businesses')
      .set((await person()).auth);
    expect(res.status).toBe(403);
  });

  it('refuses to verify until the checklist is complete, then verifies', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    const blocked = await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatchObject({
      code: 'VERIFICATION_REQUIREMENTS_NOT_MET',
      details: { missing: ['legal_profile', 'approved_document'] },
    });

    await makeVerifiable(owner, b.id, admin);
    expect((await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth)).status).toBe(200);
    const pub = await request(app).get(`/v1/businesses/${b.slug}`);
    expect(pub.body.data.verification.status).toBe('verified');
    const id = await idOf(b.id);
    expect(
      (await world.inBusiness(id, (tx) => tx.outboxEvent.findMany({ where: { aggregateId: id } }))).map(
        (e) => e.topic,
      ),
    ).toContain('businesses.verified');

    // Can't verify twice (state machine).
    const again = await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('suspension hides the business and freezes edits; reinstating restores it', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    expect(
      (
        await request(app)
          .post(`/v1/admin/businesses/${b.id}/suspend`)
          .set(admin.auth)
          .send({ reason: 'Multiple fraud reports' })
      ).status,
    ).toBe(200);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).status).toBe(404);
    const edit = await request(app)
      .patch(`/v1/businesses/${b.id}`)
      .set(owner.auth)
      .send({ description: 'x' });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe('BUSINESS_SUSPENDED');
    const view = await request(app).get(`/v1/businesses/${b.id}/manage`).set(owner.auth);
    expect(view.body.data).toMatchObject({ status: 'suspended', rejectionReason: 'Multiple fraud reports' });

    expect(
      (await request(app).post(`/v1/admin/businesses/${b.id}/reinstate`).set(admin.auth)).body.data.status,
    ).toBe('pending');
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).status).toBe(200);
  });

  it('rejection shows the owner why; fixing details resubmits for review', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    await request(app)
      .post(`/v1/admin/businesses/${b.id}/reject`)
      .set(admin.auth)
      .send({ reason: 'Address could not be confirmed' });
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).status).toBe(404);
    const fixed = await request(app)
      .patch(`/v1/businesses/${b.id}`)
      .set(owner.auth)
      .send({ address: '99 Correct Road, Gulberg' });
    expect(fixed.body.data).toMatchObject({ status: 'pending', rejectionReason: null });
  });

  it('lists and resolves reports', async () => {
    const admin = await person('super_admin');
    const b = await createBusiness(await person());
    const rep = await request(app)
      .post(`/v1/businesses/${b.id}/reports`)
      .set((await person()).auth)
      .send({ reason: 'scam_or_fraud' });
    const list = await request(app).get('/v1/admin/business-reports?limit=100').set(admin.auth);
    expect((list.body.data as { id: string }[]).some((r) => r.id === rep.body.data.id)).toBe(true);
    expect(
      (
        await request(app)
          .post(`/v1/admin/business-reports/${rep.body.data.id}/resolve`)
          .set(admin.auth)
          .send({ status: 'reviewed' })
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post(`/v1/admin/business-reports/${rep.body.data.id}/resolve`)
          .set(admin.auth)
          .send({ status: 'reviewed' })
      ).status,
    ).toBe(404);
  });
});

// ── Legal details, documents, photos ────────────────────────────────────────

const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
const legalProfile = (overrides: Record<string, unknown> = {}) => ({
  legalName: 'Fade Masters (Private) Limited',
  registrationCountry: 'PK',
  registrationType: 'SECP company',
  registrationNumber: `0${randomInt(100000, 999999)}-${randomInt(10, 99)}`,
  taxId: `${randomInt(1000000, 9999999)}-${randomInt(1, 9)}`,
  registeredAddress: '12 Main Boulevard, Gulberg, Lahore',
  responsiblePerson: {
    name: 'Ayesha Khan',
    role: 'Director',
    email: 'ayesha@example.com',
    phone: '+923001234567',
  },
  ...overrides,
});

/** Request an upload link, PUT the bytes to storage like a browser would, confirm. */
async function uploadDocument(
  owner: Person,
  businessId: string,
  body: Buffer,
  declared = 'application/pdf',
  type = 'business_license',
) {
  const req = await request(app)
    .post(`/v1/businesses/${businessId}/documents/uploads`)
    .set(owner.auth)
    .send({ type, contentType: declared, sizeBytes: body.length });
  expect(req.status).toBe(201);
  const put = await fetch(req.body.data.upload.url, {
    method: 'PUT',
    headers: { 'Content-Type': declared },
    body,
  });
  expect(put.status).toBe(200);
  const done = await request(app)
    .post(`/v1/businesses/${businessId}/documents/${req.body.data.documentId}/complete`)
    .set(owner.auth);
  return { documentId: req.body.data.documentId as string, done };
}

async function makeVerifiable(
  owner: Person,
  businessId: string,
  admin: Person,
  docType = 'business_license',
) {
  expect(
    (
      await request(app)
        .put(`/v1/businesses/${businessId}/legal-profile`)
        .set(owner.auth)
        .send(legalProfile())
    ).status,
  ).toBe(200);
  const { documentId } = await uploadDocument(owner, businessId, PDF, 'application/pdf', docType);
  expect(
    (
      await request(app)
        .post(`/v1/admin/business-documents/${documentId}/review`)
        .set(admin.auth)
        .send({ decision: 'approved' })
    ).status,
  ).toBe(200);
}

describe('Legal details (KYB)', () => {
  it('owner submits; identifiers are encrypted at rest and masked when shown back', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const input = legalProfile({ registrationNumber: '0123456-78' });
    const res = await request(app).put(`/v1/businesses/${b.id}/legal-profile`).set(owner.auth).send(input);
    expect(res.status).toBe(200);
    expect(res.body.data.registrationNumber).toBe('••••5678');
    const businessId = await idOf(b.id);
    const row = await world.inBusiness(businessId, (tx) =>
      tx.businessLegalProfile.findUniqueOrThrow({ where: { businessId } }),
    );
    expect(row.registrationNumberHash).toHaveLength(16);
    for (const stored of [row.registrationNumberEnc, row.responsibleEmailEnc!]) {
      expect(Buffer.from(stored).includes('0123456')).toBe(false);
      expect(Buffer.from(stored).includes('ayesha@example.com')).toBe(false);
    }
  });

  it('only the owner may see or change legal details', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const manager = await person();
    await addMember(b.id, manager.id, 'manager');
    expect(
      (await request(app).put(`/v1/businesses/${b.id}/legal-profile`).set(manager.auth).send(legalProfile()))
        .status,
    ).toBe(403);
    expect((await request(app).get(`/v1/businesses/${b.id}/legal-profile`).set(manager.auth)).status).toBe(
      403,
    );
  });

  it('admins see details decrypted, with a flag when a different owner uses the same registration', async () => {
    const admin = await person('super_admin');
    const regNumber = `0${randomInt(100000, 999999)}-11`;
    const [ownerA, ownerB] = [await person(), await person()];
    const a = await createBusiness(ownerA);
    const b = await createBusiness(ownerB);
    await request(app)
      .put(`/v1/businesses/${a.id}/legal-profile`)
      .set(ownerA.auth)
      .send(legalProfile({ registrationNumber: regNumber }));
    // Same number typed differently (spaces instead of dash) must still match.
    await request(app)
      .put(`/v1/businesses/${b.id}/legal-profile`)
      .set(ownerB.auth)
      .send(legalProfile({ registrationNumber: regNumber.replace('-', ' ') }));
    const review = await request(app).get(`/v1/admin/businesses/${b.id}/review`).set(admin.auth);
    expect(review.status).toBe(200);
    expect(review.body.data.legal.registrationNumber).toBe(regNumber.replace('-', ''));
    expect(review.body.data.legal.sameRegistrationElsewhere).toEqual([
      expect.objectContaining({ businessId: a.id, sameOwner: false }),
    ]);
    const businessId = await idOf(b.id);
    expect(
      await world.inBusiness(businessId, (tx) =>
        tx.auditLog.count({ where: { action: 'admin.legal_profile_viewed', resourceId: businessId } }),
      ),
    ).toBe(1);
  });

  it('changing the legal identity of a verified business sends it back to review', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    await makeVerifiable(owner, b.id, admin);
    await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth);
    const res = await request(app)
      .put(`/v1/businesses/${b.id}/legal-profile`)
      .set(owner.auth)
      .send(legalProfile({ legalName: 'Someone Else Ltd' }));
    expect(res.body.data.reverificationRequired).toBe(true);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.verification.status).toBe(
      'not_verified',
    );
  });
});

describe('Documents (private)', () => {
  it('uploads straight to storage and becomes pending review', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const { done } = await uploadDocument(owner, b.id, PDF);
    expect(done.status).toBe(200);
    expect(done.body.data).toMatchObject({
      status: 'pending',
      contentType: 'application/pdf',
      sizeBytes: PDF.length,
    });
    const list = await request(app).get(`/v1/businesses/${b.id}/documents`).set(owner.auth);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body.data)).not.toContain('http'); // owners get metadata, never storage links
  });

  it('rejects and deletes a disguised file (HTML declared as PDF)', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>');
    const { documentId, done } = await uploadDocument(owner, b.id, html);
    expect(done.status).toBe(400);
    expect(done.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(
      await inBusiness(b.id, (tx) => tx.businessDocument.count({ where: { id: BigInt(documentId) } })),
    ).toBe(0);
    const row = `businesses/${b.id}/documents/${documentId}`;
    expect(
      await fetch(`${testEnv.s3.endpoint}/${testEnv.s3.documentsBucket}/${row}`).then((r) => r.status),
    ).not.toBe(200);
  });

  it('refuses to confirm an upload that never happened, and oversized declarations', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const req = await request(app)
      .post(`/v1/businesses/${b.id}/documents/uploads`)
      .set(owner.auth)
      .send({ type: 'id_proof', contentType: 'application/pdf', sizeBytes: 1000 });
    const done = await request(app)
      .post(`/v1/businesses/${b.id}/documents/${req.body.data.documentId}/complete`)
      .set(owner.auth);
    expect(done.status).toBe(409);
    expect(done.body.error.code).toBe('UPLOAD_NOT_FOUND');
    const huge = await request(app)
      .post(`/v1/businesses/${b.id}/documents/uploads`)
      .set(owner.auth)
      .send({ type: 'id_proof', contentType: 'application/pdf', sizeBytes: 100 * 1024 * 1024 });
    expect(huge.status).toBe(400);
    const exe = await request(app)
      .post(`/v1/businesses/${b.id}/documents/uploads`)
      .set(owner.auth)
      .send({ type: 'id_proof', contentType: 'application/x-msdownload', sizeBytes: 100 });
    expect(exe.status).toBe(400);
  });

  it('documents are private: managers cannot upload, admins view through short-lived links', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    const manager = await person();
    await addMember(b.id, manager.id, 'manager');
    expect(
      (
        await request(app)
          .post(`/v1/businesses/${b.id}/documents/uploads`)
          .set(manager.auth)
          .send({ type: 'id_proof', contentType: 'application/pdf', sizeBytes: 10 })
      ).status,
    ).toBe(403);

    const { documentId } = await uploadDocument(owner, b.id, PDF);
    const review = await request(app).get(`/v1/admin/businesses/${b.id}/review`).set(admin.auth);
    const doc = (review.body.data.documents as { id: string; viewUrl: string }[]).find(
      (d) => d.id === documentId,
    )!;
    const viewed = await fetch(doc.viewUrl);
    expect(viewed.status).toBe(200);
    expect(
      Buffer.from(await viewed.arrayBuffer())
        .subarray(0, 5)
        .toString(),
    ).toBe('%PDF-');
    // Without the signature, storage refuses.
    expect((await fetch(doc.viewUrl.split('?')[0]!)).status).toBe(403);
  });

  it('approved documents cannot be deleted', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner);
    const { documentId } = await uploadDocument(owner, b.id, PDF);
    await request(app)
      .post(`/v1/admin/business-documents/${documentId}/review`)
      .set(admin.auth)
      .send({ decision: 'approved' });
    expect(
      (await request(app).delete(`/v1/businesses/${b.id}/documents/${documentId}`).set(owner.auth)).status,
    ).toBe(409);
  });

  it('health businesses also need an approved medical licence', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    // One of BUKU's own health kinds (the reference data has them under 'health-medical').
    const health = await curator.category.findFirstOrThrow({
      where: { isActive: true, parent: { slug: 'health-medical' } },
    });
    const b = await createBusiness(owner, { categoryId: health.id.toString() });
    await makeVerifiable(owner, b.id, admin, 'business_license');
    const blocked = await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth);
    expect(blocked.body.error.details.missing).toEqual(['medical_license']);
    const checklist = await request(app).get(`/v1/businesses/${b.id}/verification`).set(owner.auth);
    expect(checklist.body.data.ready).toBe(false);

    const { documentId } = await uploadDocument(owner, b.id, PDF, 'application/pdf', 'medical_license');
    await request(app)
      .post(`/v1/admin/business-documents/${documentId}/review`)
      .set(admin.auth)
      .send({ decision: 'approved' });
    expect((await request(app).post(`/v1/admin/businesses/${b.id}/verify`).set(admin.auth)).status).toBe(200);
  });
});

/** A real picture, like a phone takes: optionally sideways (EXIF orientation 6) with GPS and camera data. */
async function picture(
  opts: { width?: number; height?: number; gps?: boolean; format?: 'jpeg' | 'png' } = {},
) {
  const { width = 1200, height = 800, gps = false, format = 'jpeg' } = opts;
  let img = sharp({ create: { width, height, channels: 3, background: '#2e86c1' } });
  img = format === 'png' ? img.png() : img.jpeg();
  if (gps) {
    img = img.withMetadata({ orientation: 6 }).withExifMerge({
      IFD0: { Make: 'PhoneMaker', Artist: 'Ayesha Khan' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '31/1 31/1 1200/100',
        GPSLongitudeRef: 'E',
        GPSLongitude: '74/1 21/1 3000/100',
      },
    });
  }
  return img.toBuffer();
}

/** Request → PUT to storage like a browser → complete. Returns both responses. */
async function uploadPicture(
  who: Person,
  base: string,
  file: Buffer,
  extra: Record<string, unknown> = {},
  contentType = 'image/jpeg',
) {
  const req = await request(app)
    .post(`${base}/uploads`)
    .set(who.auth)
    .send({ contentType, sizeBytes: file.length, ...extra });
  if (req.status !== 201) return { req, done: req };
  const put = await fetch(req.body.data.upload.url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file,
  });
  expect(put.status).toBe(200);
  const done = await request(app).post(`${base}/uploads/${req.body.data.uploadId}/complete`).set(who.auth);
  return { req, done };
}

const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));

/** What each businesses.updated event said changed, oldest first. */
const updates = async (businessPublicId: string) =>
  (
    await inBusiness(businessPublicId, async (tx) =>
      tx.outboxEvent.findMany({
        where: { aggregateId: await idOf(businessPublicId), topic: 'businesses.updated' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    )
  ).map((e) => (e.payload as { data: { changedFields: string[] } }).data.changedFields.join(','));

describe('Pictures: gallery', () => {
  it('manager uploads; first photo is the cover; links work; staff cannot upload', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const [manager, staff] = [await person(), await person()];
    await addMember(b.id, manager.id, 'manager');
    await addMember(b.id, staff.id, 'staff');
    const base = `/v1/businesses/${b.id}/photos`;
    expect((await uploadPicture(staff, base, await picture())).req.status).toBe(403);

    for (const i of [0, 1]) {
      const { done } = await uploadPicture(manager, base, await picture(), { altText: `Photo ${i}` });
      expect(done.status).toBe(200);
    }
    const pub = await request(app).get(`/v1/businesses/${b.slug}`);
    const photos = pub.body.data.photos as { id: string; url: string; isPrimary: boolean }[];
    expect(photos.map((p) => p.isPrimary)).toEqual([true, false]);
    const served = await fetch(photos[0]!.url);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/webp');

    // Deleting the cover promotes the next photo, and removes the file.
    const after = await request(app).delete(`${base}/${photos[0]!.id}`).set(owner.auth);
    expect(after.body.data).toEqual([expect.objectContaining({ id: photos[1]!.id, isPrimary: true })]);
    expect(await storage.head(testEnv.s3.mediaBucket, keyOf(photos[0]!.url))).toBeNull();
    // Search shows the cover (D3h): two uploads and a deletion, each announced.
    expect(await updates(b.id)).toEqual(['photos', 'photos', 'photos']);
  });

  it('strips GPS and camera data, turns the photo upright, and never publishes the original', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const original = await picture({ gps: true });
    const { req, done } = await uploadPicture(owner, `/v1/businesses/${b.id}/photos`, original);
    expect(done.status).toBe(200);

    // The original went to the PRIVATE bucket, under incoming/ — and is gone now.
    const incomingKey = keyOf(req.body.data.upload.url);
    expect(req.body.data.upload.url).toContain(`/${testEnv.s3.privateBucket}/incoming/business_photo/`);
    expect(await storage.head(testEnv.s3.privateBucket, incomingKey)).toBeNull();

    const published = Buffer.from(await (await fetch(done.body.data[0].url)).arrayBuffer());
    const meta = await sharp(published).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect([meta.width, meta.height]).toEqual([800, 1200]); // was stored sideways
    expect(published.includes(Buffer.from('PhoneMaker'))).toBe(false);
    expect(published.includes(Buffer.from('Ayesha'))).toBe(false);
  });

  it('refuses files that are not real images and deletes them', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    // Starts like a JPEG (passes the signature check) but is not a decodable image.
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(2000)]);
    const { req, done } = await uploadPicture(owner, `/v1/businesses/${b.id}/photos`, fake);
    expect(done.status).toBe(400);
    expect(done.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(await storage.head(testEnv.s3.privateBucket, keyOf(req.body.data.upload.url))).toBeNull();
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.photos).toEqual([]);
  });

  it('an upload completes once, only for the business it was requested for, and only after the file arrived', async () => {
    const owner = await person();
    const [b, other] = [await createBusiness(owner), await createBusiness(owner)];
    const file = await picture({ format: 'png' });
    const req = await request(app)
      .post(`/v1/businesses/${b.id}/photos/uploads`)
      .set(owner.auth)
      .send({ contentType: 'image/png', sizeBytes: file.length });
    const complete = (businessId: string) =>
      request(app)
        .post(`/v1/businesses/${businessId}/photos/uploads/${req.body.data.uploadId}/complete`)
        .set(owner.auth);

    const early = await complete(b.id);
    expect([early.status, early.body.error.code]).toEqual([409, 'UPLOAD_NOT_FOUND']);
    await fetch(req.body.data.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: file,
    });
    expect((await complete(other.id)).status).toBe(404); // someone else's business
    expect((await complete(b.id)).status).toBe(200);
    expect((await complete(b.id)).status).toBe(404); // single use
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.photos).toHaveLength(1);
  });
});

describe('Pictures: logo', () => {
  it('shows on the public profile; replacing deletes the old file; can be removed', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const base = `/v1/businesses/${b.id}/logo`;
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.logoUrl).toBeNull();

    const first = await uploadPicture(
      owner,
      base,
      await picture({ width: 2000, height: 2000, format: 'png' }),
      {},
      'image/png',
    );
    expect(first.done.status).toBe(200);
    const logo = await sharp(
      Buffer.from(await (await fetch(first.done.body.data.logoUrl)).arrayBuffer()),
    ).metadata();
    expect([logo.format, logo.width, logo.height]).toEqual(['webp', 512, 512]);

    const second = await uploadPicture(owner, base, await picture());
    const profile = await request(app).get(`/v1/businesses/${b.slug}`);
    expect(keyOf(profile.body.data.logoUrl)).toBe(keyOf(second.done.body.data.logoUrl));
    expect(profile.body.data).not.toHaveProperty('logoStorageKey');
    // The team's own views show the same logo as a link (with the gallery), never the storage key.
    const managed = await request(app).get(`/v1/businesses/${b.id}/manage`).set(owner.auth);
    expect(keyOf(managed.body.data.logoUrl)).toBe(keyOf(second.done.body.data.logoUrl));
    expect(managed.body.data.photos).toEqual([]);
    expect(managed.body.data).not.toHaveProperty('logoStorageKey');
    const mine = await request(app).get('/v1/businesses/mine').set(owner.auth);
    const listed = (mine.body.data as { id: string; logoUrl: string }[]).find((x) => x.id === b.id)!;
    expect(keyOf(listed.logoUrl)).toBe(keyOf(second.done.body.data.logoUrl));
    expect(listed).not.toHaveProperty('logoStorageKey');
    expect(await storage.head(testEnv.s3.mediaBucket, keyOf(first.done.body.data.logoUrl))).toBeNull();

    expect((await request(app).delete(base).set(owner.auth)).status).toBe(204);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.logoUrl).toBeNull();
    expect(await updates(b.id)).toEqual(['logo', 'logo', 'logo']);
  });
});

describe('Pictures: employee photos', () => {
  async function teamWithEmployee() {
    const owner = await person();
    const b = await createBusiness(owner);
    const employee = await person();
    await addMember(b.id, employee.id, 'staff');
    // The employee's bookable profile, as booking-service keeps it.
    const businessId = await idOf(b.id);
    const staff = await world.inBusiness(businessId, (tx) =>
      tx.staff.create({ data: { id: world.id(), businessId, userId: employee.id, displayName: 'Ali Raza' } }),
    );
    return { owner, b, employee, staff, base: `/v1/businesses/${b.id}/staff/${staff.id}/photo` };
  }

  it('needs the employee’s consent; then shows next to their name on the public profile', async () => {
    const { owner, b, staff, base } = await teamWithEmployee();
    const noConsent = await uploadPicture(owner, base, await picture());
    expect(noConsent.req.status).toBe(400);

    const { done } = await uploadPicture(owner, base, await picture({ gps: true }), {
      consentConfirmed: true,
    });
    expect(done.status).toBe(200);
    const team = (await request(app).get(`/v1/businesses/${b.slug}`)).body.data.team;
    expect(team).toEqual([
      { id: staff.id.toString(), displayName: 'Ali Raza', photoUrl: expect.any(String) },
    ]);
    const meta = await sharp(Buffer.from(await (await fetch(team[0].photoUrl)).arrayBuffer())).metadata();
    expect(meta.exif).toBeUndefined();

    const row = await inBusiness(b.id, (tx) =>
      tx.staffPhoto.findFirstOrThrow({ where: { staffId: staff.id } }),
    );
    expect(row.consentConfirmedById).toBe(owner.id);
  });

  it('the employee can remove their own photo; other staff cannot; outsiders get 404', async () => {
    const { owner, b, employee, base } = await teamWithEmployee();
    await uploadPicture(owner, base, await picture(), { consentConfirmed: true });
    const colleague = await person();
    await addMember(b.id, colleague.id, 'staff');

    expect((await request(app).delete(base).set(colleague.auth)).status).toBe(403);
    expect(
      (
        await request(app)
          .delete(base)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
    expect((await request(app).delete(base).set(employee.auth)).status).toBe(204);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.team[0].photoUrl).toBeNull();
  });

  it('cannot attach a photo to another business’s employee', async () => {
    const { staff } = await teamWithEmployee();
    const stranger = await person();
    const other = await createBusiness(stranger);
    const { req } = await uploadPicture(
      stranger,
      `/v1/businesses/${other.id}/staff/${staff.id}/photo`,
      await picture(),
      { consentConfirmed: true },
    );
    expect(req.status).toBe(404);
  });

  it('when the employee leaves the team, their photo is deleted (event from auth-service), once or twice', async () => {
    const { owner, b, employee, staff, base } = await teamWithEmployee();
    const { done } = await uploadPicture(owner, base, await picture(), { consentConfirmed: true });
    const key = keyOf(done.body.data.photoUrl);

    const handle = businessEventHandler({ pictures });
    const businessId = (await idOf(b.id)).toString();
    const event = createEvent({
      type: TOPICS.BUSINESSES_MEMBER_REMOVED,
      source: 'auth-service',
      subject: businessId,
      // Events carry internal IDs (DB-042).
      data: { businessId, userId: employee.id.toString(), memberId: world.id().toString() },
    });
    const ctx = { topic: event.type, partition: 0, offset: '0', key: null, attempt: 1 };
    await handle(event, ctx);
    await handle(event, ctx); // redelivery is harmless

    expect(await inBusiness(b.id, (tx) => tx.staffPhoto.count({ where: { staffId: staff.id } }))).toBe(0);
    expect(await storage.head(testEnv.s3.mediaBucket, key)).toBeNull();
  });
});

describe('Lawful per-country export', () => {
  it('is admin-only, needs a reference and legal basis, and is audited', async () => {
    const admin = await person('super_admin');
    const owner = await person();
    const b = await createBusiness(owner, {
      country: 'AE',
      city: 'Dubai',
      timezone: 'Asia/Dubai',
      currency: 'AED',
    });
    await request(app)
      .put(`/v1/businesses/${b.id}/legal-profile`)
      .set(owner.auth)
      .send(legalProfile({ registrationCountry: 'AE', registrationType: 'Trade licence' }));

    expect(
      (
        await request(app)
          .post('/v1/admin/business-exports')
          .set(owner.auth)
          .send({ country: 'AE', reference: 'REF-1', legalBasis: 'Court order 123/2026' })
      ).status,
    ).toBe(403);
    expect(
      (await request(app).post('/v1/admin/business-exports').set(admin.auth).send({ country: 'AE' })).status,
    ).toBe(400);

    const res = await request(app).post('/v1/admin/business-exports').set(admin.auth).send({
      country: 'AE',
      reference: 'DED-2026-0042',
      legalBasis: 'Request from the Department of Economy, letter 42',
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/buku-businesses-AE-/);
    const row = (res.body.data.businesses as { id: string; legal: { registrationType: string } }[]).find(
      (x) => x.id === b.id,
    )!;
    expect(row.legal.registrationType).toBe('Trade licence');
    const audit = await (
      await world.user(admin.id)
    ).auditLog.findFirstOrThrow({
      where: { action: 'admin.business_export' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.newValues).toMatchObject({ country: 'AE', reference: 'DED-2026-0042' });
  });
});

describe('Plans (billing on)', () => {
  it('Starter: 5 gallery photos and no staff photos; Essential lifts both', async () => {
    await withBusinessBilling(world, async () => {
      const owner = await person();
      const b = await createBusiness(owner);
      const businessId = await idOf(b.id);
      await world.inBusiness(businessId, (tx) =>
        tx.businessPhoto.createMany({
          data: Array.from({ length: 5 }, (_, i) => ({
            id: world.id(),
            businessId,
            storageKey: `businesses/${b.id}/photos/test-${i}-${randomUUID()}.webp`,
            contentType: 'image/webp',
            sizeBytes: 1000,
            uploadedAt: new Date(),
            isPrimary: i === 0,
            sortOrder: i,
          })),
        }),
      );
      const photo = { contentType: 'image/jpeg', sizeBytes: 1000 };
      const over = await request(app)
        .post(`/v1/businesses/${b.id}/photos/uploads`)
        .set(owner.auth)
        .send(photo);
      expect([over.status, over.body.error.code, over.body.error.details]).toEqual([
        409,
        'PLAN_LIMIT_REACHED',
        { limit: 'photos', max: 5, used: 5, plan: 'business_free' },
      ]);
      const staff = await world.inBusiness(businessId, (tx) =>
        tx.staff.create({ data: { id: world.id(), businessId, displayName: 'Ali' } }),
      );
      const staffPhoto = await request(app)
        .post(`/v1/businesses/${b.id}/staff/${staff.id}/photo/uploads`)
        .set(owner.auth)
        .send({ ...photo, consentConfirmed: true });
      expect([staffPhoto.status, staffPhoto.body.error.code]).toEqual([403, 'PLAN_FEATURE_UNAVAILABLE']);

      await givePlan(world, businessId, 'business_essential');
      expect(
        (await request(app).post(`/v1/businesses/${b.id}/photos/uploads`).set(owner.auth).send(photo)).status,
      ).toBe(201);
      expect(
        (
          await request(app)
            .post(`/v1/businesses/${b.id}/staff/${staff.id}/photo/uploads`)
            .set(owner.auth)
            .send({ ...photo, consentConfirmed: true })
        ).status,
      ).toBe(201);
    });
  });
});

describe('Kinds of business that owners add (D-098)', () => {
  const run = randomUUID().slice(0, 8);
  let groupId: string;

  beforeAll(async () => {
    // One of BUKU's own groups, as BUKU adds them on the directory.
    groupId = (
      await curator.category.create({
        data: { id: world.id(), name: `Grooming ${run}`, slug: `grooming-${run}`, depth: 0 },
      })
    ).id.toString();
  });

  const suggest = (who: Person, name: string, parentId = groupId) =>
    request(app).post('/v1/businesses/category-suggestions').set(who.auth).send({ parentId, name });

  it('a new kind is added under a group, pending review, and a business can use it at once', async () => {
    const owner = await person();
    const res = await suggest(owner, `  Tattoo   studio ${run} `);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      existing: false,
      category: { name: `Tattoo studio ${run}`, parentId: groupId, pending: true },
    });
    const row = await curator.category.findUniqueOrThrow({
      where: { id: BigInt(res.body.data.category.id) },
    });
    expect([row.depth, row.suggestedById, row.nameKey]).toEqual([1, owner.id, `tattoostudio${run}`]);
    // What they did, with the rest of their account.
    const audit = await (
      await world.user(owner.id)
    ).auditLog.findFirst({ where: { action: 'category.suggested', resourceId: row.id } });
    expect(audit?.userId).toBe(owner.id);

    // Usable at once, before the shards' copies have it (the directory is checked).
    const business = await createBusiness(owner, { categoryId: row.id.toString() });
    expect(
      await inBusiness(business.id, (tx) => tx.business.findFirstOrThrow({ select: { categoryId: true } })),
    ).toEqual({
      categoryId: row.id,
    });
  });

  it('a name that means the same as one on BUKU gives back that one, never a copy', async () => {
    const first = await suggest(await person(), `Henna Art ${run}`);
    expect(first.status).toBe(201);
    for (const same of [`henna art ${run}`, `HENNA-ART ${run}`, `Henna  Art ${run}`, ` Henna Art ${run} `]) {
      const again = await suggest(await person(), same);
      expect(again.status, same).toBe(200);
      expect(again.body.data).toMatchObject({
        existing: true,
        category: { id: first.body.data.category.id },
      });
    }
    expect(await curator.category.count({ where: { nameKey: `hennaart${run}` } })).toBe(1);
  });

  it('two owners adding the same kind at the same moment make one category', async () => {
    const [a, b] = await Promise.all([
      suggest(await person(), `Kite Shop ${run}`),
      suggest(await person(), `kite shop ${run}`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.category.id).toBe(b.body.data.category.id);
  });

  it('refuses names that would corrupt or deface the list, before anything is stored', async () => {
    const owner = await person();
    for (const bad of [
      '<script>alert(1)</script>',
      'Spa 💆',
      'Hair\u200Bcut',
      'Kebab / Grill',
      'x',
      '12345',
      "x'); DROP TABLE categories;--",
    ]) {
      const res = await suggest(owner, bad);
      expect(res.status, bad).toBe(400);
    }
    expect(await curator.category.count({ where: { suggestedById: owner.id } })).toBe(0);
  });

  it('only under one of BUKU’s own groups, a few at a time, and never by employee accounts', async () => {
    const owner = await person();
    const child = (await suggest(owner, `Wig Studio ${run}`)).body.data.category.id as string;
    expect((await suggest(owner, `Under a kind ${run}`, child)).status).toBe(400); // not a group
    expect((await suggest(owner, `Nowhere ${run}`, '999999999')).status).toBe(400);
    expect((await suggest(owner, `Nowhere ${run}`, randomUUID())).status).toBe(400);
    await suggest(owner, `Brow Bar ${run}`);
    await suggest(owner, `Lash Lounge ${run}`);
    const fourth = await suggest(owner, `Nail Art ${run}`);
    expect([fourth.status, fourth.body.error.code]).toEqual([409, 'LIMIT_REACHED']);
    expect((await suggest(await person('staff'), `Barber Den ${run}`)).status).toBe(403);
  });

  it('a kind BUKU switched off is not brought back by adding it again', async () => {
    const off = await curator.category.create({
      data: {
        id: world.id(),
        name: `Fortune Teller ${run}`,
        slug: `fortune-teller-${run}`,
        nameKey: `fortuneteller${run}`,
        isActive: false,
        parentId: BigInt(groupId),
        depth: 1,
      },
    });
    const res = await suggest(await person(), `fortune  TELLER ${run}`);
    expect([res.status, res.body.error.code]).toEqual([409, 'CATEGORY_UNAVAILABLE']);
    expect(await curator.category.count({ where: { nameKey: off.nameKey } })).toBe(1);
  });
});
