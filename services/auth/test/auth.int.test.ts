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
import { createDatabaseClient, type Database } from '@buku/database';
import type { Express } from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildAuthApp } from '../src/app.js';
import { createOidcVerifierWithKeys } from '../src/identity/oidc.js';

/**
 * auth-service against the real test database and Valkey. A locally
 * generated key pair plays the role of Google's signing keys, so we can mint
 * valid, forged, expired and wrong-audience ID tokens at will.
 */
const GOOGLE_CLIENT_ID = 'buku-test.apps.googleusercontent.com';
const TERMS = '1.0';

let app: Express;
let db: Database;
let redis: Redis;
let googleKey: CryptoKey;
let foreignKey: CryptoKey;
let cipher: FieldCipher;
let indexer: BlindIndexer;

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
  app = buildAuthApp({
    db,
    redis,
    signer,
    verifier,
    cipher,
    indexer,
    revocations: createRevocationStore(redis),
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
    },
    http: {
      service: 'auth-test',
      logger: createLogger({ service: 'auth-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  });
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
});

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
