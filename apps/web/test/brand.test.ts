import { describe, expect, it } from 'vitest';
import { LAUNCH_PLANS } from '../src/features/pricing/launch-plans';
import { ALSO_KNOWN_AS, brandGraph, PROFILES } from '../src/lib/brand';

describe('Who BUKU is, for search and answer engines (D-138)', () => {
  const graph = brandGraph('https://onbuku.com');
  const node = (type: string) => graph.find((n) => n['@type'] === type) as Record<string, unknown>;

  it('names BUKU with the other names people use, where it serves, and what it does', () => {
    const org = node('Organization');
    expect(org.alternateName).toEqual([...ALSO_KNOWN_AS]);
    expect(org.alternateName).toContain('onbuku');
    expect(org.areaServed).toEqual({ '@type': 'Country', name: 'Pakistan' });
    expect(String(org.description)).toMatch(/appointment booking and walk-in queue app/);
    expect(String(org.description)).toContain('onbuku.com');
    // Profiles only once they exist: an empty sameAs says nothing.
    expect('sameAs' in org).toBe(PROFILES.length > 0);
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
