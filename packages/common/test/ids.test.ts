import { describe, expect, it } from 'vitest';
import { uuidv7, uuidv7Timestamp, zUuid } from '../src/index.js';

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
