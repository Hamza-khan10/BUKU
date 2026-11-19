import { describe, expect, it } from 'vitest';
import { LAUNCH_PLANS } from '../src/features/pricing/launch-plans';
import { ALSO_KNOWN_AS, brandGraph, PROFILES, X_HANDLE } from '../src/lib/brand';

describe('Who BUKU is, for search and answer engines (D-138)', () => {
  const graph = brandGraph('https://onbuku.com');
  const node = (type: string) => graph.find((n) => n['@type'] === type) as Record<string, unknown>;

  it('names BUKU with the other names people use and what it does, and no country (open to all)', () => {
    const org = node('Organization');
    expect(org.alternateName).toEqual([...ALSO_KNOWN_AS]);
    expect(org.alternateName).toContain('onbuku');
    expect('areaServed' in org).toBe(false);
    expect(JSON.stringify(graph)).not.toMatch(/Pakistan/);
    expect(String(org.description)).toMatch(/appointment booking and walk-in queue app/);
    expect(String(org.description)).toContain('onbuku.com');
    // Profiles only once they exist: an empty sameAs says nothing.
    expect('sameAs' in org).toBe(PROFILES.length > 0);
  });

  it('profiles are BUKU’s own: https, a known platform, the onbuku handle; X’s matches the cards', () => {
    for (const url of PROFILES) {
      const { protocol, hostname, pathname, search } = new URL(url);
      expect(protocol).toBe('https:');
      expect([
        'www.facebook.com',
        'x.com',
        'www.instagram.com',
        'www.linkedin.com',
        'www.tiktok.com',
        'www.youtube.com',
      ]).toContain(hostname);
      // The handle, never a temporary one (on._.buku while Instagram reviews) or another BUKU's.
      expect(pathname).toMatch(/^\/(company\/|@)?onbuku(app)?\/?$/);
      expect(search).toBe('');
    }
    expect(new Set(PROFILES).size).toBe(PROFILES.length);
    const x = PROFILES.find((u) => new URL(u).hostname === 'x.com');
    expect(x && `@${new URL(x).pathname.slice(1)}`).toBe(X_HANDLE);
  });

  it('the app’s prices are the plans’, in both currencies', () => {
    const app = node('WebApplication');
    const offers = app.offers as { priceCurrency: string; lowPrice: number; highPrice: number }[];
    for (const currency of ['PKR', 'USD'] as const) {
      const prices = LAUNCH_PLANS.map((p) => p.monthly[currency]);
      expect(offers.find((o) => o.priceCurrency === currency)).toMatchObject({
        lowPrice: 0,
        highPrice: Math.max(...prices),
      });
    }
    expect(app.applicationCategory).toBe('BusinessApplication');
  });
});
