import type { BusinessProfile } from './types';

/**
 * schema.org data for search engines: what the business is, where, when it's
 * open, and its rating (only when it has reviews). Text comes from the
 * business, so every "<" is escaped: nothing in it can end the script block.
 */
export function businessJsonLd(business: BusinessProfile, url: string): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: business.name,
    url,
    ...(business.description && { description: business.description }),
    ...(business.logoUrl && { image: business.logoUrl }),
    ...(business.contact.phone && { telephone: business.contact.phone }),
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.address.line,
      addressLocality: business.address.city,
      ...(business.address.state && { addressRegion: business.address.state }),
      ...(business.address.postalCode && { postalCode: business.address.postalCode }),
      addressCountry: business.address.country,
    },
    ...(business.location && {
      geo: { '@type': 'GeoCoordinates', latitude: business.location.lat, longitude: business.location.lng },
    }),
    openingHoursSpecification: business.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: days[h.dayOfWeek],
      opens: h.openTime,
      closes: h.closeTime,
    })),
    ...(business.rating.count > 0 && {
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: business.rating.average,
        reviewCount: business.rating.count,
      },
    }),
  };
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
