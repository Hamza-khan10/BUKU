import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileSize, MAX_PICTURE_BYTES, pictureProblem, PICTURE_TYPES } from '../src/features/settings/picture';
import { offsetOf, zoneLabel, zoneOptions } from '../src/features/settings/zones';

const media = readFileSync(new URL('../../../packages/media/src/file-types.ts', import.meta.url), 'utf8');

describe('profile pictures', () => {
  it('the website accepts exactly what the API accepts', () => {
    const types = /PHOTO_TYPES = \[([^\]]+)\]/
      .exec(media)?.[1]
      ?.match(/'[^']+'/g)
      ?.map((t) => t.slice(1, -1));
    expect(types).toEqual([...PICTURE_TYPES]);
    expect(/MAX_PHOTO_BYTES = (\d+) \* 1024 \* 1024/.exec(media)?.[1]).toBe(
      String(MAX_PICTURE_BYTES / 1024 / 1024),
    );
  });

  it('explains a file that can’t be used before anything is sent', () => {
    expect(pictureProblem({ type: 'image/jpeg', size: 2_000_000 })).toBeNull();
    expect(pictureProblem({ type: 'image/heic', size: 2_000_000 })).toBe(
      'Choose a JPEG, PNG or WebP picture.',
    );
    expect(pictureProblem({ type: 'image/svg+xml', size: 900 })).toBe('Choose a JPEG, PNG or WebP picture.');
    expect(pictureProblem({ type: 'image/png', size: 0 })).toMatch(/empty/);
    expect(pictureProblem({ type: 'image/webp', size: 12.5 * 1024 * 1024 })).toBe(
      'Pictures can be up to 10 MB; this one is 12.5 MB.',
    );
  });

  it('says sizes the way people read them', () => {
    expect(fileSize(10 * 1024 * 1024)).toBe('10 MB');
    expect(fileSize(3.46 * 1024 * 1024)).toBe('3.5 MB');
    expect(fileSize(820 * 1024)).toBe('820 KB');
    expect(fileSize(10)).toBe('1 KB');
  });
});

describe('time zones', () => {
  const january = new Date('2026-01-15T12:00:00Z');
  const july = new Date('2026-07-15T12:00:00Z');

  it('labels a zone by its place and its offset now', () => {
    expect(zoneLabel('Asia/Karachi', january)).toBe('Asia / Karachi (GMT+5)');
    expect(zoneLabel('America/Argentina/Buenos_Aires', january)).toBe(
      'America / Argentina / Buenos Aires (GMT-3)',
    );
    expect(zoneLabel('Asia/Kolkata', january)).toBe('Asia / Kolkata (GMT+5:30)');
  });

  it('offsets follow daylight saving', () => {
    expect(offsetOf('Europe/London', january)).toBe('GMT');
    expect(offsetOf('Europe/London', july)).toBe('GMT+1');
  });

  it('lists every zone once, alphabetically, always with the account’s own and UTC', () => {
    const options = zoneOptions('Asia/Calcutta', january).map((o) => o.value);
    expect(options).toContain('Asia/Calcutta');
    expect(options).toContain('UTC');
    expect(options).toContain('Asia/Karachi');
    expect(new Set(options).size).toBe(options.length);
    expect([...options].sort((a, b) => a.localeCompare(b))).toEqual(options);
  });
});
