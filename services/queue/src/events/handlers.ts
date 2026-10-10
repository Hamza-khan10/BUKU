import { logger } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { QueueService } from '../queue-service.js';

/**
 * Events queue-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent.
 */

export const CONSUMED_TOPICS: Topic[] = [TOPICS.USERS_DELETED];

const UserDeleted = z.object({ userId: z.uuid() });

export function queueEventHandler(deps: { queue: QueueService }): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.USERS_DELETED: {
        // Someone closed their account: they give up their places in line.
        const { userId } = UserDeleted.parse(event.data);
        const left = await deps.queue.leaveForClosedAccount(userId, {
          ip: null,
          userAgent: null,
          requestId: event.correlationId ?? null,
        });
        if (left > 0) logger.info({ eventId: event.id, left }, 'closed account: queue places given up');
        return;
      }
      default:
        return;
    }
  };
}
