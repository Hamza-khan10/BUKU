import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';

/**
 * Password hashing with Argon2id (OWASP's first recommendation), using the
 * implementation built into Node.js 24 — no native addon to build or audit.
 *
 * Stored in the standard PHC string format, so parameters travel with each
 * hash and can be raised later without breaking existing logins:
 *
 *   $argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>
 *
 * After a successful login, call `needsRehash(stored)`; if true, re-hash the
 * plaintext the user just sent and save it. That is how parameter upgrades
 * roll out.
 */

export interface Argon2Params {
  /** Memory in KiB. */
  memoryKiB: number;
  /** Iterations (time cost). */
  passes: number;
  parallelism: number;
}

/** OWASP Password Storage Cheat Sheet baseline: m=19 MiB, t=2, p=1 (~30 ms). */
export const DEFAULT_ARGON2_PARAMS: Argon2Params = { memoryKiB: 19_456, passes: 2, parallelism: 1 };

const SALT_BYTES = 16;
const HASH_BYTES = 32;
const MAX_PASSWORD_BYTES = 1024; // hashing is deliberately expensive; cap input size

function derive(
  password: string,
  salt: Buffer,
  params: Argon2Params,
  tagLength = HASH_BYTES,
): Promise<Buffer> {
  const options: Argon2Parameters = {
    message: Buffer.from(password, 'utf8'),
    nonce: salt,
    parallelism: params.parallelism,
    tagLength,
    memory: params.memoryKiB,
    passes: params.passes,
  };
  return new Promise((resolve, reject) => {
    argon2('argon2id', options, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const b64 = (buf: Buffer) => buf.toString('base64').replace(/=+$/, '');

export async function hashPassword(
  password: string,
  params: Argon2Params = DEFAULT_ARGON2_PARAMS,
): Promise<string> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) throw new Error('Password too long');
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, params);
  return `$argon2id$v=19$m=${params.memoryKiB},t=${params.passes},p=${params.parallelism}$${b64(salt)}$${b64(hash)}`;
}

interface ParsedHash {
  params: Argon2Params;
  salt: Buffer;
  hash: Buffer;
}

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

function parse(stored: string): ParsedHash | null {
  const m = PHC_PATTERN.exec(stored);
  if (!m) return null;
  const [, mem, t, p, salt, hash] = m as unknown as [string, string, string, string, string, string];
  return {
    params: { memoryKiB: Number(mem), passes: Number(t), parallelism: Number(p) },
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) return false;
  const parsed = parse(stored);
  if (!parsed) return false;
  const candidate = await derive(password, parsed.salt, parsed.params, parsed.hash.length);
  return candidate.length === parsed.hash.length && timingSafeEqual(candidate, parsed.hash);
}

export function needsRehash(stored: string, params: Argon2Params = DEFAULT_ARGON2_PARAMS): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.params.memoryKiB < params.memoryKiB ||
    parsed.params.passes < params.passes ||
    parsed.params.parallelism !== params.parallelism
  );
}

/**
 * A real hash of a random password. When a login names a user that doesn't
 * exist, verify against this anyway so the response time doesn't reveal
 * whether the account exists (user-enumeration via timing).
 */
let dummyHash: Promise<string> | undefined;
export function getDummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}
