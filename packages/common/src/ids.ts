import { randomBytes } from 'node:crypto';

/**
 * UUID version 7 (RFC 9562): 48-bit Unix-millisecond timestamp + 74 random bits.
 *
 * Time-ordered, so new rows append to the end of B-tree indexes (fast inserts,
 * compact indexes) while staying globally unique and unguessable enough to
 * expose in URLs. Matches Prisma's `@default(uuid(7))`, and lets code create
 * ids up front (e.g. to link rows before inserting them).
 *
 * Monotonic within a process: ids generated in the same millisecond still sort
 * in creation order (the random tail is incremented).
 */
let lastMs = 0;
let lastTail: Buffer = Buffer.alloc(10);

export function uuidv7(now: number = Date.now()): string {
  const bytes = Buffer.alloc(16);
  let tail: Buffer;
  if (now <= lastMs) {
    now = lastMs;
    tail = Buffer.from(lastTail);
    for (let i = tail.length - 1; i >= 0; i--) {
      tail[i] = (tail[i]! + 1) & 0xff;
      if (tail[i] !== 0) break;
    }
  } else {
    tail = randomBytes(10);
  }
  lastMs = now;
  lastTail = tail;

  bytes.writeUIntBE(now, 0, 6);
  tail.copy(bytes, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70; // version 7
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Extract the creation time embedded in a UUIDv7. */
export function uuidv7Timestamp(id: string): Date {
  return new Date(parseInt(id.replace(/-/g, '').slice(0, 12), 16));
}

// ═══════════════════════ Database v2 IDs (docs/DATABASE.md DB-001, DB-002) ═══════════════════════
//
//  0 | 41 bits: ms since 2026-01-01T00:00:00Z | 10 bits: generator (top 3 = region) | 12 bits: sequence
//
// The same layout as the database's ids.next_id(). The epoch and the layout are fixed for good:
// changing either would break the order of every ID already made.

/** 2026-01-01T00:00:00Z. Never change. */
export const ID_EPOCH_MS = 1_767_225_600_000;
export const MAX_GENERATOR = 1023;
const MAX_SEQUENCE = 4095;
const MAX_TIME = 2 ** 41 - 1;

export interface IdParts {
  timestamp: Date;
  generator: number;
  region: number;
  sequence: number;
}

/**
 * Makes IDs for one generator (a running instance holds its generator through a lease, so no two
 * make the same ones). Strictly increasing: in a busy millisecond, or if the system clock steps
 * back, it runs on its own clock instead of waiting or repeating.
 */
export class IdGenerator {
  readonly generator: number;
  readonly region: number;
  #lastMs = -1;
  #sequence = 0;

  constructor(
    generator: number,
    private readonly clock: () => number = Date.now,
  ) {
    if (!Number.isInteger(generator) || generator < 0 || generator > MAX_GENERATOR) {
      throw new RangeError(`ID generator must be 0..${MAX_GENERATOR}`);
    }
    this.generator = generator;
    this.region = generator >> 7;
  }

  next(): bigint {
    const now = this.clock() - ID_EPOCH_MS;
    if (now < 0) throw new RangeError('the clock is before the ID epoch');
    if (now > this.#lastMs) {
      this.#lastMs = now;
      this.#sequence = 0;
    } else if (this.#sequence < MAX_SEQUENCE) {
      this.#sequence += 1;
    } else {
      this.#lastMs += 1;
      this.#sequence = 0;
    }
    if (this.#lastMs > MAX_TIME) throw new RangeError('the ID clock has run out (2095)');
    return (BigInt(this.#lastMs) << 22n) | (BigInt(this.generator) << 12n) | BigInt(this.#sequence);
  }
}

/** What an ID says about itself. */
export function parseId(id: bigint): IdParts {
  if (id <= 0n || id > 0x7fff_ffff_ffff_ffffn) throw new RangeError('not a BUKU ID');
  const generator = Number((id >> 12n) & 1023n);
  return {
    timestamp: new Date(Number(id >> 22n) + ID_EPOCH_MS),
    generator,
    region: generator >> 7,
    sequence: Number(id & 4095n),
  };
}

/** The region an ID was made in (0..7), as registry.region_of() says. */
export const regionOfId = (id: bigint): number => Number((id >> 19n) & 7n);

/**
 * IDs travel as decimal strings (JSON numbers lose precision past 2^53). Anything that isn't a
 * positive 64-bit decimal is refused, so a crafted value never reaches a query.
 */
export function idFromString(value: string): bigint | null {
  if (!/^[1-9][0-9]{0,18}$/.test(value)) return null;
  const id = BigInt(value);
  return id <= 0x7fff_ffff_ffff_ffffn ? id : null;
}

const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const PUBLIC_ID_LENGTH = 12;
export const PUBLIC_ID_PATTERN = /^[0-9A-Za-z]{12}$/;

/**
 * A public ID (DB-001): 12 Base62 characters from the system's cryptographic source, about 71 bits,
 * for anything shown (URLs, receipts, API responses). Unrelated to the internal ID, so it reveals
 * neither order nor volume. Bytes of 248 and above are skipped, so every character is equally
 * likely (no modulo bias).
 */
export function publicId(): string {
  let out = '';
  while (out.length < PUBLIC_ID_LENGTH) {
    for (const byte of randomBytes(PUBLIC_ID_LENGTH * 2)) {
      if (byte < 248 && out.length < PUBLIC_ID_LENGTH) out += BASE62[byte % 62];
    }
  }
  return out;
}
