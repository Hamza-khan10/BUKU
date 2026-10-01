import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { SignJWT, importPKCS8 } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  CONFIRMATION_CODE_PATTERN,
  createBlindIndexer,
  createFieldCipher,
  createJwtSigner,
  createJwtVerifier,
  createRevocationStore,
  DecryptionError,
  generateConfirmationCode,
  generateOtp,
  generateSecureToken,
  hashPassword,
  hashToken,
  issuedAtMs,
  needsRehash,
  normalizeEmail,
  normalizePhone,
  parseKeyring,
  safeEqual,
  signWebhookPayload,
  uuidv7,
  verifyPassword,
  verifyWebhookSignature,
} from '../src/index.js';
import type { Redis } from 'ioredis';

const key = () => randomBytes(32).toString('base64');

describe('field encryption (AES-256-GCM)', () => {
  const keyring = parseKeyring(`k1:${key()},k2:${key()}`, 'k2');
  const cipher = createFieldCipher(keyring);

  it('round-trips and never produces the same ciphertext twice', () => {
    const a = cipher.encrypt('alice@example.com', 'users.email');
    const b = cipher.encrypt('alice@example.com', 'users.email');
    expect(a).not.toBe(b);
    expect(a.startsWith('enc:1:k2:')).toBe(true);
    expect(cipher.decrypt(a, 'users.email')).toBe('alice@example.com');
  });

  it('rejects a ciphertext moved to a different column (AAD binding)', () => {
    const ct = cipher.encrypt('+923001234567', 'users.phone');
    expect(() => cipher.decrypt(ct, 'users.email')).toThrow(DecryptionError);
  });

  it('rejects any tampering', () => {
    const ct = cipher.encrypt('secret', 'ctx');
    const parts = ct.split(':');
    const body = Buffer.from(parts[4]!, 'base64url');
    body[0]! ^= 0x01;
    parts[4] = body.toString('base64url');
    expect(() => cipher.decrypt(parts.join(':'), 'ctx')).toThrow(DecryptionError);
  });

  it('supports key rotation: old keys still decrypt, and are flagged for re-encryption', () => {
    const oldCipher = createFieldCipher({ ...keyring, activeKeyId: 'k1' });
    const legacy = oldCipher.encrypt('hello', 'ctx');
    expect(cipher.decrypt(legacy, 'ctx')).toBe('hello');
    expect(cipher.needsReEncryption(legacy)).toBe(true);
    expect(cipher.needsReEncryption(cipher.encrypt('hello', 'ctx'))).toBe(false);
  });

  it('refuses unknown keys and malformed input', () => {
    const other = createFieldCipher(parseKeyring(`zz:${key()}`, 'zz'));
    expect(() => cipher.decrypt(other.encrypt('x', 'ctx'), 'ctx')).toThrow(/Unknown key id/);
    expect(() => cipher.decrypt('not-a-ciphertext', 'ctx')).toThrow(DecryptionError);
  });

  it('validates keyring configuration', () => {
    expect(() => parseKeyring(`k1:${randomBytes(16).toString('base64')}`, 'k1')).toThrow(/32 bytes/);
    expect(() => parseKeyring(`k1:${key()}`, 'k9')).toThrow(/not in the keyring/);
    expect(() => parseKeyring(`k1:${key()},k1:${key()}`, 'k1')).toThrow(/Duplicate/);
  });
});

describe('blind index', () => {
  const indexer = createBlindIndexer(randomBytes(32));

  it('is deterministic for equal normalized values', () => {
    const a = indexer.hash('users.email', normalizeEmail('  Alice@Example.COM '));
    const b = indexer.hash('users.email', normalizeEmail('alice@example.com'));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('domain-separates contexts and depends on the key', () => {
    const v = 'alice@example.com';
    expect(indexer.hash('users.email', v)).not.toBe(indexer.hash('staff.invite_email', v));
    expect(indexer.hash('users.email', v)).not.toBe(
      createBlindIndexer(randomBytes(32)).hash('users.email', v),
    );
  });

  it('normalizes phone formatting', () => {
    expect(normalizePhone('+92 (300) 123-4567')).toBe('+923001234567');
  });

  it('refuses weak keys', () => {
    expect(() => createBlindIndexer(randomBytes(16))).toThrow();
  });
});

describe('tokens', () => {
  it('generates 256-bit url-safe tokens and stable SHA-256 lookup hashes', () => {
    const t = generateSecureToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).not.toBe(hashToken(generateSecureToken()));
  });

  it('generates zero-padded numeric OTPs', () => {
    for (let i = 0; i < 200; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(() => generateOtp(4)).toThrow();
  });

  it('generates confirmation codes without ambiguous characters', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateConfirmationCode));
    for (const c of codes) expect(c).toMatch(CONFIRMATION_CODE_PATTERN);
    expect(codes.size).toBeGreaterThan(1990);
  });

  it('compares in constant time with correct results', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('password hashing (Argon2id)', () => {
  it('hashes in PHC format and verifies', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same-password-1')).not.toBe(await hashPassword('same-password-1'));
  });

  it('flags weaker parameters for rehash and rejects garbage', async () => {
    const weak = await hashPassword('pw-under-old-params', { memoryKiB: 8192, passes: 1, parallelism: 1 });
    expect(needsRehash(weak)).toBe(true);
    expect(await verifyPassword('pw-under-old-params', weak)).toBe(true);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x'.repeat(5000), weak)).toBe(false);
  });
});

describe('JWT (RS256)', () => {
  const pair = () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return {
      privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    };
  };
  const main = pair();
  const settings = { issuer: 'https://auth.buku.test', audience: 'buku-api' };

  const setup = async (ttlSeconds?: number) => ({
    signer: await createJwtSigner({ ...settings, privateKeyPem: main.privatePem, keyId: 'k1', ttlSeconds }),
    verifier: await createJwtVerifier({ ...settings, keys: [{ keyId: 'k1', publicKeyPem: main.publicPem }] }),
  });

  it('signs and verifies with the expected claims', async () => {
    const { signer, verifier } = await setup();
    const { token, jti } = await signer.sign({ sub: 'user-1', role: 'business_owner', sid: 'sess-1' });
    const claims = await verifier.verify(token);
    expect(claims).toMatchObject({ sub: 'user-1', role: 'business_owner', sid: 'sess-1', jti });
    expect(claims.exp - claims.iat).toBe(900);
  });

  it('rejects expired tokens with TOKEN_EXPIRED', async () => {
    const { signer, verifier } = await setup(-60);
    const { token } = await signer.sign({ sub: 'u', role: 'user' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED', httpStatus: 401 });
  });

  it('rejects a tampered payload', async () => {
    const { signer, verifier } = await setup();
    const { token } = await signer.sign({ sub: 'u', role: 'user' });
    const [h, p, s] = token.split('.');
    const payload = JSON.parse(Buffer.from(p!, 'base64url').toString());
    payload.role = 'super_admin';
    const forged = `${h}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${s}`;
    await expect(verifier.verify(forged)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('rejects alg=none and HS256 key-confusion attacks', async () => {
    const { verifier } = await setup();
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({
        sub: 'u',
        role: 'super_admin',
        jti: 'x',
        iat: 1,
        exp: 9e9,
        iss: settings.issuer,
        aud: settings.audience,
      }),
    ).toString('base64url');
    await expect(verifier.verify(`${header}.${body}.`)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });

    const hs = await new SignJWT({ role: 'super_admin' })
      .setProtectedHeader({ alg: 'HS256', kid: 'k1' })
      .setSubject('u')
      .setJti('x')
      .setIssuedAt()
      .setIssuer(settings.issuer)
      .setAudience(settings.audience)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(main.publicPem));
    await expect(verifier.verify(hs)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('rejects tokens from another issuer, audience, or unknown signing key', async () => {
    const { verifier } = await setup();
    const other = pair();
    const foreignSigner = await createJwtSigner({
      ...settings,
      privateKeyPem: other.privatePem,
      keyId: 'k1',
    });
    await expect(
      verifier.verify((await foreignSigner.sign({ sub: 'u', role: 'user' })).token),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });

    const wrongAud = await createJwtSigner({
      ...settings,
      audience: 'other',
      privateKeyPem: main.privatePem,
      keyId: 'k1',
    });
    await expect(
      verifier.verify((await wrongAud.sign({ sub: 'u', role: 'user' })).token),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });

    const unknownKid = await createJwtSigner({ ...settings, privateKeyPem: main.privatePem, keyId: 'k9' });
    await expect(
      verifier.verify((await unknownKid.sign({ sub: 'u', role: 'user' })).token),
    ).rejects.toMatchObject({
      code: 'TOKEN_INVALID',
    });
  });

  it('rejects unknown roles even if correctly signed', async () => {
    const { verifier } = await setup();
    const k = await importPKCS8(main.privatePem, 'RS256');
    const token = await new SignJWT({ role: 'god' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setSubject('u')
      .setJti('x')
      .setIssuedAt()
      .setIssuer(settings.issuer)
      .setAudience(settings.audience)
      .setExpirationTime('5m')
      .sign(k);
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'TOKEN_INVALID' });
  });

  it('verifies tokens from a previous key during rotation', async () => {
    const next = pair();
    const oldSigner = await createJwtSigner({ ...settings, privateKeyPem: main.privatePem, keyId: 'k1' });
    const rotatedVerifier = await createJwtVerifier({
      ...settings,
      keys: [
        { keyId: 'k2', publicKeyPem: next.publicPem },
        { keyId: 'k1', publicKeyPem: main.publicPem },
      ],
    });
    const { token } = await oldSigner.sign({ sub: 'u', role: 'user' });
    await expect(rotatedVerifier.verify(token)).resolves.toMatchObject({ sub: 'u' });
  });
});

describe('webhook signatures', () => {
  const secret = 'whsec_test_secret_value';
  const body = JSON.stringify({ event: 'booking.created', id: 'evt_1' });

  it('accepts a fresh, untampered signature', () => {
    expect(verifyWebhookSignature(secret, body, signWebhookPayload(secret, body))).toEqual({ valid: true });
  });

  it('rejects tampered bodies and wrong secrets', () => {
    const sig = signWebhookPayload(secret, body);
    expect(verifyWebhookSignature(secret, body.replace('evt_1', 'evt_2'), sig)).toMatchObject({
      reason: 'mismatch',
    });
    expect(verifyWebhookSignature('other-secret', body, sig)).toMatchObject({ reason: 'mismatch' });
  });

  it('rejects replays outside the tolerance window', () => {
    const old = Math.floor(Date.now() / 1000) - 3600;
    expect(verifyWebhookSignature(secret, body, signWebhookPayload(secret, body, old))).toMatchObject({
      reason: 'expired',
    });
  });

  it('rejects malformed headers', () => {
    for (const h of [undefined, '', 'sha256=abc', 't=abc,v1=zz', 't=1']) {
      expect(verifyWebhookSignature(secret, body, h)).toMatchObject({ valid: false, reason: 'malformed' });
    }
  });
});

describe('access-token revocation', () => {
  /** Just enough of Valkey for the store: SET with expiry and MGET. */
  function fakeRedis() {
    const data = new Map<string, string>();
    return {
      set: (k: string, v: string) => (data.set(k, v), Promise.resolve('OK')),
      mget: (...keys: string[]) => Promise.resolve(keys.map((k) => data.get(k) ?? null)),
    } as unknown as Redis;
  }
  const tokenAt = (ms: number) => ({
    sub: 'u1',
    role: 'user' as const,
    jti: uuidv7(ms),
    iat: Math.floor(ms / 1000),
    exp: Math.floor(ms / 1000) + 900,
  });

  it('"sign out everywhere" kills earlier tokens but not one issued a moment later in the same second', async () => {
    const store = createRevocationStore(fakeRedis());
    const before = tokenAt(Date.now() - 1);
    await store.revokeAllForUser('u1', 'password_changed');
    const after = tokenAt(Date.now() + 1);
    expect(await store.isRevoked(before)).toBe('password_changed');
    expect(await store.isRevoked(after)).toBe(false);
  });

  it('treats tokens without a matching UUIDv7 id as issued at the end of their second (safe side)', () => {
    const iat = 1_800_000_000;
    expect(issuedAtMs({ jti: '6f1c0e4e-8a3b-4c2d-9e1f-0a1b2c3d4e5f', iat })).toBe(iat * 1000 + 999);
    // A v7 id from another second does not get to claim an earlier time.
    expect(issuedAtMs({ jti: uuidv7((iat - 5) * 1000), iat })).toBe(iat * 1000 + 999);
    expect(issuedAtMs({ jti: uuidv7(iat * 1000 + 250), iat })).toBe(iat * 1000 + 250);
  });

  it('still honours markers written in the old whole-second format', async () => {
    const redis = fakeRedis();
    const nowSec = Math.floor(Date.now() / 1000);
    await redis.set('auth:rev:user:u1', JSON.stringify({ before: nowSec, reason: 'logged_out_everywhere' }));
    const store = createRevocationStore(redis);
    expect(await store.isRevoked(tokenAt(nowSec * 1000 + 500))).toBe('logged_out_everywhere');
    expect(await store.isRevoked(tokenAt((nowSec + 1) * 1000))).toBe(false);
  });
});
