import type { Business, BusinessHours, Category } from '@buku/database';
import type { BusinessRole } from '@buku/common';

/**
 * What the outside world sees vs what the business team sees. Views are
 * built field by field (never by spreading the DB row), so a new column can
 * never leak to the public by accident.
 */

type WithRelations = Business & { category: Pick<Category, 'id' | 'name' | 'slug'>; hours: BusinessHours[] };

export function publicView(b: WithRelations) {
  return {
    id: b.id,
    slug: b.slug,
    name: b.name,
    description: b.description,
    category: { id: b.category.id, name: b.category.name, slug: b.category.slug },
    contact: { phone: b.phone, email: b.email, website: b.website },
    address: { line: b.address, city: b.city, state: b.state, country: b.country, postalCode: b.postalCode },
    location: b.lat !== null && b.lng !== null ? { lat: b.lat.toNumber(), lng: b.lng.toNumber() } : null,
    timezone: b.timezone,
    currency: b.currency,
    // D-032: unverified businesses can take bookings but must be clearly labelled.
    verification: b.verified
      ? {
          status: 'verified' as const,
          label: 'Verified business',
          verifiedAt: b.verifiedAt?.toISOString() ?? null,
        }
      : { status: 'not_verified' as const, label: 'Not verified by BUKU', verifiedAt: null },
    rating: { average: b.avgRating.toNumber(), count: b.reviewCount },
    hours: b.hours
      .filter((h) => !h.isClosed)
      .sort((x, y) => x.dayOfWeek - y.dayOfWeek || x.openTime.localeCompare(y.openTime))
      .map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime })),
    createdAt: b.createdAt.toISOString(),
  };
}

export function privateView(b: WithRelations, myRole: BusinessRole) {
  return {
    ...publicView(b),
    myRole,
    status: b.status,
    rejectionReason: b.rejectionReason,
    settings: b.settings,
    subscriptionTier: b.subscriptionTier,
    businessTermsVersion: b.businessTermsVersion,
    updatedAt: b.updatedAt.toISOString(),
  };
}

export type PublicBusiness = ReturnType<typeof publicView>;
