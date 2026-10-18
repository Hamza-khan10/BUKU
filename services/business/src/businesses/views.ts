import type { BusinessShard, BusinessTx, DirectoryClient } from '@buku/database';
import { businessReliability, type BusinessRole } from '@buku/common';

/**
 * What the outside world sees vs what the business team sees. Views are
 * built field by field (never by spreading the DB row), so a new column can
 * never leak to the public by accident. IDs are public ones (DB-042).
 */

/** A kind of business, from the reference data (DB-015). */
export interface CategoryRef {
  id: bigint;
  name: string;
  slug: string;
  parentId: bigint | null;
}

export type LoadedBusiness = BusinessShard.Business & {
  hours: BusinessShard.BusinessHours[];
  /** Ranking figures (search-service, every 10 minutes); absent for a brand-new business. */
  searchStats: { kept90d: number; businessCancels90d: number } | null;
  category: CategoryRef | null;
};

const include = {
  hours: true,
  searchStats: { select: { kept90d: true, businessCancels90d: true } },
} as const;

const CATEGORY = { id: true, name: true, slug: true, parentId: true } as const;

/**
 * A kind of business: the shard's copy of the reference data, or the directory's own row when the
 * copy hasn't caught up yet (a kind added a second ago).
 */
export async function categoryOf(
  tx: BusinessTx,
  directory: DirectoryClient,
  id: bigint,
): Promise<CategoryRef | null> {
  return (
    (await tx.category.findUnique({ where: { id }, select: CATEGORY })) ??
    (await directory.category.findUnique({ where: { id }, select: CATEGORY }))
  );
}

/** A business that isn't deleted, with what its views show; inside its own transaction. */
export async function loadBusiness(
  tx: BusinessTx,
  directory: DirectoryClient,
  businessId: bigint,
): Promise<LoadedBusiness | null> {
  const b = await tx.business.findFirst({ where: { id: businessId, deletedAt: null }, include });
  return b && { ...b, category: await categoryOf(tx, directory, b.categoryId) };
}

export function publicView(b: LoadedBusiness) {
  return {
    id: b.publicId,
    slug: b.slug,
    name: b.name,
    description: b.description,
    category: b.category && {
      id: b.category.id.toString(),
      name: b.category.name,
      slug: b.category.slug,
    },
    contact: { phone: b.phone, email: b.email, website: b.website },
    address: { line: b.address, city: b.city, state: b.state, country: b.country, postalCode: b.postalCode },
    location: b.lat !== null && b.lng !== null ? { lat: b.lat, lng: b.lng } : null,
    timezone: b.timezone,
    currency: b.currency,
    // D-032: unverified businesses can take bookings but must be clearly labelled.
    verification:
      b.status === 'verified'
        ? {
            status: 'verified' as const,
            label: 'Verified business',
            verifiedAt: b.verifiedAt?.toISOString() ?? null,
          }
        : { status: 'not_verified' as const, label: 'Not verified by BUKU', verifiedAt: null },
    rating: { average: b.avgRating.toNumber(), count: b.reviewCount },
    /** Bookings kept vs cancelled by the business, last 90 days (D-035); null until 10 bookings. */
    reliability: b.searchStats
      ? businessReliability(b.searchStats.kept90d, b.searchStats.businessCancels90d)
      : null,
    hours: b.hours
      .filter((h) => !h.isClosed)
      .sort((x, y) => x.dayOfWeek - y.dayOfWeek || x.openTime.localeCompare(y.openTime))
      .map((h) => ({ dayOfWeek: h.dayOfWeek, openTime: h.openTime, closeTime: h.closeTime })),
    createdAt: b.createdAt.toISOString(),
    /** Turned into `logoUrl` by the route (links depend on storage settings). */
    logoStorageKey: b.logoStorageKey,
  };
}

export function privateView(b: LoadedBusiness, myRole: BusinessRole) {
  return {
    ...publicView(b),
    myRole,
    status: b.status,
    rejectionReason: b.rejectionReason,
    settings: b.settings,
    businessTermsVersion: b.businessTermsVersion,
    updatedAt: b.updatedAt.toISOString(),
  };
}

export type PublicBusiness = ReturnType<typeof publicView>;
export type PrivateBusiness = ReturnType<typeof privateView>;
