import { describe, expect, it } from 'vitest';
import { businessJsonLd } from '../src/features/business/json-ld';
import type { BusinessProfile } from '../src/features/business/types';

const business: BusinessProfile = {
  id: 'b1',
  slug: 'salt-and-pepper',
  name: 'Salt & Pepper </script><script>alert(1)</script>',
  description: null,
  category: { id: 'c1', name: 'Barbershop', slug: 'barbershop' },
  contact: { phone: '+924235550000', email: null, website: null },
  address: { line: '12 Main Boulevard', city: 'Lahore', state: 'Punjab', country: 'PK', postalCode: null },
  location: { lat: 31.52, lng: 74.35 },
  timezone: 'Asia/Karachi',
  currency: 'PKR',
  verification: { status: 'verified', label: 'Verified business', verifiedAt: null },
  rating: { average: 0, count: 0 },
  reliability: null,
  hours: [{ dayOfWeek: 1, openTime: '09:00', closeTime: '18:00' }],
  createdAt: '2026-10-01T00:00:00Z',
  logoUrl: null,
  photos: [],
  team: [],
};

describe('structured data for search engines', () => {
  it('can never end the script block, whatever the business typed', () => {
    const json = businessJsonLd(business, 'https://buku.app/b/salt-and-pepper');
    expect(json).not.toContain('<');
    // …and still says exactly what the business typed.
    expect((JSON.parse(json) as { name: string }).name).toBe(business.name);
  });

  it('describes the business, and claims a rating only when there are reviews', () => {
    const data = JSON.parse(businessJsonLd(business, 'https://buku.app/b/salt-and-pepper')) as Record<
      string,
      unknown
    >;
    expect(data['@type']).toBe('LocalBusiness');
    expect(data.aggregateRating).toBeUndefined();
    expect(data.openingHoursSpecification).toEqual([
      { '@type': 'OpeningHoursSpecification', dayOfWeek: 'Monday', opens: '09:00', closes: '18:00' },
    ]);
    const rated = JSON.parse(
      businessJsonLd({ ...business, rating: { average: 4.5, count: 2 } }, 'https://buku.app/b/x'),
    ) as { aggregateRating: unknown };
    expect(rated.aggregateRating).toEqual({ '@type': 'AggregateRating', ratingValue: 4.5, reviewCount: 2 });
  });
});
