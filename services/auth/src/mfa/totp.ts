import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticator-app codes (TOTP, RFC 6238 over HOTP, RFC 4226): HMAC-SHA1,
 * 6 digits, 30-second steps — what Google Authenticator, Microsoft
 * Authenticator, 1Password and the rest expect. No dependency: it's a few
 * lines of standard crypto, tested against the RFC's own vectors.
 */

export const STEP_SECONDS = 30;
const DIGITS = 6;
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret (RFC 4226 recommends ≥ 128). */
export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: bigint, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(counter);
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return String(bin).padStart(digits, '0');
}

export const stepAt = (ms: number) => BigInt(Math.floor(ms / 1000 / STEP_SECONDS));

/**
 * The step a code is valid for — now, or one step either side (clocks drift)
 * — or null. Compared in constant time.
 */
export function matchingStep(secretBase32: string, code: string, nowMs = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const secret = base32Decode(secretBase32);
  const now = stepAt(nowMs);
  for (const step of [now, now - 1n, now + 1n]) {
    const expected = Buffer.from(hotp(secret, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
}

/** otpauth:// link for the QR code the app scans. */
export function otpauthUri(secretBase32: string, account: string, issuer = 'BUKU'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}

/** Ten single-use recovery codes like "K7QX-2M9P" (40 bits each, no look-alike characters). */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(8);
    const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}`;
  });
}

export const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
