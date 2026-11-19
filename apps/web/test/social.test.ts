import { describe, expect, it } from 'vitest';
import { PROFILES } from '../src/lib/brand';
import { PLATFORMS, socialProfiles } from '../src/features/marketing/social';

describe('BUKU’s social profiles on the site', () => {
  it('every profile shows, with its platform’s mark: none is silently left out', () => {
    const shown = socialProfiles();
    expect(shown.map((p) => p.url).sort()).toEqual([...PROFILES].sort());
    for (const p of shown) expect(p.mark.length).toBeGreaterThan(50);
  });

  it('handles as people search for them; in the platforms’ order', () => {
    const shown = socialProfiles([
      'https://x.com/onbukuapp',
      'https://www.facebook.com/onbukuapp',
      'https://www.instagram.com/onbukuapp/',
      'https://www.youtube.com/@onbukuapp',
    ]);
    expect(shown.map((p) => [p.name, p.handle])).toEqual([
      ['Instagram', '@onbukuapp'],
      ['Facebook', 'onbukuapp'],
      ['YouTube', '@onbukuapp'],
      ['X', '@onbukuapp'],
    ]);
  });

  it('nothing without a profile, and a platform without a mark is left out', () => {
    expect(socialProfiles([])).toEqual([]);
    expect(socialProfiles(['https://www.linkedin.com/company/onbukuapp'])).toEqual([]);
  });

  it('marks are drawing data only (one path’s commands and numbers)', () => {
    for (const p of PLATFORMS) expect(p.mark).toMatch(/^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/);
  });
});
