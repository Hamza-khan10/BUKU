import { CURRENCIES, LAUNCH_PLANS } from '@/features/pricing/launch-plans';

/**
 * Who BUKU is, for search and answer engines (D-138). "BUKU" alone is a crowded name (a textbook
 * service holds buku.io and buku.app; "Booku" sells event queues), so every description says what
 * BUKU is, where it serves, and the other names people use for it, and links its own profiles.
 */

/** BUKU's own profiles elsewhere (social, directories): add each once it exists and links back. */
export const PROFILES: readonly string[] = [];

export const ALSO_KNOWN_AS = ['onbuku', 'onbuku.com', 'BUKU app'] as const;

export const BRAND_DESCRIPTION =
  'BUKU (onbuku.com) is an appointment booking and walk-in queue app, starting in Pakistan: people book a time or join a queue at barbers, clinics, salons and offices from their phone, free, and businesses run their bookings and queue with it.';

/** BUKU as an organisation, its website, and the app with its prices (schema.org @graph nodes). */
export function brandGraph(site: string) {
  const organization = `${site}/#organization`;
  return [
    {
      '@type': 'Organization',
      '@id': organization,
      name: 'BUKU',
      alternateName: [...ALSO_KNOWN_AS],
      url: site,
      logo: `${site}/brand/buku-app-icon.svg`,
      slogan: 'Book the time. Skip the wait.',
      description: BRAND_DESCRIPTION,
      areaServed: { '@type': 'Country', name: 'Pakistan' },
      knowsAbout: ['appointment booking', 'queue management', 'walk-in queues', 'online scheduling'],
      ...(PROFILES.length > 0 && { sameAs: [...PROFILES] }),
    },
    {
      '@type': 'WebSite',
      '@id': `${site}/#website`,
      name: 'BUKU',
      alternateName: [...ALSO_KNOWN_AS],
      url: site,
      inLanguage: 'en',
      publisher: { '@id': organization },
    },
    {
      '@type': 'WebApplication',
      '@id': `${site}/#app`,
      name: 'BUKU',
      url: site,
      description: BRAND_DESCRIPTION,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Any (in a web browser)',
      publisher: { '@id': organization },
      // The plans (D-137): free for people who book; per branch, per month, for businesses.
      offers: CURRENCIES.map((currency) => {
        const prices = LAUNCH_PLANS.map((p) => p.monthly[currency]);
        return {
          '@type': 'AggregateOffer',
          priceCurrency: currency,
          lowPrice: Math.min(...prices),
          highPrice: Math.max(...prices),
          offerCount: LAUNCH_PLANS.length,
          url: `${site}/pricing`,
        };
      }),
    },
  ];
}
