import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Application-level field encryption (AES-256-GCM) for PII such as a user's
 * email and phone number.
 *
 * Why this exists on top of disk encryption: a leaked database dump, backup,
 * or SQL-injection read exposes plaintext columns; it does not expose these,
 * because the key lives only in the service's environment.
 *
 * Ciphertext format (all parts base64url):
 *
 *   enc:1:<keyId>:<iv>:<ciphertext||authTag>
 *
 * - keyId enables key ROTATION: new writes use the active key, old rows stay
 *   readable with previous keys until re-encrypted in the background.
 * - AAD ("additional authenticated data") binds a ciphertext to its column,
 *   e.g. "users.email". Copying an encrypted email into another column or
 *   table makes decryption fail instead of silently returning data.
 */

const FORMAT_PREFIX = 'enc';
const FORMAT_VERSION = '1';
const IV_BYTES = 12; // NIST-recommended IV size for GCM
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface Keyring {
  activeKeyId: string;
  keys: ReadonlyMap<string, Buffer>;
}

export class DecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Parse a keyring from env format: "k1:<base64 32 bytes>,k2:<base64 32 bytes>".
 * The active key must be one of them.
 */
export function parseKeyring(spec: string, activeKeyId: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const entry of spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)) {
    const sep = entry.indexOf(':');
    if (sep <= 0) throw new Error('Keyring entries must look like "<keyId>:<base64key>"');
    const id = entry.slice(0, sep);
    if (!/^[A-Za-z0-9_-]{1,16}$/.test(id)) throw new Error(`Invalid key id "${id}"`);
    const key = Buffer.from(entry.slice(sep + 1), 'base64');
    if (key.length !== KEY_BYTES) throw new Error(`Key "${id}" must decode to exactly ${KEY_BYTES} bytes`);
    if (keys.has(id)) throw new Error(`Duplicate key id "${id}"`);
    keys.set(id, key);
  }
  if (!keys.has(activeKeyId)) throw new Error(`Active key id "${activeKeyId}" is not in the keyring`);
  return { activeKeyId, keys };
}

export interface FieldCipher {
  /** Encrypt `plaintext`, binding it to `context` (e.g. "users.email"). */
  encrypt(plaintext: string, context: string): string;
  /** Decrypt; throws DecryptionError if tampered, wrong context, or unknown key. */
  decrypt(ciphertext: string, context: string): string;
  /** True if this value was written with a non-active key and should be re-encrypted. */
  needsReEncryption(ciphertext: string): boolean;
}

export function createFieldCipher(keyring: Keyring): FieldCipher {
  const activeKey = keyring.keys.get(keyring.activeKeyId);
  if (!activeKey) throw new Error('Active key missing from keyring');

  return {
    encrypt(plaintext, context) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv('aes-256-gcm', activeKey, iv, { authTagLength: TAG_BYTES });
      cipher.setAAD(Buffer.from(context, 'utf8'));
      const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
      return [
        FORMAT_PREFIX,
        FORMAT_VERSION,
        keyring.activeKeyId,
        iv.toString('base64url'),
        body.toString('base64url'),
      ].join(':');
    },

    decrypt(ciphertext, context) {
      const parts = ciphertext.split(':');
      if (parts.length !== 5 || parts[0] !== FORMAT_PREFIX || parts[1] !== FORMAT_VERSION) {
        throw new DecryptionError('Malformed ciphertext');
      }
      const [, , keyId, ivB64, bodyB64] = parts as [string, string, string, string, string];
      const key = keyring.keys.get(keyId);
      if (!key) throw new DecryptionError(`Unknown key id "${keyId}"`);
      const iv = Buffer.from(ivB64, 'base64url');
      const body = Buffer.from(bodyB64, 'base64url');
      if (iv.length !== IV_BYTES || body.length < TAG_BYTES)
        throw new DecryptionError('Malformed ciphertext');

      const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(Buffer.from(context, 'utf8'));
      decipher.setAuthTag(body.subarray(body.length - TAG_BYTES));
      try {
        return Buffer.concat([
          decipher.update(body.subarray(0, body.length - TAG_BYTES)),
          decipher.final(),
        ]).toString('utf8');
      } catch {
        // Do not leak which check failed (tag vs. AAD vs. key): all are "not authentic".
        throw new DecryptionError('Ciphertext failed authentication');
      }
    },

    needsReEncryption(ciphertext) {
      return ciphertext.split(':')[2] !== keyring.activeKeyId;
    },
  };
}
