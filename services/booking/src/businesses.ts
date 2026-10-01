import { AppError, ErrorCodes } from '@buku/common';
import type { Database } from '@buku/database';

/** Businesses customers can book: not deleted, not rejected or suspended (D-032: unverified is fine). */
const BOOKABLE_STATUSES = ['pending', 'verified'] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A business as the public sees it, by id or by the slug in its link. */
export async function findBookableBusiness(db: Database, idOrSlug: string) {
  const business = await db.business.findFirst({
    where: {
      ...(UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
      deletedAt: null,
      status: { in: [...BOOKABLE_STATUSES] },
    },
    select: { id: true, slug: true, name: true, timezone: true, currency: true },
  });
  if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  return business;
}

/** Management changes are refused while a business is suspended. */
export async function assertNotSuspended(db: Database, businessId: string): Promise<void> {
  const b = await db.business.findFirst({ where: { id: businessId }, select: { status: true } });
  if (b?.status === 'suspended') {
    throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
  }
}
