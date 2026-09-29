import { createHmac } from 'node:crypto';

/**
 * Blind index: a keyed, deterministic hash of a normalized value.
 *
 * Encrypted columns use random IVs, so the same email encrypts differently
 * every time and cannot be looked up or made UNIQUE. We store an HMAC of the
 * normalized value alongside the ciphertext and put the UNIQUE index on that:
 *
 *   email_encrypted = encrypt("alice@example.com")        -- readable with key
 *   email_hash      = HMAC(key, "users.email\0alice@...") -- lookups + uniqueness
 *
 * Because it is KEYED (HMAC, not plain SHA-256), someone with only the
 * database cannot confirm "is bob@example.com a user?" by hashing guesses.
 * The context string domain-separates indexes so equal values in different
 * columns produce unrelated hashes.
 */
export interface BlindIndexer {
  hash(context: string, normalizedValue: string): string;
}

export function createBlindIndexer(key: Buffer): BlindIndexer {
  if (key.length < 32) throw new Error('Blind index key must be at least 32 bytes');
  return {
    hash(context, normalizedValue) {
      return createHmac('sha256', key).update(context).update('\0').update(normalizedValue).digest('hex');
    },
  };
}

/** Canonical form used before hashing or comparing emails. */
export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}

/** Canonical form of an E.164 phone number (strip formatting characters). */
export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[\s().-]/g, '');
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}
