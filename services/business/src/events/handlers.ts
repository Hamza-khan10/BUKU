import { logger } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { PictureService } from '../media/picture-service.js';

/**
 * Events business-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent: running it twice has the same effect as once.
 */

export const CONSUMED_TOPICS: Topic[] = [TOPICS.BUSINESSES_MEMBER_REMOVED];

const MemberRemoved = z.object({ businessId: z.uuid(), userId: z.uuid() });

export function businessEventHandler(deps: { pictures: PictureService }): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.BUSINESSES_MEMBER_REMOVED: {
        // A malformed payload throws: retried, then parked in the dead-letter topic.
        const { businessId, userId } = MemberRemoved.parse(event.data);
        const removed = await deps.pictures.removePhotosOfMember(businessId, userId);
        if (removed > 0) logger.info({ eventId: event.id, businessId, removed }, 'employee photo removed');
        return;
      }
      default:
        return; // not ours
    }
  };
}
