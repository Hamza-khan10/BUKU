import { describe, expect, it } from 'vitest';
import {
  ID_EPOCH_MS,
  IdGenerator,
  idFromString,
  parseId,
  PUBLIC_ID_PATTERN,
  publicId,
  regionOfId,
  uuidv7,
  uuidv7Timestamp,
  zId,
  zPublicId,
  zUuid,
} from '../src/index.js';

describe('uuidv7', () => {
  it('produces RFC 9562 version-7 UUIDs accepted by our validator', () => {
    const id = uuidv7();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(zUuid.safeParse(id).success).toBe(true);
  });

  it('embeds the creation time', () => {
    const t = Date.UTC(2032, 8, 29, 12, 0, 0);
    expect(uuidv7Timestamp(uuidv7(t)).getTime()).toBe(t);
  });

  it('never goes backwards if the clock does (monotonic)', () => {
    const later = uuidv7(Date.UTC(2033, 0, 1));
    const clockSkewed = uuidv7(Date.UTC(2020, 0, 1));
    expect(clockSkewed > later).toBe(true);
  });

  it('is strictly increasing even within the same millisecond', () => {
    const ids = Array.from({ length: 5000 }, () => uuidv7(Date.UTC(2034, 0, 1)));
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('64-bit IDs (DB-002)', () => {
  const at = (iso: string) => () => Date.parse(iso);

  it('carries its time, generator, region and sequence, exactly as the database lays them out', () => {
    const ids = new IdGenerator(130, at('2026-10-16T12:00:00.000Z'));
    const a = ids.next();
    const b = ids.next();
    expect(parseId(a)).toEqual({
      timestamp: new Date('2026-10-16T12:00:00.000Z'),
      generator: 130,
      region: 1,
      sequence: 0,
    });
    expect(parseId(b).sequence).toBe(1);
    // registry.region_of(): (id >> 19) & 7.
    expect(regionOfId(a)).toBe(1);
    expect(ids.region).toBe(1);
    // ms since the epoch | generator | sequence.
    const ms = BigInt(Date.parse('2026-10-16T12:00:00.000Z') - ID_EPOCH_MS);
    expect(a).toBe((ms << 22n) | (130n << 12n));
  });

  it('is unique and strictly increasing, even 100,000 in a single millisecond', () => {
    const ids = new IdGenerator(7, at('2026-10-16T12:00:00.000Z'));
    let last = 0n;
    const seen = new Set<bigint>();
    for (let i = 0; i < 100_000; i++) {
      const id = ids.next();
      expect(id > last).toBe(true);
      last = id;
      seen.add(id);
    }
    expect(seen.size).toBe(100_000);
    // After 4,096 in one millisecond it runs on its own clock rather than waiting or repeating.
    expect(parseId(last).timestamp.getTime()).toBeGreaterThan(Date.parse('2026-10-16T12:00:00.000Z'));
  });

  it('never goes backwards when the system clock does', () => {
    let now = Date.parse('2026-10-16T12:00:05Z');
    const ids = new IdGenerator(1, () => now);
    const before = ids.next();
    now -= 5_000;
    const after = ids.next();
    expect(after > before).toBe(true);
    expect(parseId(after).timestamp).toEqual(parseId(before).timestamp);
  });

  it('two generators never make the same ID, whatever the time', () => {
    const a = new IdGenerator(0, at('2026-10-16T12:00:00Z'));
    const b = new IdGenerator(1, at('2026-10-16T12:00:00Z'));
    const fromA = new Set(Array.from({ length: 5000 }, () => a.next()));
    for (let i = 0; i < 5000; i++) expect(fromA.has(b.next())).toBe(false);
  });

  it('refuses generators outside 0..1023 and times before the epoch', () => {
    expect(() => new IdGenerator(1024)).toThrow(RangeError);
    expect(() => new IdGenerator(-1)).toThrow(RangeError);
    expect(() => new IdGenerator(1.5)).toThrow(RangeError);
    expect(() => new IdGenerator(0, at('2025-12-31T23:59:59Z')).next()).toThrow(/before the ID epoch/);
    expect(() => parseId(0n)).toThrow(RangeError);
    expect(() => parseId(2n ** 63n)).toThrow(RangeError);
  });

  it('travels as a decimal string; anything else is refused before it reaches a query', () => {
    expect(idFromString('104636050680315904')).toBe(104636050680315904n);
    expect(idFromString('9223372036854775807')).toBe(2n ** 63n - 1n);
    for (const bad of [
      '',
      '0',
      '-1',
      '01',
      '1e9',
      ' 1',
      '1 ',
      '9223372036854775808',
      '12345678901234567890',
      '1;DROP',
    ]) {
      expect(idFromString(bad), bad).toBeNull();
    }
  });
});

describe('public IDs (DB-001)', () => {
  it('are 12 Base62 characters, never repeating', () => {
    const ids = Array.from({ length: 10_000 }, publicId);
    for (const id of ids) expect(id).toMatch(PUBLIC_ID_PATTERN);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('use every character about equally (no modulo bias)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 20_000; i++) for (const c of publicId()) counts.set(c, (counts.get(c) ?? 0) + 1);
    expect(counts.size).toBe(62);
    // 240,000 characters over 62: about 3,871 each. A plain byte % 62 would make the first 8
    // characters a quarter more likely (about 4,690 each).
    const values = [...counts.values()];
    expect(Math.min(...values)).toBeGreaterThan(3550);
    expect(Math.max(...values)).toBeLessThan(4200);
  });
});

describe('IDs in APIs (DB-042)', () => {
  it('zId takes a 64-bit decimal string and gives a bigint; nothing else gets through', () => {
    expect(zId.parse('104636050680315904')).toBe(104636050680315904n);
    for (const bad of ['', '0', '-5', '01', '1e9', '9223372036854775808', "1' OR 1=1", 'abc', '12 34']) {
      expect(zId.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('zPublicId takes exactly 12 Base62 characters', () => {
    expect(zPublicId.parse('Ab3dEf6hIj9k')).toBe('Ab3dEf6hIj9k');
    for (const bad of ['Ab3dEf6hIj9', 'Ab3dEf6hIj9k1', 'Ab3dEf6hIj9-', '../../etc/pw']) {
      expect(zPublicId.safeParse(bad).success, bad).toBe(false);
    }
  });
});
