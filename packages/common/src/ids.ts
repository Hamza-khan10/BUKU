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
