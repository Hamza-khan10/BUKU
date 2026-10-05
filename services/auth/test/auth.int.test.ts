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
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import { businessRoleOf, createDatabaseClient, type Database } from '@buku/database';
import type { Express } from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { givePlan, withBilling } from '../../../packages/billing/test/helpers.js';
import { buildAuthApp } from '../src/app.js';
import type { DataRightsService } from '../src/users/data-rights.js';
import { appointmentData, createBusinessFixture } from '../../../packages/database/test/fixtures.js';
import { createOidcVerifierWithKeys } from '../src/identity/oidc.js';
import { base32Decode, hotp, stepAt } from '../src/mfa/totp.js';
import { createS3Storage, MediaLinks, PictureUploads, type ObjectStorage } from '@buku/media';
import sharp from 'sharp';

/**
 * auth-service against the real test database and Valkey. A locally
 * generated key pair plays the role of Google's signing keys, so we can mint
 * valid, forged, expired and wrong-audience ID tokens at will.
 */
const GOOGLE_CLIENT_ID = 'buku-test.apps.googleusercontent.com';
const TERMS = '1.0';

let app: Express;
/** The same service with development sign-in switched on (never in production). */
let devApp: Express;
let rights: DataRightsService;
let db: Database;
let redis: Redis;
let googleKey: CryptoKey;
let foreignKey: CryptoKey;
let cipher: FieldCipher;
let indexer: BlindIndexer;
let storage: ObjectStorage;

async function googleIdToken(
  claims: Record<string, unknown> = {},
  opts: { key?: CryptoKey; aud?: string; exp?: string } = {},
) {
  const sub = (claims.sub as string | undefined) ?? randomUUID();
  return new SignJWT({ email: `${sub}@example.com`, email_verified: true, name: 'Test User', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test' })
    .setIssuer('https://accounts.google.com')
    .setAudience(opts.aud ?? GOOGLE_CLIENT_ID)
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? '5m')
    .sign(opts.key ?? googleKey);
}

async function signUp(overrides: Record<string, unknown> = {}) {
  const res = await post('/v1/auth/oauth/google').send({
    idToken: await googleIdToken(),
    acceptedTermsVersion: TERMS,
    device: { name: 'Test phone', platform: 'ios' },
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data as {
    user: { id: string; email: string };
    accessToken: string;
    refreshToken: string;
    sessionId: string;
  };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const userIdOf = (body: unknown) => (body as { data: { user: { id: string } } }).data.user.id;

/** A fresh client IP per simulated user (the service trusts one proxy hop, like behind Kong). */
// Random, so re-running the suite within a minute never reuses a rate-limit bucket.
const newIp = () => `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;
/** POST from its own client IP, so per-IP rate limits don't couple unrelated tests. */
const post = (path: string, ip = newIp()) => request(app).post(path).set('X-Forwarded-For', ip);

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'auth-int-test', maxConnections: 5 });
  redis = createRedisClient({ url: testEnv.redisUrl, connectionName: 'auth-int-test' });

  const google = await generateKeyPair('RS256');
  googleKey = google.privateKey;
  foreignKey = (await generateKeyPair('RS256')).privateKey;
  const googleJwk = { ...(await exportJWK(google.publicKey)), kid: 'google-test', alg: 'RS256' };

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

  cipher = createFieldCipher(parseKeyring(`k1:${randomBytes(32).toString('base64')}`, 'k1'));
  indexer = createBlindIndexer(randomBytes(32));
  storage = createS3Storage({
    endpoint: testEnv.s3.endpoint,
    publicEndpoint: testEnv.s3.endpoint,
    region: 'us-east-1',
    accessKeyId: testEnv.s3.accessKeyId,
    secretAccessKey: testEnv.s3.secretAccessKey,
    forcePathStyle: true,
  });
  const deps: Parameters<typeof buildAuthApp>[0] = {
    db,
    redis,
    signer,
    verifier,
    cipher,
    indexer,
    revocations: createRevocationStore(redis),
    // A stand-in for Have I Been Pwned: tests say which passwords are "breached", or that it's down.
    breaches: {
      timesSeen: (password: string) =>
        Promise.resolve(breachCheckDown ? null : (breached.get(password) ?? 0)),
    },
    storage,
    pictureUploads: new PictureUploads(storage, redis, { privateBucket: testEnv.s3.privateBucket }),
    mediaLinks: new MediaLinks(storage, {
      mediaBucket: testEnv.s3.mediaBucket,
      privateBucket: testEnv.s3.privateBucket,
    }),
    identity: {
      google: createOidcVerifierWithKeys({
        provider: 'google',
        issuers: ['https://accounts.google.com'],
        audiences: [GOOGLE_CLIENT_ID],
        keys: createLocalJWKSet({ keys: [googleJwk] }),
      }),
      apple: null, // locked (D-028)
    },
    settings: {
      termsVersion: TERMS,
      devLoginEnabled: false,
      sessionIdleTimeoutDays: 180,
      adminSessionIdleTimeoutHours: 24,
      refreshReuseGraceSeconds: 15,
      deletionGraceDays: 30,
      reauthWindowMinutes: 10,
      memberLoginMaxAttempts: 5,
      memberLockoutMinutes: 15,
      maxMembersPerBusiness: 50,
    },
    http: {
      service: 'auth-test',
      logger: createLogger({ service: 'auth-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  };
  ({ app, rights } = buildAuthApp(deps));
  devApp = buildAuthApp({ ...deps, settings: { ...deps.settings, devLoginEnabled: true } }).app;
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
});

/** Passwords the breach check reports as seen, and whether it's unreachable (see deps.breaches). */
const breached = new Map<string, number>();
let breachCheckDown = false;

describe('Sign in with Google', () => {
  it('creates an account (201), encrypts the email, emits users.registered, returns tokens', async () => {
    const s = await signUp();
    expect(s.user.email).toMatch(/@example\.com$/);
    expect(s.accessToken.split('.')).toHaveLength(3);
    expect(s.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const row = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(row.emailEncrypted).toMatch(/^enc:1:k1:/);
    expect(row.emailEncrypted).not.toContain('@');
    expect(row.termsVersion).toBe(TERMS);

    const events = await db.outboxEvent.findMany({ where: { aggregateId: s.user.id } });
    expect(events.map((e) => e.topic)).toEqual(['users.registered']);
    expect(JSON.stringify(events[0]!.payload)).not.toContain('@example.com'); // no PII in events

    const stored = await db.refreshToken.findFirstOrThrow({ where: { userId: s.user.id } });
    expect(stored.tokenHash).not.toBe(s.refreshToken); // only the hash is stored
  });

  it('signs an existing user back in (200) without creating a new account', async () => {
    const sub = randomUUID();
    const first = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    const again = await post('/v1/auth/oauth/google').send({ idToken: await googleIdToken({ sub }) });
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.isNewUser).toBe(false);
    expect(again.body.data.user.id).toBe(first.body.data.user.id);
  });

  it('requires accepting the current Terms before creating an account', async () => {
    const res = await post('/v1/auth/oauth/google').send({ idToken: await googleIdToken() });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'TERMS_NOT_ACCEPTED', details: { termsVersion: TERMS } });
  });

  const invalidTokens: [string, () => Promise<string>][] = [
    ['signed by someone else', () => googleIdToken({}, { key: foreignKey })],
    [
      'issued for another app',
      () => googleIdToken({}, { aud: 'someone-elses-app.apps.googleusercontent.com' }),
    ],
    ['expired', () => googleIdToken({}, { exp: '-1m' })],
  ];
  it.each(invalidTokens)('rejects an ID token %s', async (_label, makeToken) => {
    const res = await post('/v1/auth/oauth/google').send({
      idToken: await makeToken(),
      acceptedTermsVersion: TERMS,
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('OAUTH_TOKEN_INVALID');
  });

  it('rate-limits sign-in attempts per client IP (11th in a minute → 429)', async () => {
    const ip = newIp();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push((await post('/v1/auth/oauth/google', ip).send({ idToken: 'x'.repeat(40) })).status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
    // A different client is unaffected.
    expect((await post('/v1/auth/oauth/google').send({ idToken: 'x'.repeat(40) })).status).toBe(401);
  });

  it('refuses accounts whose email Google has not verified', async () => {
    const res = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ email_verified: false }),
      acceptedTermsVersion: TERMS,
    });
    expect(res.status).toBe(401);
  });

  it('keeps Apple sign-in locked until it is enabled', async () => {
    const res = await post('/v1/auth/oauth/apple').send({
      idToken: 'x'.repeat(40),
      acceptedTermsVersion: TERMS,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FEATURE_DISABLED');
  });

  it('does not expose the dev sign-in unless explicitly enabled', async () => {
    expect((await post('/v1/auth/dev/login').send({ email: 'a@b.co' })).status).toBe(404);
  });

  it('two simultaneous first sign-ins (a double tap) make one account, and both get in', async () => {
    const sub = randomUUID();
    const signIn = async () =>
      post('/v1/auth/oauth/google').send({
        idToken: await googleIdToken({ sub }),
        acceptedTermsVersion: TERMS,
      });
    const answers = await Promise.all([signIn(), signIn()]);
    expect(answers.map((a) => a.status).sort()).toEqual([200, 201]);
    expect(new Set(answers.map((a) => userIdOf(a.body))).size).toBe(1);
    expect(await db.oAuthAccount.count({ where: { providerUserId: sub } })).toBe(1);
  });
});

describe('Development sign-in (development only)', () => {
  const devPost = (path: string) => request(devApp).post(path).set('X-Forwarded-For', newIp());

  it('two simultaneous first sign-ins with one email make one account, and both get in', async () => {
    const email = `dev-race-${randomUUID()}@example.com`;
    const answers = await Promise.all(
      [1, 2, 3].map(() => devPost('/v1/auth/dev/login').send({ email, role: 'business_owner' })),
    );
    expect(answers.map((a) => a.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(answers.map((a) => userIdOf(a.body))).size).toBe(1);
    expect(answers.every((a) => (a.body as { data: { accessToken?: string } }).data.accessToken)).toBe(true);
  });
});

describe('Sessions: stay signed in, rotate, detect theft', () => {
  it('rotates the refresh token on every use; the new one works', async () => {
    const s = await signUp();
    const r1 = await post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.data.refreshToken).not.toBe(s.refreshToken);
    expect(r1.body.data.sessionId).toBe(s.sessionId); // same device session
    const r2 = await post('/v1/auth/refresh').send({ refreshToken: r1.body.data.refreshToken });
    expect(r2.status).toBe(200);
  });

  it('treats an immediate duplicate refresh as a client race, not theft', async () => {
    const s = await signUp();
    const [a, b] = await Promise.all([
      post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
      post('/v1/auth/refresh').send({ refreshToken: s.refreshToken }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 401]);
    const winner = a.status === 200 ? a : b;
    // The session survives: the winning token still refreshes.
    expect(
      (await post('/v1/auth/refresh').send({ refreshToken: winner.body.data.refreshToken })).status,
    ).toBe(200);
  });

  it('revokes the whole session when an old refresh token is replayed (stolen token)', async () => {
    const s = await signUp();
    const rotated = await post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    // Simulate the replay happening after the grace window.
    await db.refreshToken.updateMany({
      where: { familyId: s.sessionId, revokedReason: 'rotated' },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const replay = await post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toMatchObject({
      code: 'SESSION_REVOKED',
      details: { reason: 'reuse_detected' },
    });

    // The legitimate holder's newer token is dead too, and so is the access token.
    expect(
      (await post('/v1/auth/refresh').send({ refreshToken: rotated.body.data.refreshToken })).status,
    ).toBe(401);
    const me = await request(app).get('/v1/auth/me').set(bearer(rotated.body.data.accessToken));
    expect(me.body.error).toMatchObject({ code: 'SESSION_REVOKED', details: { reason: 'reuse_detected' } });
    expect(
      await db.auditLog.count({ where: { action: 'auth.refresh_token_reuse_detected', userId: s.user.id } }),
    ).toBe(1);
  });

  it('logout ends that device only: refresh and access token stop working', async () => {
    const phone = await signUp();
    const laptop = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub: 'unused' }),
      acceptedTermsVersion: TERMS,
    });
    expect((await post('/v1/auth/logout').send({ refreshToken: phone.refreshToken })).status).toBe(204);
    expect(
      (await post('/v1/auth/refresh').send({ refreshToken: phone.refreshToken })).body.error.details.reason,
    ).toBe('logged_out');
    expect((await request(app).get('/v1/auth/me').set(bearer(phone.accessToken))).status).toBe(401);
    expect((await request(app).get('/v1/auth/me').set(bearer(laptop.body.data.accessToken))).status).toBe(
      200,
    );
  });

  it('"log out everywhere" ends every device and tells clients why', async () => {
    const sub = randomUUID();
    const a = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    const b = await post('/v1/auth/oauth/google').send({ idToken: await googleIdToken({ sub }) });
    expect((await post('/v1/auth/logout-all').set(bearer(a.body.data.accessToken))).status).toBe(204);

    for (const s of [a, b]) {
      const me = await request(app).get('/v1/auth/me').set(bearer(s.body.data.accessToken));
      expect(me.body.error).toMatchObject({
        code: 'SESSION_REVOKED',
        details: { reason: 'logged_out_everywhere' },
      });
      const refresh = await post('/v1/auth/refresh').send({ refreshToken: s.body.data.refreshToken });
      expect(refresh.body.error.details.reason).toBe('logged_out_everywhere');
    }
  });

  it('lists my devices and lets me end one — but never someone else’s', async () => {
    const sub = randomUUID();
    const a = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
      device: { name: 'Pixel', platform: 'android' },
    });
    const b = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      device: { name: 'Browser', platform: 'web' },
    });
    const stranger = await signUp();

    const list = await request(app).get('/v1/auth/sessions').set(bearer(a.body.data.accessToken));
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.find((s: { current: boolean }) => s.current).device).toEqual({
      name: 'Pixel',
      platform: 'android',
    });
    expect(list.body.data[0].ipAddress ?? '').not.toMatch(/^\d+\.\d+\.\d+\.\d+$/); // masked

    // Someone else's session id → 404, and it stays alive.
    const attack = await request(app)
      .delete(`/v1/auth/sessions/${b.body.data.sessionId}`)
      .set(bearer(stranger.accessToken));
    expect(attack.status).toBe(404);
    expect((await request(app).get('/v1/auth/me').set(bearer(b.body.data.accessToken))).status).toBe(200);

    expect(
      (
        await request(app)
          .delete(`/v1/auth/sessions/${b.body.data.sessionId}`)
          .set(bearer(a.body.data.accessToken))
      ).status,
    ).toBe(204);
    const after = await request(app).get('/v1/auth/me').set(bearer(b.body.data.accessToken));
    expect(after.body.error.details.reason).toBe('revoked_by_user');
  });

  it('rejects garbage and forged refresh tokens without revealing anything', async () => {
    const res = await post('/v1/auth/refresh').send({ refreshToken: 'A'.repeat(43) });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
    expect((await post('/v1/auth/logout').send({ refreshToken: 'A'.repeat(43) })).status).toBe(204);
  });
});

describe('My account', () => {
  it('returns my profile with decrypted contact details and onboarding state', async () => {
    const s = await signUp();
    const me = await request(app).get('/v1/auth/me').set(bearer(s.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject({
      id: s.user.id,
      email: s.user.email,
      phone: null,
      onboarding: { phoneRequired: true },
    });
  });

  it('updates the profile, sanitizes input and refuses privilege fields', async () => {
    const s = await signUp();
    const ok = await request(app)
      .patch('/v1/auth/me')
      .set(bearer(s.accessToken))
      .send({ name: '<b>Ayesha</b> Khan', timezone: 'Asia/Karachi' });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Ayesha Khan', timezone: 'Asia/Karachi' });

    const escalate = await request(app)
      .patch('/v1/auth/me')
      .set(bearer(s.accessToken))
      .send({ role: 'super_admin' });
    expect(escalate.status).toBe(400);
    expect((await db.user.findUniqueOrThrow({ where: { id: s.user.id } })).role).toBe('user');
  });

  it('stores the phone number encrypted with the WhatsApp consent time', async () => {
    const s = await signUp();
    const res = await request(app)
      .put('/v1/auth/me/phone')
      .set(bearer(s.accessToken))
      .send({ phone: '+923001234567', whatsappOptIn: true });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      phone: { number: '+923001234567', verified: false },
      whatsappOptIn: true,
      onboarding: { phoneRequired: false },
    });
    const row = await db.user.findUniqueOrThrow({ where: { id: s.user.id } });
    expect(row.unverifiedPhoneEncrypted).not.toContain('923001234567');
    expect(row.whatsappOptInAt).not.toBeNull();

    expect(
      (
        await request(app)
          .put('/v1/auth/me/phone')
          .set(bearer(s.accessToken))
          .send({ phone: '03001234567', whatsappOptIn: true })
      ).status,
    ).toBe(400);
  });

  it('the newest number wins; re-entering the verified number keeps it verified', async () => {
    const s = await signUp();
    const verified = '+923005550001';
    // Simulate a number verified earlier (OTP verification is a later feature).
    await db.user.update({
      where: { id: s.user.id },
      data: {
        phoneEncrypted: cipher.encrypt(verified, 'users.phone'),
        phoneHash: indexer.hash('users.phone', verified),
      },
    });
    const changed = await request(app)
      .put('/v1/auth/me/phone')
      .set(bearer(s.accessToken))
      .send({ phone: '+923005550002', whatsappOptIn: true });
    expect(changed.body.data.phone).toEqual({ number: '+923005550002', verified: false });
    const back = await request(app)
      .put('/v1/auth/me/phone')
      .set(bearer(s.accessToken))
      .send({ phone: verified, whatsappOptIn: true });
    expect(back.body.data.phone).toEqual({ number: verified, verified: true });
  });

  it('two people can both claim the same UNVERIFIED number (nobody can block someone else)', async () => {
    const [a, b] = [await signUp(), await signUp()];
    for (const s of [a, b]) {
      expect(
        (
          await request(app)
            .put('/v1/auth/me/phone')
            .set(bearer(s.accessToken))
            .send({ phone: '+923009999999', whatsappOptIn: false })
        ).status,
      ).toBe(200);
    }
  });

  it('registers push tokens and never deletes another user’s device', async () => {
    const [a, b] = [await signUp(), await signUp()];
    const token = `fcm-${randomUUID()}`;
    expect(
      (await post('/v1/auth/push-tokens').set(bearer(a.accessToken)).send({ token, platform: 'android' }))
        .status,
    ).toBe(204);
    expect(
      (await request(app).delete(`/v1/auth/push-tokens/${token}`).set(bearer(b.accessToken))).status,
    ).toBe(404);
    expect(
      (await request(app).delete(`/v1/auth/push-tokens/${token}`).set(bearer(a.accessToken))).status,
    ).toBe(204);
  });

  it('requires authentication for every account endpoint', async () => {
    for (const [method, path] of [
      ['get', '/v1/auth/me'],
      ['patch', '/v1/auth/me'],
      ['get', '/v1/auth/sessions'],
      ['post', '/v1/auth/logout-all'],
    ] as const) {
      expect((await request(app)[method](path)).status).toBe(401);
    }
  });
});

describe('My data: export and deletion', () => {
  it('exports everything about me — and nothing about anyone else', async () => {
    const s = await signUp();
    const other = await signUp();
    const f = await createBusinessFixture(db);
    await db.appointment.create({
      data: {
        ...appointmentData(f, new Date('2031-05-01T10:00:00Z')),
        userId: s.user.id,
        internalNotes: 'business-only note',
      },
    });
    await db.appointment.create({
      data: { ...appointmentData(f, new Date('2031-05-02T10:00:00Z')), userId: other.user.id },
    });
    await db.whatsappContact.create({
      data: {
        userId: s.user.id,
        phoneEncrypted: cipher.encrypt('+923001234567', 'whatsapp.phone'),
        phoneHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        linkedAt: new Date(),
      },
    });

    const res = await request(app).get('/v1/auth/me/export').set(bearer(s.accessToken));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(
      /attachment; filename="buku-data-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    const data = res.body.data;
    expect(data.format).toBe('buku-data-export/1');
    expect(data.account.email).toBe(s.user.email);
    expect(data.signInMethods).toEqual([expect.objectContaining({ provider: 'google' })]);
    expect(data.appointments).toHaveLength(1);
    expect(data.appointments[0].business.name).toBe(f.business.name);
    expect(data.whatsapp).toMatchObject({ phone: '+923001234567', stoppedAt: null });
    expect(JSON.stringify(data)).not.toContain('business-only note');
    expect(JSON.stringify(data)).not.toContain(other.user.id);
    expect(data.securityLog.map((e: { action: string }) => e.action)).toContain('auth.signed_up');
  });

  it('requires a recent sign-in to delete the account', async () => {
    const s = await signUp();
    // Pretend this session was signed in 20 minutes ago (refreshes don't count).
    await db.refreshToken.updateMany({
      where: { familyId: s.sessionId },
      data: { createdAt: new Date(Date.now() - 20 * 60_000) },
    });
    const res = await request(app)
      .delete('/v1/auth/me')
      .set(bearer(s.accessToken))
      .send({ confirmation: 'DELETE' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'REAUTH_REQUIRED', details: { withinMinutes: 10 } });
  });

  it('requires the typed confirmation', async () => {
    const s = await signUp();
    expect((await request(app).delete('/v1/auth/me').set(bearer(s.accessToken)).send({})).status).toBe(400);
    expect(
      (await request(app).delete('/v1/auth/me').set(bearer(s.accessToken)).send({ confirmation: 'yes' }))
        .status,
    ).toBe(400);
  });

  it('deleting signs out everywhere, stops notifications, and tells other services', async () => {
    const s = await signUp();
    await request(app)
      .post('/v1/auth/push-tokens')
      .set(bearer(s.accessToken))
      .send({ token: `fcm-${randomUUID()}`, platform: 'ios' });
    await db.whatsappContact.create({
      data: {
        userId: s.user.id,
        phoneEncrypted: cipher.encrypt('+923001234568', 'whatsapp.phone'),
        phoneHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
        linkedAt: new Date(),
      },
    });
    const res = await request(app)
      .delete('/v1/auth/me')
      .set(bearer(s.accessToken))
      .send({ confirmation: 'DELETE', reason: 'Just testing' });
    expect(res.status).toBe(202);
    expect(new Date(res.body.data.purgeAfter).getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);

    const me = await request(app).get('/v1/auth/me').set(bearer(s.accessToken));
    expect(me.body.error).toMatchObject({ code: 'SESSION_REVOKED', details: { reason: 'account_deleted' } });
    expect(await db.pushToken.count({ where: { userId: s.user.id } })).toBe(0);
    expect(await db.whatsappContact.count({ where: { userId: s.user.id } })).toBe(0);
    const topics = (await db.outboxEvent.findMany({ where: { aggregateId: s.user.id } })).map((e) => e.topic);
    expect(topics).toContain('users.deleted');
  });

  it('signing in during the grace period offers restore, and restoring works', async () => {
    const sub = randomUUID();
    const first = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    await request(app)
      .delete('/v1/auth/me')
      .set(bearer(first.body.data.accessToken))
      .send({ confirmation: 'DELETE' });

    const blocked = await post('/v1/auth/oauth/google').send({ idToken: await googleIdToken({ sub }) });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.details).toMatchObject({ reason: 'account_deleted', canRestore: true });

    const restored = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      restoreAccount: true,
    });
    expect(restored.status).toBe(200);
    expect(restored.body.data.user.id).toBe(first.body.data.user.id);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: first.body.data.user.id } })).deletedAt,
    ).toBeNull();
  });

  it('restoring can never lift a suspension', async () => {
    const sub = randomUUID();
    const first = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    await request(app)
      .delete('/v1/auth/me')
      .set(bearer(first.body.data.accessToken))
      .send({ confirmation: 'DELETE' });
    await db.user.update({
      where: { id: first.body.data.user.id, deletedAt: undefined },
      data: { status: 'suspended' },
    });
    const attempt = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      restoreAccount: true,
    });
    expect(attempt.status).toBe(403);
    expect(attempt.body.error.message).toMatch(/suspended/);
  });

  it('after the grace period, personal data is purged for good; records stay anonymous', async () => {
    const sub = randomUUID();
    const first = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    const userId = first.body.data.user.id as string;
    await request(app)
      .put('/v1/auth/me/phone')
      .set(bearer(first.body.data.accessToken))
      .send({ phone: '+923001112233', whatsappOptIn: true });
    const f = await createBusinessFixture(db);
    const appt = await db.appointment.create({
      data: {
        ...appointmentData(f, new Date('2020-01-01T10:00:00Z')),
        userId,
        status: 'completed',
        notes: 'my private note',
      },
    });
    await db.review.create({
      data: {
        appointmentId: appt.id,
        userId,
        businessId: f.business.id,
        overallRating: 5,
        comment: 'Great, ask for Ali',
      },
    });
    await request(app)
      .delete('/v1/auth/me')
      .set(bearer(first.body.data.accessToken))
      .send({ confirmation: 'DELETE' });
    await db.user.update({
      where: { id: userId, deletedAt: undefined },
      data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    await db.notificationMark.create({ data: { key: `test:${randomUUID()}`, kind: 'rebook', userId } });

    expect(await rights.purgeDue()).toBeGreaterThanOrEqual(1);
    expect(await db.notificationMark.count({ where: { userId } })).toBe(0);

    const purged = await db.user.findFirstOrThrow({ where: { id: userId, deletedAt: undefined } });
    expect(purged).toMatchObject({
      name: 'Deleted user',
      emailEncrypted: null,
      emailHash: null,
      unverifiedPhoneEncrypted: null,
      whatsappOptInAt: null,
    });
    expect(purged.purgedAt).not.toBeNull();
    expect(await db.oAuthAccount.count({ where: { userId } })).toBe(0);
    const review = await db.review.findUniqueOrThrow({ where: { appointmentId: appt.id } });
    expect(review).toMatchObject({ overallRating: 5, comment: null }); // rating kept, words gone
    expect((await db.appointment.findUniqueOrThrow({ where: { id: appt.id } })).notes).toBeNull();
    expect(await rights.purgeDue()).toBe(0); // idempotent

    // The same Google account can now start a completely fresh account.
    const fresh = await post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });
    expect(fresh.status).toBe(201);
    expect(fresh.body.data.user.id).not.toBe(userId);
  });
});

describe('Business team: employee accounts', () => {
  /**
   * Test passwords are generated per run: nothing password-like is committed,
   * so secret scanners have nothing to flag and no alert ever needs dismissing.
   */
  const pw = (prefix = 'Pw') => `${prefix}-${randomUUID().slice(0, 13)}`;
  const NEW_PASSWORD = pw();

  /** A Google user who owns a fresh business. */
  async function owner() {
    const s = await signUp();
    const suffix = randomUUID().slice(-12);
    const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
    const business = await db.business.create({
      data: {
        ownerId: s.user.id,
        categoryId: category.id,
        name: `Team Barber ${suffix}`,
        slug: `team-barber-${suffix}`,
        city: 'Lahore',
        country: 'PK',
        lat: 31.5204,
        lng: 74.3587,
        timezone: 'Asia/Karachi',
        currency: 'PKR',
      },
    });
    return { ...s, business };
  }

  const team = (businessId: string) => `/v1/businesses/${businessId}/members`;

  async function addMember(token: string, businessId: string, body: Record<string, unknown>) {
    return post(team(businessId)).set(bearer(token)).send(body);
  }

  const login = (business: string, username: string, password: string) =>
    post('/v1/auth/business-login').send({
      business,
      username,
      password,
      device: { name: 'Front desk tablet' },
    });

  /** Create an employee and take them through their first sign-in + password change. */
  async function employee(
    o: Awaited<ReturnType<typeof owner>>,
    role: string,
    username = `emp-${randomInt(1e9)}`,
  ) {
    const created = await addMember(o.accessToken, o.business.id, { name: 'Ali Raza', username, role });
    expect(created.status).toBe(201);
    const first = await login(o.business.slug, username, created.body.data.temporaryPassword);
    expect(first.status).toBe(200);
    const changed = await post('/v1/auth/password')
      .set(bearer(first.body.data.accessToken))
      .send({ currentPassword: created.body.data.temporaryPassword, newPassword: NEW_PASSWORD });
    expect(changed.status).toBe(200);
    const signedIn = await login(o.business.slug, username, NEW_PASSWORD);
    expect(signedIn.status).toBe(200);
    return {
      memberId: created.body.data.member.id as string,
      userId: created.body.data.member.userId as string,
      username,
      accessToken: signedIn.body.data.accessToken as string,
      refreshToken: signedIn.body.data.refreshToken as string,
    };
  }

  it('the owner creates an employee: a temporary password shown once, stored only as a hash', async () => {
    const o = await owner();
    const res = await addMember(o.accessToken, o.business.id, {
      name: '  Ali <b>Raza</b> ',
      username: ' Ali.Front ',
      role: 'front_desk',
    });
    expect(res.status).toBe(201);
    const { member, temporaryPassword } = res.body.data;
    expect(temporaryPassword).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(member).toMatchObject({
      name: 'Ali Raza',
      username: 'ali.front',
      role: 'front_desk',
      status: 'active',
      accountType: 'employee',
      passwordChangePending: true,
    });

    const row = await db.user.findUniqueOrThrow({ where: { id: member.userId } });
    expect(row).toMatchObject({
      role: 'staff',
      managedByBusinessId: o.business.id,
      mustChangePassword: true,
    });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.emailHash).toBeNull();

    const audit = await db.auditLog.findFirstOrThrow({
      where: { action: 'business.member_created', resourceId: member.id },
    });
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);

    const list = await request(app).get(team(o.business.id)).set(bearer(o.accessToken));
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body.data)).not.toContain(temporaryPassword);
  });

  it('a temporary password gives no business access until it is changed; changing it signs out everywhere', async () => {
    const o = await owner();
    const created = await addMember(o.accessToken, o.business.id, {
      name: 'Sana',
      username: 'sana',
      role: 'manager',
    });
    const temp = created.body.data.temporaryPassword;
    const userId = created.body.data.member.userId;

    const first = await login(o.business.slug, 'SANA', temp);
    expect(first.status).toBe(200);
    expect(first.body.data.user).toMatchObject({
      role: 'staff',
      email: null,
      account: { type: 'employee', businessId: o.business.id, username: 'sana', mustChangePassword: true },
      onboarding: { phoneRequired: false },
    });
    expect(await businessRoleOf(db, o.business.id, userId)).toBeNull();
    // ...so the team (and everything else in the business) is out of reach.
    expect(
      (await request(app).get(team(o.business.id)).set(bearer(first.body.data.accessToken))).status,
    ).toBe(404);

    const changed = await post('/v1/auth/password')
      .set(bearer(first.body.data.accessToken))
      .send({ currentPassword: temp, newPassword: NEW_PASSWORD });
    expect(changed.body.data).toEqual({ signInAgain: true });

    const me = await request(app).get('/v1/auth/me').set(bearer(first.body.data.accessToken));
    expect(me.body.error).toMatchObject({ code: 'SESSION_REVOKED', details: { reason: 'password_changed' } });
    const refresh = await post('/v1/auth/refresh').send({ refreshToken: first.body.data.refreshToken });
    expect(refresh.body.error.details.reason).toBe('password_changed');

    expect((await login(o.business.slug, 'sana', temp)).status).toBe(401);
    // Signing straight back in works — the new token is not caught by the revocation a moment ago.
    const again = await login(o.business.slug, 'sana', NEW_PASSWORD);
    expect(again.body.data.user.account.mustChangePassword).toBe(false);
    expect((await request(app).get('/v1/auth/me').set(bearer(again.body.data.accessToken))).status).toBe(200);
    expect(await businessRoleOf(db, o.business.id, userId)).toBe('manager');
  });

  it('wrong business, wrong username and wrong password look exactly the same', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    const answers = await Promise.all([
      login('no-such-business', e.username, NEW_PASSWORD),
      login(o.business.slug, 'nobody-here', NEW_PASSWORD),
      login(o.business.slug, e.username, pw()),
    ]);
    for (const res of answers) {
      expect(res.status).toBe(401);
      expect(res.body.error).toMatchObject({
        code: 'INVALID_CREDENTIALS',
        message: 'Business, username or password is incorrect',
      });
    }
  });

  it('locks sign-in after 5 wrong passwords; a password reset by the owner unlocks it', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    for (let i = 1; i <= 4; i++) {
      expect((await login(o.business.slug, e.username, pw(`Guess${i}`))).status).toBe(401);
    }
    const fifth = await login(o.business.slug, e.username, pw('Guess5'));
    expect(fifth.status).toBe(429);
    expect(fifth.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(fifth.body.error.details.retryAfterSeconds).toBeGreaterThan(800);
    // Even the right password is not checked while locked.
    expect((await login(o.business.slug, e.username, NEW_PASSWORD)).body.error.code).toBe('ACCOUNT_LOCKED');

    const list = await request(app).get(team(o.business.id)).set(bearer(o.accessToken));
    expect(list.body.data[0].locked).toBe(true);

    const reset = await post(`${team(o.business.id)}/${e.memberId}/reset-password`).set(
      bearer(o.accessToken),
    );
    expect(reset.status).toBe(200);
    // The reset ends the employee's sessions and replaces the old password.
    const me = await request(app).get('/v1/auth/me').set(bearer(e.accessToken));
    expect(me.body.error.details.reason).toBe('password_reset');
    expect((await login(o.business.slug, e.username, NEW_PASSWORD)).status).toBe(401);
    const back = await login(o.business.slug, e.username, reset.body.data.temporaryPassword);
    expect(back.status).toBe(200);
    expect(back.body.data.user.account.mustChangePassword).toBe(true);
  });

  it('managers manage front desk and staff only; nobody changes their own access', async () => {
    const o = await owner();
    const manager = await employee(o, 'manager');
    const otherManager = await employee(o, 'manager');

    const staff = await addMember(manager.accessToken, o.business.id, {
      name: 'Bilal',
      username: 'bilal',
      role: 'staff',
    });
    expect(staff.status).toBe(201);
    const promote = await addMember(manager.accessToken, o.business.id, {
      name: 'X',
      username: 'xman',
      role: 'manager',
    });
    expect(promote.status).toBe(403);

    const path = `${team(o.business.id)}`;
    const staffId = staff.body.data.member.id;
    expect(
      (
        await request(app)
          .patch(`${path}/${staffId}`)
          .set(bearer(manager.accessToken))
          .send({ role: 'manager' })
      ).status,
    ).toBe(403);
    expect(
      (await post(`${path}/${otherManager.memberId}/reset-password`).set(bearer(manager.accessToken))).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${path}/${manager.memberId}`)
          .set(bearer(manager.accessToken))
          .send({ role: 'staff' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`${path}/${staffId}`)
          .set(bearer(manager.accessToken))
          .send({ role: 'front_desk' })
      ).body.data.role,
    ).toBe('front_desk');
  });

  it('front desk and staff cannot see the team; outsiders cannot even tell the business exists', async () => {
    const o = await owner();
    const frontDesk = await employee(o, 'front_desk');
    const outsider = await signUp();
    expect((await request(app).get(team(o.business.id)).set(bearer(frontDesk.accessToken))).status).toBe(403);
    expect((await request(app).get(team(o.business.id)).set(bearer(outsider.accessToken))).status).toBe(404);
    expect((await request(app).get(team(o.business.id))).status).toBe(401);
  });

  it('turning access off ends the employee’s sessions at once; turning it back on restores sign-in', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    const off = await request(app)
      .patch(`${team(o.business.id)}/${e.memberId}`)
      .set(bearer(o.accessToken))
      .send({ status: 'disabled' });
    expect(off.body.data.status).toBe('disabled');
    const me = await request(app).get('/v1/auth/me').set(bearer(e.accessToken));
    expect(me.body.error.details.reason).toBe('access_removed');
    expect((await post('/v1/auth/refresh').send({ refreshToken: e.refreshToken })).status).toBe(401);

    // Only someone with the right password learns that access is off.
    expect((await login(o.business.slug, e.username, pw())).body.error.code).toBe('INVALID_CREDENTIALS');
    const blocked = await login(o.business.slug, e.username, NEW_PASSWORD);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('ACCOUNT_SUSPENDED');

    await request(app)
      .patch(`${team(o.business.id)}/${e.memberId}`)
      .set(bearer(o.accessToken))
      .send({ status: 'active' });
    expect((await login(o.business.slug, e.username, NEW_PASSWORD)).status).toBe(200);
  });

  it('removing an employee closes the account and frees the username', async () => {
    const o = await owner();
    const e = await employee(o, 'staff', 'farah');
    expect(
      (
        await request(app)
          .delete(`${team(o.business.id)}/${e.memberId}`)
          .set(bearer(o.accessToken))
      ).status,
    ).toBe(204);

    // Other services are told, so they can clean up (business-service deletes the employee's photo).
    const outbox = await db.outboxEvent.findFirstOrThrow({
      where: { topic: 'businesses.member_removed', aggregateId: o.business.id },
    });
    expect(outbox.payload).toMatchObject({ data: { businessId: o.business.id, userId: e.userId } });

    expect((await login(o.business.slug, 'farah', NEW_PASSWORD)).status).toBe(401);
    expect((await request(app).get('/v1/auth/me').set(bearer(e.accessToken))).status).toBe(401);
    const row = await db.user.findFirstOrThrow({ where: { id: e.userId, deletedAt: { not: null } } });
    expect(row).toMatchObject({ username: null, passwordHash: null });

    const reused = await addMember(o.accessToken, o.business.id, {
      name: 'New Farah',
      username: 'farah',
      role: 'staff',
    });
    expect(reused.status).toBe(201);
  });

  it('team logins follow the plan: Starter 1; turned-off accounts free a place; Enterprise unlimited', async () => {
    await withBilling(db, 'business', async () => {
      const o = await owner();
      const add = (username: string) =>
        addMember(o.accessToken, o.business.id, { name: 'Emp', username, role: 'staff' });
      const first = await add('first');
      expect(first.status).toBe(201);
      const second = await add('second');
      expect([second.status, second.body.error.code, second.body.error.details]).toEqual([
        409,
        'PLAN_LIMIT_REACHED',
        { limit: 'team_accounts', max: 1, used: 1, plan: 'business_free' },
      ]);
      const path = `${team(o.business.id)}/${first.body.data.member.id}`;
      await request(app).patch(path).set(bearer(o.accessToken)).send({ status: 'disabled' });
      expect((await add('second')).status).toBe(201);
      expect(
        (await request(app).patch(path).set(bearer(o.accessToken)).send({ status: 'active' })).status,
      ).toBe(409);

      await givePlan(db, { businessId: o.business.id }, 'business_enterprise');
      expect(
        (await request(app).patch(path).set(bearer(o.accessToken)).send({ status: 'active' })).status,
      ).toBe(200);
      for (const name of ['third', 'fourth', 'fifth']) expect((await add(name)).status).toBe(201);
    });
  });

  it('usernames are unique within a business, not across businesses', async () => {
    const a = await owner();
    const b = await owner();
    expect(
      (await addMember(a.accessToken, a.business.id, { name: 'One', username: 'zain', role: 'staff' }))
        .status,
    ).toBe(201);
    const dup = await addMember(a.accessToken, a.business.id, {
      name: 'Two',
      username: 'ZAIN',
      role: 'staff',
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('USERNAME_TAKEN');
    expect(
      (await addMember(b.accessToken, b.business.id, { name: 'Three', username: 'zain', role: 'staff' }))
        .status,
    ).toBe(201);
  });

  it('refuses unknown fields, owner role, bad usernames and weak new passwords', async () => {
    const o = await owner();
    for (const body of [
      { name: 'A', username: 'abc', role: 'owner' },
      { name: 'A', username: 'ab', role: 'staff' },
      { name: 'A', username: 'a b c', role: 'staff' },
      { name: 'A', username: 'abcd', role: 'staff', passwordHash: 'x' },
    ]) {
      expect((await addMember(o.accessToken, o.business.id, body)).status).toBe(400);
    }

    const e = await employee(o, 'staff', 'hamid');
    const weak = await post('/v1/auth/password')
      .set(bearer(e.accessToken))
      .send({ currentPassword: NEW_PASSWORD, newPassword: 'password123' });
    expect(weak.status).toBe(400);
    const withName = await post('/v1/auth/password')
      .set(bearer(e.accessToken))
      .send({ currentPassword: NEW_PASSWORD, newPassword: pw('Hamid') });
    expect(withName.status).toBe(422);
    const wrongCurrent = await post('/v1/auth/password')
      .set(bearer(e.accessToken))
      .send({ currentPassword: pw(), newPassword: pw() });
    expect(wrongCurrent.status).toBe(403);
  });

  it('refuses a password seen in a data breach; if the check is down, our own rules still decide', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    const leaked = pw();
    breached.set(leaked, 52);
    try {
      const refused = await post('/v1/auth/password')
        .set(bearer(e.accessToken))
        .send({ currentPassword: NEW_PASSWORD, newPassword: leaked });
      expect([refused.status, refused.body.error.code]).toEqual([422, 'PASSWORD_BREACHED']);
      // Unreachable: allowed (the owner's choice), still checked against our own rules first.
      breachCheckDown = true;
      const weak = await post('/v1/auth/password')
        .set(bearer(e.accessToken))
        .send({ currentPassword: NEW_PASSWORD, newPassword: 'password123' });
      expect(weak.status).toBe(400);
      const allowed = await post('/v1/auth/password')
        .set(bearer(e.accessToken))
        .send({ currentPassword: NEW_PASSWORD, newPassword: leaked });
      expect(allowed.status).toBe(200);
    } finally {
      breached.clear();
      breachCheckDown = false;
    }
  });

  it('guessing the current password through "change password" locks the account too', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      statuses.push(
        (
          await post('/v1/auth/password')
            .set(bearer(e.accessToken))
            .send({ currentPassword: pw(), newPassword: pw() })
        ).status,
      );
    }
    expect(statuses).toEqual([403, 403, 403, 403, 429]);
    // Locked: even the right password is refused until the lock ends or the business resets it.
    const right = await post('/v1/auth/password')
      .set(bearer(e.accessToken))
      .send({ currentPassword: NEW_PASSWORD, newPassword: pw() });
    expect(right.status).toBe(429);
    expect((await login(o.business.slug, e.username, NEW_PASSWORD)).status).toBe(429);
  });

  it('employee accounts cannot delete themselves; Google accounts have no password to change', async () => {
    const o = await owner();
    const e = await employee(o, 'staff');
    const del = await request(app)
      .delete('/v1/auth/me')
      .set(bearer(e.accessToken))
      .send({ confirmation: 'DELETE' });
    expect(del.status).toBe(403);
    expect(del.body.error.message).toMatch(/closed by the business/);

    const change = await post('/v1/auth/password')
      .set(bearer(o.accessToken))
      .send({ currentPassword: pw(), newPassword: pw() });
    expect(change.status).toBe(409);
  });
});

describe('Profile picture (private)', () => {
  async function upload(token: string, file: Buffer, contentType = 'image/jpeg') {
    const req = await post('/v1/auth/me/avatar/uploads')
      .set(bearer(token))
      .send({ contentType, sizeBytes: file.length });
    expect(req.status).toBe(201);
    const put = await fetch(req.body.data.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });
    expect(put.status).toBe(200);
    return post(`/v1/auth/me/avatar/uploads/${req.body.data.uploadId}/complete`).set(bearer(token));
  }
  const selfie = () =>
    sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#f5b041' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExifMerge({
        IFD0: { Make: 'PhoneMaker' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '31/1 31/1 1200/100' },
      })
      .toBuffer();
  const keyOf = (url: string) => decodeURIComponent(new URL(url).pathname.split('/').slice(2).join('/'));

  it('is cleaned, stored privately, and shown only to me through a short-lived link', async () => {
    const me = await signUp();
    const done = await upload(me.accessToken, await selfie());
    expect(done.status).toBe(200);
    const url: string = done.body.data.avatarUrl;
    expect(url).toContain(`/${testEnv.s3.privateBucket}/users/${me.user.id}/avatar/`);
    expect(url).toMatch(/X-Amz-Expires=3600/);

    const picture = Buffer.from(await (await fetch(url)).arrayBuffer());
    const meta = await sharp(picture).metadata();
    expect([meta.format, meta.exif, meta.width, meta.height]).toEqual(['webp', undefined, 384, 512]);

    // Without the signature, storage refuses it: nobody can just guess the address.
    const bare = new URL(url);
    bare.search = '';
    expect((await fetch(bare)).status).toBe(403);
    // /me is the only way to it.
    expect((await request(app).get('/v1/auth/me').set(bearer(me.accessToken))).body.data.avatarUrl).toContain(
      keyOf(url),
    );
  });

  it('replacing deletes the old file; removing clears it (and the sign-in provider picture)', async () => {
    const me = await signUp();
    await db.user.update({
      where: { id: me.user.id },
      data: { avatarUrl: 'https://lh3.googleusercontent.com/a/x' },
    });
    const first = await upload(me.accessToken, await selfie());
    const second = await upload(me.accessToken, await selfie());
    expect(await storage.head(testEnv.s3.privateBucket, keyOf(first.body.data.avatarUrl))).toBeNull();

    const removed = await request(app).delete('/v1/auth/me/avatar').set(bearer(me.accessToken));
    expect(removed.body.data.avatarUrl).toBeNull();
    expect(await storage.head(testEnv.s3.privateBucket, keyOf(second.body.data.avatarUrl))).toBeNull();
  });

  it("an upload id can't be completed by someone else", async () => {
    const [a, b] = [await signUp(), await signUp()];
    const file = await selfie();
    const req = await post('/v1/auth/me/avatar/uploads')
      .set(bearer(a.accessToken))
      .send({ contentType: 'image/jpeg', sizeBytes: file.length });
    await fetch(req.body.data.upload.url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: file,
    });
    const steal = await post(`/v1/auth/me/avatar/uploads/${req.body.data.uploadId}/complete`).set(
      bearer(b.accessToken),
    );
    expect(steal.status).toBe(404);
  });

  it('is deleted for good when the account is purged', async () => {
    const me = await signUp();
    const done = await upload(me.accessToken, await selfie());
    const key = keyOf(done.body.data.avatarUrl);
    await db.user.update({
      where: { id: me.user.id },
      data: { deletedAt: new Date(Date.now() - 31 * 86_400_000) },
    });
    await rights.purgeDue();
    expect(await storage.head(testEnv.s3.privateBucket, key)).toBeNull();
    const row = await db.user.findFirstOrThrow({ where: { id: me.user.id, deletedAt: { not: null } } });
    expect(row.avatarStorageKey).toBeNull();
  });
});

/** The code an authenticator app would show, `offset` steps from now. */
const codeFor = (secret: string, offset = 0) =>
  hotp(base32Decode(secret), stepAt(Date.now()) + BigInt(offset));

describe('Access review (SOC 2)', () => {
  /** An admin: signed up, promoted in the database, then a fresh token carrying the role. */
  async function admin() {
    const s = await signUp();
    await db.user.update({ where: { id: s.user.id }, data: { role: 'super_admin' } });
    const r = await post('/v1/auth/refresh').send({ refreshToken: s.refreshToken });
    expect(r.status).toBe(200);
    // Admin tools need two-step sign-in (D-081).
    const token = r.body.data.accessToken as string;
    const setup = await request(app).post('/v1/auth/mfa/setup').set(bearer(token));
    const confirm = await request(app)
      .post('/v1/auth/mfa/confirm')
      .set(bearer(token))
      .send({ code: codeFor(setup.body.data.secret) });
    return { ...s, accessToken: confirm.body.data.session.accessToken as string };
  }

  it('lists platform admins with their last activity, flags dormant ones, and is itself audited', async () => {
    const me = await admin();
    const idle = await admin();
    // Idle for 100 days: no sign-in, no session use.
    await db.user.update({
      where: { id: idle.user.id },
      data: { lastLoginAt: new Date(Date.now() - 100 * 86_400_000) },
    });
    await db.refreshToken.updateMany({
      where: { userId: idle.user.id },
      data: {
        lastUsedAt: new Date(Date.now() - 100 * 86_400_000),
        createdAt: new Date(Date.now() - 100 * 86_400_000),
      },
    });

    const res = await request(app).get('/v1/admin/access-review').set(bearer(me.accessToken));
    expect(res.status).toBe(200);
    const byId = new Map(
      res.body.data.platformAdmins.map((a: { id: string; dormant: boolean; email: string }) => [a.id, a]),
    );
    expect(byId.get(me.user.id)).toMatchObject({ dormant: false, email: me.user.email });
    expect(byId.get(idle.user.id)).toMatchObject({ dormant: true });
    expect(res.body.data.businessAccess).toHaveProperty('owners');
    expect(
      await db.auditLog.count({ where: { userId: me.user.id, action: 'access_review.generated' } }),
    ).toBe(1);
  });

  it('customers can’t see it', async () => {
    const customer = await signUp();
    const res = await request(app).get('/v1/admin/access-review').set(bearer(customer.accessToken));
    expect(res.status).toBe(403);
  });
});

describe('Two-step sign-in (D-081)', () => {
  const claimsOf = (token: string) =>
    JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as { mfa?: boolean; role: string };

  /** Signs up (Google) and turns MFA on; returns the secret and recovery codes. */
  async function withMfa(sub = randomUUID()) {
    const s = await signUp({ idToken: await googleIdToken({ sub }) });
    const setup = await request(app).post('/v1/auth/mfa/setup').set(bearer(s.accessToken));
    expect(setup.status).toBe(200);
    const secret = setup.body.data.secret as string;
    expect(setup.body.data.otpauthUri).toMatch(/^otpauth:\/\/totp\/BUKU%3A/);
    const confirm = await request(app)
      .post('/v1/auth/mfa/confirm')
      .set(bearer(s.accessToken))
      .send({ code: codeFor(secret) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.recoveryCodes).toHaveLength(10);
    // The session that set it up now counts as having passed it.
    expect(claimsOf(confirm.body.data.session.accessToken).mfa).toBe(true);
    return { ...s, sub, secret, recoveryCodes: confirm.body.data.recoveryCodes as string[] };
  }
  const signInAgain = async (sub: string) =>
    post('/v1/auth/oauth/google').send({
      idToken: await googleIdToken({ sub }),
      acceptedTermsVersion: TERMS,
    });

  it('signing in asks for a code first — nothing about the account until then; a code works once', async () => {
    const me = await withMfa();
    const first = await signInAgain(me.sub);
    expect(first.status).toBe(200);
    expect(Object.keys(first.body.data).sort()).toEqual(['expiresAt', 'mfaRequired', 'mfaToken']);

    const wrong = await post('/v1/auth/mfa/verify').send({
      mfaToken: first.body.data.mfaToken,
      code: '000000',
    });
    expect([wrong.status, wrong.body.error.code]).toEqual([401, 'MFA_INVALID_CODE']);

    const code = codeFor(me.secret, 1); // a step after the one used to confirm
    const ok = await post('/v1/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.id).toBe(me.user.id);
    expect(claimsOf(ok.body.data.accessToken).mfa).toBe(true);
    // The challenge can't be used twice, and the same code can't open another sign-in.
    expect(
      (await post('/v1/auth/mfa/verify').send({ mfaToken: first.body.data.mfaToken, code })).status,
    ).toBe(401);
    const second = await signInAgain(me.sub);
    const replay = await post('/v1/auth/mfa/verify').send({ mfaToken: second.body.data.mfaToken, code });
    expect(replay.body.error.code).toBe('MFA_INVALID_CODE');

    // Staying signed in keeps the second factor.
    const refreshed = await post('/v1/auth/refresh').send({ refreshToken: ok.body.data.refreshToken });
    expect(claimsOf(refreshed.body.data.accessToken).mfa).toBe(true);
  });

  it('a recovery code works once; five wrong codes lock it for a while', async () => {
    const me = await withMfa();
    const challenge = async () => (await signInAgain(me.sub)).body.data.mfaToken as string;
    const recovery = me.recoveryCodes[0]!.toLowerCase(); // any case, with or without the dash
    expect(
      (await post('/v1/auth/mfa/verify').send({ mfaToken: await challenge(), recoveryCode: recovery }))
        .status,
    ).toBe(200);
    expect(
      (await post('/v1/auth/mfa/verify').send({ mfaToken: await challenge(), recoveryCode: recovery }))
        .status,
    ).toBe(401);
    const status = await request(app)
      .get('/v1/auth/mfa')
      .set(
        bearer(
          (
            await post('/v1/auth/mfa/verify').send({
              mfaToken: await challenge(),
              recoveryCode: me.recoveryCodes[1],
            })
          ).body.data.accessToken,
        ),
      );
    expect(status.body.data).toMatchObject({ enabled: true, recoveryCodesLeft: 8, required: false });

    const token = await challenge();
    for (let i = 0; i < 5; i++) await post('/v1/auth/mfa/verify').send({ mfaToken: token, code: '111111' });
    const locked = await post('/v1/auth/mfa/verify').send({ mfaToken: token, code: codeFor(me.secret, 1) });
    expect([locked.status, locked.body.error.code]).toEqual([429, 'MFA_LOCKED']);
    expect(
      await db.auditLog.count({ where: { userId: me.user.id, action: 'auth.mfa_failed' } }),
    ).toBeGreaterThanOrEqual(5);
  });

  it('platform admins: admin tools refuse a session without it; with it they work; they can’t switch it off', async () => {
    const s = await signUp();
    await db.user.update({ where: { id: s.user.id }, data: { role: 'super_admin' } });
    const adminToken = (await post('/v1/auth/refresh').send({ refreshToken: s.refreshToken })).body.data
      .accessToken;
    const denied = await request(app).get('/v1/admin/access-review').set(bearer(adminToken));
    expect([denied.status, denied.body.error.code]).toEqual([403, 'MFA_REQUIRED']);
    expect((await request(app).get('/v1/auth/mfa').set(bearer(adminToken))).body.data.required).toBe(true);

    const setup = await request(app).post('/v1/auth/mfa/setup').set(bearer(adminToken));
    const confirm = await request(app)
      .post('/v1/auth/mfa/confirm')
      .set(bearer(adminToken))
      .send({ code: codeFor(setup.body.data.secret) });
    const upgraded = confirm.body.data.session.accessToken as string;
    const review = await request(app).get('/v1/admin/access-review').set(bearer(upgraded));
    expect(review.status).toBe(200);
    expect(review.body.data.platformAdmins.find((a: { id: string }) => a.id === s.user.id)).toMatchObject({
      mfa: true,
    });

    const off = await request(app)
      .delete('/v1/auth/mfa')
      .set(bearer(upgraded))
      .send({ code: codeFor(setup.body.data.secret, 1) });
    expect(off.status).toBe(403);
  });

  it('a customer can switch it off with a code (audited); signing in is one step again', async () => {
    const me = await withMfa();
    const res = await request(app)
      .delete('/v1/auth/mfa')
      .set(bearer(me.accessToken))
      .send({ code: codeFor(me.secret, 1) });
    expect(res.status).toBe(204);
    const again = await signInAgain(me.sub);
    expect(again.body.data.accessToken).toBeTruthy();
    expect(
      await db.auditLog.count({
        where: { userId: me.user.id, action: { in: ['mfa.enabled', 'mfa.disabled'] } },
      }),
    ).toBe(2);
    const secret = await db.userMfa.findUnique({ where: { userId: me.user.id } });
    expect(secret).toBeNull();
  });

  it('lost the phone: a recovery code gets new codes or turns it off, and works only once', async () => {
    const me = await withMfa();
    const renewed = await request(app)
      .post('/v1/auth/mfa/recovery-codes')
      .set(bearer(me.accessToken))
      .send({ recoveryCode: me.recoveryCodes[0] });
    expect(renewed.status).toBe(200);
    const fresh = renewed.body.data.recoveryCodes as string[];
    expect(fresh).toHaveLength(10);
    // The old codes are gone, the one just used included.
    const old = await request(app)
      .delete('/v1/auth/mfa')
      .set(bearer(me.accessToken))
      .send({ recoveryCode: me.recoveryCodes[1] });
    expect([old.status, old.body.error.code]).toEqual([401, 'MFA_INVALID_CODE']);
    // Exactly one of the two: a code or a recovery code.
    const both = await request(app)
      .delete('/v1/auth/mfa')
      .set(bearer(me.accessToken))
      .send({ code: codeFor(me.secret, 1), recoveryCode: fresh[0] });
    expect(both.status).toBe(400);

    const off = await request(app)
      .delete('/v1/auth/mfa')
      .set(bearer(me.accessToken))
      .send({ recoveryCode: fresh[0] });
    expect(off.status).toBe(204);
    expect(await db.userMfa.findUnique({ where: { userId: me.user.id } })).toBeNull();
    // Then a new phone can be set up.
    expect((await request(app).post('/v1/auth/mfa/setup').set(bearer(me.accessToken))).status).toBe(200);
  });
});
