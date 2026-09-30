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
  Readiness,
  type JwtSigner,
  type Role,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildBusinessApp } from '../src/app.js';
import { createS3Storage } from '../src/storage/object-storage.js';

let app: Express;
let db: Database;
let redis: Redis;
let signer: JwtSigner;
let categoryId: string;

const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
const hex64 = () => randomBytes(32).toString('hex');

/** A user in the DB plus a valid access token for them. */
async function person(role: Role = 'user') {
  const user = await db.user.create({
    data: { name: `U ${randomUUID().slice(0, 6)}`, emailHash: hex64(), role },
  });
  const { token } = await signer.sign({ sub: user.id, role, sid: randomUUID() });
  return { id: user.id, auth: { Authorization: `Bearer ${token}`, 'X-Forwarded-For': newIp() } };
}

type Person = Awaited<ReturnType<typeof person>>;

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
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'business-int-test', maxConnections: 5 });
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
  const suffix = randomUUID().slice(0, 8);
  categoryId = (
    await db.category.create({ data: { name: `Barbershop ${suffix}`, slug: `barbershop-${suffix}` } })
  ).id;

  app = buildBusinessApp({
    db,
    redis,
    verifier,
    revocations: createRevocationStore(redis),
    cipher: createFieldCipher(parseKeyring(`k1:${randomBytes(32).toString('base64')}`, 'k1')),
    indexer: createBlindIndexer(randomBytes(32)),
    storage: createS3Storage({
      endpoint: testEnv.s3.endpoint,
      publicEndpoint: testEnv.s3.endpoint,
      region: 'us-east-1',
      accessKeyId: testEnv.s3.accessKeyId,
      secretAccessKey: testEnv.s3.secretAccessKey,
      forcePathStyle: true,
    }),
    settings: {
      businessTermsVersion: '1.0',
      maxBusinessesPerOwner: 3,
      documentsBucket: testEnv.s3.documentsBucket,
      mediaBucket: testEnv.s3.mediaBucket,
    },
    http: {
      service: 'business-test',
      logger: createLogger({ service: 'business-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
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
    const id = res.body.data.id as string;
    expect((await db.outboxEvent.findMany({ where: { aggregateId: id } })).map((e) => e.topic)).toEqual([
      'businesses.created',
    ]);
    expect(await db.auditLog.count({ where: { resourceId: id, action: 'business.created' } })).toBe(1);
    // location + full-text columns are maintained by the DB trigger
    const [row] = await db.$queryRaw<
      { has_location: boolean }[]
    >`SELECT location IS NOT NULL AS has_location FROM businesses WHERE id = ${id}::uuid`;
    expect(row!.has_location).toBe(true);
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
    ['unknown category', { categoryId: randomUUID() }],
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
    await db.businessMember.createMany({
      data: [
        { businessId: b.id, userId: manager.id, role: 'manager' },
        { businessId: b.id, userId: frontDesk.id, role: 'front_desk' },
        { businessId: b.id, userId: staff.id, role: 'staff' },
      ],
    });
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
    const m = await db.businessMember.create({
      data: { businessId: b.id, userId: manager.id, role: 'manager' },
    });
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(manager.auth)).status).toBe(200);
    await db.businessMember.update({ where: { id: m.id }, data: { status: 'disabled' } });
    expect((await request(app).get(`/v1/businesses/${b.id}/manage`).set(manager.auth)).status).toBe(404);
  });

  it('lists my businesses with my role in each', async () => {
    const me = await person();
    const own = await createBusiness(me);
    const other = await createBusiness(await person());
    await db.businessMember.create({ data: { businessId: other.id, userId: me.id, role: 'front_desk' } });
    const res = await request(app).get('/v1/businesses/mine').set(me.auth);
    const roles = Object.fromEntries(
      (res.body.data as { id: string; myRole: string }[]).map((b) => [b.id, b.myRole]),
    );
    expect(roles).toEqual({ [own.id]: 'owner', [other.id]: 'front_desk' });
  });

  it('changing name or address of a VERIFIED business sends it back to review', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    await db.business.update({
      where: { id: b.id },
      data: { status: 'verified', verified: true, verifiedAt: new Date() },
    });

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
    const events = await db.outboxEvent.findMany({
      where: { aggregateId: b.id, topic: 'businesses.updated' },
      orderBy: { createdAt: 'asc' },
    });
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
    expect((await db.outboxEvent.findMany({ where: { aggregateId: b.id } })).map((e) => e.topic)).toContain(
      'businesses.verified',
    );

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
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
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
    const row = await db.businessLegalProfile.findUniqueOrThrow({ where: { businessId: b.id } });
    expect(row.registrationNumberEncrypted).toMatch(/^enc:1:/);
    expect(JSON.stringify(row)).not.toContain('0123456');
    expect(JSON.stringify(row)).not.toContain('ayesha@example.com');
  });

  it('only the owner may see or change legal details', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const manager = await person();
    await db.businessMember.create({ data: { businessId: b.id, userId: manager.id, role: 'manager' } });
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
    expect(
      await db.auditLog.count({ where: { action: 'admin.legal_profile_viewed', resourceId: b.id } }),
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
    expect(await db.businessDocument.count({ where: { id: documentId } })).toBe(0);
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
    await db.businessMember.create({ data: { businessId: b.id, userId: manager.id, role: 'manager' } });
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
    const suffix = randomUUID().slice(0, 6);
    const health = await db.category.upsert({
      where: { slug: 'health-medical' },
      update: {},
      create: { name: 'Health & Medical', slug: 'health-medical' },
    });
    const dental = await db.category.create({
      data: { name: `Dental ${suffix}`, slug: `dental-${suffix}`, parentId: health.id, depth: 1 },
    });
    const b = await createBusiness(owner, { categoryId: dental.id });
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

describe('Photos (public)', () => {
  it('manager uploads; first photo is the cover; public profile shows working links; staff cannot upload', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const [manager, staff] = [await person(), await person()];
    await db.businessMember.createMany({
      data: [
        { businessId: b.id, userId: manager.id, role: 'manager' },
        { businessId: b.id, userId: staff.id, role: 'staff' },
      ],
    });
    expect(
      (
        await request(app)
          .post(`/v1/businesses/${b.id}/photos/uploads`)
          .set(staff.auth)
          .send({ contentType: 'image/png', sizeBytes: PNG.length })
      ).status,
    ).toBe(403);

    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const req = await request(app)
        .post(`/v1/businesses/${b.id}/photos/uploads`)
        .set(manager.auth)
        .send({ contentType: 'image/png', sizeBytes: PNG.length, altText: `Photo ${i}` });
      await fetch(req.body.data.upload.url, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png' },
        body: PNG,
      });
      const done = await request(app)
        .post(`/v1/businesses/${b.id}/photos/${req.body.data.photoId}/complete`)
        .set(manager.auth);
      expect(done.status).toBe(200);
      ids.push(req.body.data.photoId);
    }
    const pub = await request(app).get(`/v1/businesses/${b.slug}`);
    expect(pub.body.data.photos.map((p: { id: string; isPrimary: boolean }) => [p.id, p.isPrimary])).toEqual([
      [ids[0], true],
      [ids[1], false],
    ]);
    expect((await fetch(pub.body.data.photos[0].url)).status).toBe(200);

    // Deleting the cover promotes the next photo.
    const after = await request(app).delete(`/v1/businesses/${b.id}/photos/${ids[0]}`).set(owner.auth);
    expect(after.body.data).toEqual([expect.objectContaining({ id: ids[1], isPrimary: true })]);
  });

  it('a photo that is not really an image is refused', async () => {
    const owner = await person();
    const b = await createBusiness(owner);
    const fake = Buffer.from('GIF89a but actually text');
    const req = await request(app)
      .post(`/v1/businesses/${b.id}/photos/uploads`)
      .set(owner.auth)
      .send({ contentType: 'image/jpeg', sizeBytes: fake.length });
    await fetch(req.body.data.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: fake,
    });
    const done = await request(app)
      .post(`/v1/businesses/${b.id}/photos/${req.body.data.photoId}/complete`)
      .set(owner.auth);
    expect(done.status).toBe(400);
    expect((await request(app).get(`/v1/businesses/${b.slug}`)).body.data.photos).toEqual([]);
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
    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'admin.business_export' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit.newValues).toMatchObject({ country: 'AE', reference: 'DED-2026-0042' });
  });
});
