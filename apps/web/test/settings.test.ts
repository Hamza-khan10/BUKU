import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fileSize, MAX_PICTURE_BYTES, pictureProblem, PICTURE_TYPES } from '../src/features/settings/picture';
import type { SignedInDevice } from '../src/features/settings/api';
import { deviceLabel, isPhone, sortedDevices } from '../src/features/settings/devices';
import {
  confirmed,
  DELETION_GRACE_DAYS,
  exportFileName,
  goodbyeHref,
  longDate,
  nothingGoes,
  untilFrom,
  whatDeletionCancels,
} from '../src/features/settings/my-data';
import { groupedKey, recoveryCodesFile } from '../src/features/settings/two-step';
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

describe('two-step sign-in', () => {
  it('shows the setup key in groups of four, for typing by hand', () => {
    expect(groupedKey('JBSWY3DPEHPK3PXP')).toBe('JBSW Y3DP EHPK 3PXP');
    expect(groupedKey('JBSWY3DPEHPK3PXPAB')).toBe('JBSW Y3DP EHPK 3PXP AB');
    expect(groupedKey('')).toBe('');
  });

  it('the recovery codes file says what they are, whose, and lists every code', () => {
    const codes = ['K7QX-2M9P', 'A1B2-C3D4'];
    const file = recoveryCodesFile(codes, 'ayesha@example.com', new Date('2026-10-05T20:00:00Z'));
    expect(file.name).toBe('buku-recovery-codes-2026-10-05.txt');
    expect(file.text).toContain('Account: ayesha@example.com');
    for (const c of codes) expect(file.text.split('\n')).toContain(c);
  });
});

describe('signed-in devices', () => {
  let made = 0;
  const device = (over: Partial<SignedInDevice>): SignedInDevice => ({
    id: `device-${++made}`,
    device: null,
    ipAddress: '203.0.x.x',
    userAgent: null,
    signedInAt: '2026-10-01T10:00:00Z',
    lastActiveAt: '2026-10-05T10:00:00Z',
    current: false,
    ...over,
  });

  it('are named as people know them', () => {
    expect(deviceLabel(device({ device: { name: 'Chrome on Windows', platform: 'web' } }))).toBe(
      'Chrome on Windows',
    );
    expect(
      deviceLabel(
        device({
          userAgent:
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
        }),
      ),
    ).toBe('Safari on iOS');
    expect(deviceLabel(device({}))).toBe('Unknown device');
    expect(isPhone(device({ device: { platform: 'android' } }))).toBe(true);
    expect(isPhone(device({ device: { name: 'Firefox on Linux', platform: 'web' } }))).toBe(false);
  });

  it('this browser comes first, then the most recently active', () => {
    const list = [
      device({ id: 'old', lastActiveAt: '2026-10-01T00:00:00Z' }),
      device({ id: 'here', current: true, lastActiveAt: '2026-10-02T00:00:00Z' }),
      device({ id: 'recent', lastActiveAt: '2026-10-05T00:00:00Z' }),
    ];
    expect(sortedDevices(list).map((d) => d.id)).toEqual(['here', 'recent', 'old']);
  });
});

describe('your data', () => {
  it('the days to change your mind are the ones auth-service keeps a deleted account', () => {
    const config = readFileSync(new URL('../../../services/auth/src/config.ts', import.meta.url), 'utf8');
    const days = /ACCOUNT_DELETION_GRACE_DAYS: z[^\n]*\.default\((\d+)\)/.exec(config)?.[1];
    expect(Number(days)).toBe(DELETION_GRACE_DAYS);
  });

  it('names the export by its day', () => {
    expect(exportFileName(new Date('2026-10-05T23:30:00Z'))).toBe('buku-data-export-2026-10-05.json');
  });

  it('the word typed to confirm, in any case, without stray spaces', () => {
    expect(confirmed('DELETE')).toBe(true);
    expect(confirmed(' delete ')).toBe(true);
    expect(confirmed('DELET')).toBe(false);
    expect(confirmed('DELETE ME')).toBe(false);
  });

  it('the goodbye page shows the last day only when the address carries a real date', () => {
    expect(goodbyeHref('2026-11-04T20:15:00.000Z')).toBe('/goodbye?until=2026-11-04');
    expect(longDate(untilFrom('2026-11-04')!)).toBe('4 November 2026');
    expect(untilFrom('2026-02-30')).toBeNull();
    expect(untilFrom('<script>')).toBeNull();
    expect(untilFrom(['2026-11-04'])).toBeNull();
    expect(untilFrom(undefined)).toBeNull();
  });
});

describe('what deleting the account would cancel', () => {
  const label = { day: (d: string) => `day ${d}`, clock: (t: string) => `at-${t}` };
  const visit = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    status: 'confirmed',
    checkedInAt: null,
    business: { name: 'Studio Noor' },
    service: { name: 'Haircut' },
    local: { date: '2026-10-10', startTime: '15:00' },
    ...over,
  });

  it('lists visits still to come and a live queue place, the way people know them', () => {
    const what = whatDeletionCancels(
      [visit('a'), visit('b', { status: 'pending' })],
      { id: 't', status: 'waiting', ticket: 'A-012', business: { name: 'Fade Barbers' } },
      label,
    );
    expect(what.visits.map((v) => v.label)).toEqual([
      'Haircut at Studio Noor, day 2026-10-10 at at-15:00',
      'Haircut at Studio Noor, day 2026-10-10 at at-15:00',
    ]);
    expect(what.ticket?.label).toBe('Your place in the queue at Fade Barbers (ticket A-012)');
    expect(nothingGoes(what)).toBe(false);
  });

  it('leaves out visits they’ve arrived for, finished tickets, and shows at most five', () => {
    const many = Array.from({ length: 7 }, (_, i) => visit(`v${i}`));
    const what = whatDeletionCancels(
      [
        ...many,
        visit('here', { checkedInAt: '2026-10-10T14:55:00Z' }),
        visit('done', { status: 'completed' }),
      ],
      { id: 't', status: 'serving', ticket: 'A-001', business: { name: 'Fade Barbers' } },
      label,
    );
    expect(what.visits).toHaveLength(5);
    expect(what.moreVisits).toBe(2);
    expect(what.ticket).toBeNull();
    expect(nothingGoes(whatDeletionCancels([], null, label))).toBe(true);
  });
});
