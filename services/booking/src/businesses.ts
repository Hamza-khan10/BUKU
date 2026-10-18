import { AppError, ErrorCodes } from '@buku/common';
import type { BusinessTx, DataPlane } from '@buku/database';

/** Businesses customers can book: not deleted, not rejected or suspended (D-032: unverified is fine). */
const BOOKABLE_STATUSES = ['pending', 'verified'] as const;

export interface BookableBusiness {
  id: bigint;
  publicId: string;
  slug: string;
  name: string;
  timezone: string;
  currency: string;
}

/** The internal ID of a business named by its public ID or its address (global handles, DB-018). */
export const businessIdOf = (plane: DataPlane, idOrSlug: string) => plane.businessIdOf(idOrSlug);

/** A business as the public sees it, by its public ID or the slug in its link. */
export async function findBookableBusiness(plane: DataPlane, idOrSlug: string): Promise<BookableBusiness> {
  const id = await businessIdOf(plane, idOrSlug);
  const business =
    id === null
      ? null
      : await plane.inBusiness(id, (tx) =>
          tx.business.findFirst({
            where: { id, deletedAt: null, status: { in: [...BOOKABLE_STATUSES] } },
            select: { id: true, publicId: true, slug: true, name: true, timezone: true, currency: true },
          }),
        );
  if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  return business;
}

/** Management changes are refused while a business is suspended. */
export async function assertNotSuspended(tx: BusinessTx, businessId: bigint): Promise<void> {
  const b = await tx.business.findFirst({ where: { id: businessId }, select: { status: true } });
  if (b?.status === 'suspended') {
    throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
  }
}
