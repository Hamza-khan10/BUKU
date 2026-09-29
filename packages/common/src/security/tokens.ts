import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Random secrets and how to store them.
 *
 * Rule of thumb used across BUKU:
 *  - HIGH-entropy secrets we generate (refresh tokens, reset links, invite
 *    tokens: 256 random bits) → store SHA-256(token). Brute force is
 *    impossible at 2^256, and a deterministic hash allows an indexed lookup.
 *  - LOW-entropy secrets (6-digit OTPs) → keyed hash (see blind-index) plus
 *    attempt limits + short TTL, because 10^6 guesses is nothing offline.
 *  - Passwords → Argon2id (see password.ts). Never SHA-256.
 */

/** 256-bit URL-safe random token, e.g. for refresh tokens and email links. */
export function generateSecureToken(bytes = 32): string {
  if (bytes < 16) throw new Error('Tokens must have at least 128 bits of entropy');
  return randomBytes(bytes).toString('base64url');
}

/** Storage/lookup hash for a high-entropy token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Uniformly random numeric one-time password (no modulo bias). */
export function generateOtp(digits = 6): string {
  if (digits < 6 || digits > 10) throw new Error('OTP length must be between 6 and 10 digits');
  return randomInt(0, 10 ** digits)
    .toString()
    .padStart(digits, '0');
}

// No 0/O, 1/I/L: codes are read aloud at front desks and typed by hand.
const CONFIRMATION_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Human-friendly booking reference: "BK-" + 6 chars from a 31-symbol alphabet
 * (~887M combinations). Uniqueness is enforced by a DB UNIQUE constraint and
 * the caller retries on collision.
 */
export function generateConfirmationCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CONFIRMATION_ALPHABET[randomInt(CONFIRMATION_ALPHABET.length)];
  return `BK-${code}`;
}

export const CONFIRMATION_CODE_PATTERN = /^BK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/**
 * Constant-time string comparison. Hashing both sides first makes the inputs
 * equal-length, so neither content nor length leaks through timing.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}
