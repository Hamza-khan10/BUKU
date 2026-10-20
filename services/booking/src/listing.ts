import type { BusinessTx, DataPlane } from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';

/**
 * What a business's public listing shows changed on booking's side (DB-041, D3h): its menu (the
 * active services, their names and prices), its closures, or its rating. search-service brings
 * the business's catalog row up to date from it. Written in the same transaction as the change.
 */
export type ListingPart = 'menu' | 'closures' | 'rating';

export function announceListing(tx: BusinessTx, plane: DataPlane, businessId: bigint, part: ListingPart) {
  return enqueueShardEvent(
    tx,
    plane.id(),
    createEvent({
      type: TOPICS.LISTINGS_CHANGED,
      source: 'booking-service',
      subject: businessId.toString(),
      data: { businessId: businessId.toString(), part },
    }),
    'business',
  );
}
