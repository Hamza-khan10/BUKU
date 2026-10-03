import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  baseServiceEnv,
  ConfigError,
  envPem,
  errorResponse,
  loadConfig,
  sanitizeText,
  toSkipTake,
  zPagination,
  zPassword,
  zPhone,
  zSafeText,
  zTimezone,
} from '../src/index.js';

describe('loadConfig', () => {
  const schema = baseServiceEnv.extend({ API_SECRET: z.string().min(16) });

  it('parses and applies defaults', () => {
    const cfg = loadConfig(schema, { SERVICE_NAME: 'svc', PORT: '3001', API_SECRET: 'a'.repeat(20) });
    expect(cfg).toMatchObject({
      PORT: 3001,
      NODE_ENV: 'development',
      TRUST_PROXY_HOPS: 1,
      LOG_PRETTY: false,
    });
  });

  it('lists every problem without echoing secret values', () => {
    try {
      loadConfig(schema, { PORT: 'abc', API_SECRET: 'short-secret' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/SERVICE_NAME/);
      expect(msg).toMatch(/PORT/);
      expect(msg).toMatch(/API_SECRET/);
      expect(msg).not.toContain('short-secret');
    }
  });

  it('refuses development placeholders in production', () => {
    const env = {
      NODE_ENV: 'production',
      SERVICE_NAME: 'svc',
      PORT: '1',
      API_SECRET: 'dev_mock_secret_value',
    };
    expect(() => loadConfig(schema, env)).toThrow(/API_SECRET: contains a development placeholder/);
    expect(() => loadConfig(schema, { ...env, NODE_ENV: 'development' })).not.toThrow();
  });

  it('decodes base64 PEM keys and rejects the wrong key type', () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const s = z.object({ K: envPem('PUBLIC KEY') });
    expect(s.parse({ K: Buffer.from(pem).toString('base64') }).K).toBe(pem);
    expect(s.safeParse({ K: Buffer.from('nope').toString('base64') }).success).toBe(false);
    expect(z.object({ K: envPem('PRIVATE KEY') }).safeParse({ K: pem }).success).toBe(false);
  });
});

describe('validation primitives', () => {
  it('strips HTML/scripts and control characters from free text', () => {
    expect(sanitizeText('<script>alert(1)</script>Hello <b>world</b>\u0000')).toBe('Hello world');
    expect(sanitizeText('<img src=x onerror=alert(1)>Nice cut')).toBe('Nice cut');
  });

  it('keeps plain text exactly as typed (no HTML escaping stored)', () => {
    expect(sanitizeText('Salt & Pepper')).toBe('Salt & Pepper');
    expect(sanitizeText('Fades & beards, 5 < 10 > 2, "best" cut')).toBe(
      'Fades & beards, 5 < 10 > 2, "best" cut',
    );
    expect(sanitizeText("Ali's & Sons")).toBe("Ali's & Sons");
  });

  it('removes tags hidden as entities, even when encoded twice', () => {
    expect(sanitizeText('&lt;script&gt;alert(1)&lt;/script&gt;Hi')).toBe('Hi');
    expect(sanitizeText('&amp;lt;img src=x onerror=alert(1)&amp;gt;Hi')).toBe('Hi');
    expect(sanitizeText('Hi <b onclick="x()">there</b>')).toBe('Hi there');
  });

  it('is idempotent: cleaning a cleaned value changes nothing', () => {
    for (const s of ['Salt & Pepper', 'a < b', '&lt;b&gt;x', 'plain']) {
      expect(sanitizeText(sanitizeText(s))).toBe(sanitizeText(s));
    }
    const s = zSafeText({ kind: 'line', max: 5 });
    expect(s.safeParse('<p>abc</p>').success).toBe(true);
    expect(s.safeParse('<p>abcdef</p>').success).toBe(false);
  });

  it('applies the clean-text rules for each kind after stripping HTML', () => {
    const name = zSafeText({ kind: 'personName', min: 1, max: 50 });
    expect(name.parse('  <b>Ayesha</b>   Khan ')).toBe('Ayesha Khan');
    expect(name.safeParse('Ayesha 2').success).toBe(false);
    const emoji = name.safeParse('Ayesha \u{1F600}');
    expect(emoji.error?.issues[0]?.message).toBe('Emojis and picture symbols can\u2019t be used here.');

    const title = zSafeText({ kind: 'title', min: 2, max: 50 });
    expect(title.parse('Salt & Pepper (DHA) #2')).toBe('Salt & Pepper (DHA) #2');
    expect(title.safeParse('Shop\u202Egnp').success).toBe(false); // right-to-left override

    const review = zSafeText({ kind: 'text', max: 100 });
    expect(review.parse('Great cut.\n\n\n\nWill return')).toBe('Great cut.\n\nWill return');
    expect(review.safeParse('Great \u2B50').success).toBe(false);
  });

  it('strip mode removes what is not allowed instead of refusing it', () => {
    const device = zSafeText({ kind: 'line', max: 50, strip: true });
    expect(device.parse("Ali's iPhone \u{1F4F1}")).toBe("Ali's iPhone");
  });

  it('accepts only E.164 phone numbers', () => {
    expect(zPhone.safeParse('+923001234567').success).toBe(true);
    for (const bad of ['03001234567', '+0123456789', '+92 300 1234567', '+1234']) {
      expect(zPhone.safeParse(bad).success).toBe(false);
    }
  });

  it('validates IANA timezones', () => {
    expect(zTimezone.safeParse('Asia/Karachi').success).toBe(true);
    expect(zTimezone.safeParse('Mars/Olympus').success).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(zPassword.safeParse('a-long-unique-passphrase').success).toBe(true);
    expect(zPassword.safeParse('short').success).toBe(false);
    expect(zPassword.safeParse('password123').success).toBe(false);
    expect(zPassword.safeParse('aaaaaaaaaaaa').success).toBe(false);
    expect(zPassword.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('bounds pagination', () => {
    expect(zPagination.parse({})).toEqual({ page: 1, limit: 20 });
    expect(zPagination.safeParse({ limit: '1000' }).success).toBe(false);
    expect(toSkipTake(zPagination.parse({ page: '3', limit: '10' }))).toEqual({ skip: 20, take: 10 });
  });
});

describe('error envelope', () => {
  it('serializes code, message, details and request id', () => {
    const body = errorResponse(AppError.conflict('Taken', 'SLOT_UNAVAILABLE', { slot: 'x' }), 'req-1');
    expect(body).toEqual({
      success: false,
      error: { code: 'SLOT_UNAVAILABLE', message: 'Taken', details: { slot: 'x' }, requestId: 'req-1' },
    });
  });
});

describe('country codes', () => {
  it('accepts real ISO codes (any case) and rejects user-assigned or made-up ones', async () => {
    const { zCountryCode, ISO_COUNTRY_CODES } = await import('../src/index.js');
    expect(ISO_COUNTRY_CODES.size).toBe(249);
    expect(zCountryCode.parse('pk')).toBe('PK');
    for (const bad of ['ZZ', 'XA', 'QM', 'Pakistan', 'P', 'PAK'])
      expect(zCountryCode.safeParse(bad).success).toBe(false);
  });
});
