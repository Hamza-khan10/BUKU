import { logger, zId } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { CatalogSync } from '../catalog/catalog-sync.js';

/**
 * Events search-service keeps the catalog from (DB-041, D3h). Every one names a business; its
 * catalog row is refreshed from its shard, so redelivered, late or out-of-order events change
 * nothing. Events carry internal IDs as decimal strings (DB-042).
 */

export const CONSUMED_TOPICS: Topic[] = [
  // The business itself: profile, hours, photos and logo, verification, suspension.
  TOPICS.BUSINESSES_CREATED,
  TOPICS.BUSINESSES_UPDATED,
  TOPICS.BUSINESSES_VERIFIED,
  TOPICS.BUSINESSES_SUSPENDED,
  // Its menu, closures and rating (booking), and whether it runs a queue.
  TOPICS.LISTINGS_CHANGED,
  TOPICS.QUEUE_SETTINGS_UPDATED,
  // Today's queue moved.
  TOPICS.QUEUE_SESSION_OPENED,
  TOPICS.QUEUE_SESSION_CLOSED,
  TOPICS.QUEUE_ENTRY_JOINED,
  TOPICS.QUEUE_ENTRY_CALLED,
  TOPICS.QUEUE_ENTRY_SERVED,
  TOPICS.QUEUE_ENTRY_LEFT,
];

/** Today's queue moved: only its row is refreshed, the cheap path (many times a day). */
const QUEUE_MOVED = new Set<string>([
  TOPICS.QUEUE_SESSION_OPENED,
  TOPICS.QUEUE_SESSION_CLOSED,
  TOPICS.QUEUE_ENTRY_JOINED,
  TOPICS.QUEUE_ENTRY_CALLED,
  TOPICS.QUEUE_ENTRY_SERVED,
  TOPICS.QUEUE_ENTRY_LEFT,
]);

const AboutABusiness = z.object({ businessId: zId });

export function searchEventHandler(deps: { sync: CatalogSync }): EventHandler {
  return async (event) => {
    if (!CONSUMED_TOPICS.includes(event.type)) return;
    // A malformed payload throws: retried, then parked in the dead-letter topic.
    const { businessId } = AboutABusiness.parse(event.data);
    const result = QUEUE_MOVED.has(event.type)
      ? await deps.sync.refreshQueue(businessId)
      : await deps.sync.refresh(businessId);
    logger.debug({ eventId: event.id, type: event.type, result }, 'catalog refreshed');
  };
}
