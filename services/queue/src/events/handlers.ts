import { logger, zId } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { QueueService } from '../queue-service.js';

/**
 * Events queue-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent. Events carry internal IDs as decimal strings (DB-042).
 */

export const CONSUMED_TOPICS: Topic[] = [
  TOPICS.USERS_DELETED,
  // Its own: how each ticket ended goes into the person's reliability (D3e).
  TOPICS.QUEUE_ENTRY_COMPLETED,
  TOPICS.QUEUE_ENTRY_NO_SHOW,
];

const UserDeleted = z.object({ userId: zId });
const TicketEnded = z.object({
  entryId: zId,
  businessId: zId,
  sessionDate: z.iso.date().optional(),
});

export function queueEventHandler(deps: { queue: QueueService }): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.USERS_DELETED: {
        // Someone closed their account: they give up their place in line.
        const { userId } = UserDeleted.parse(event.data);
        const left = await deps.queue.leaveForClosedAccount(userId, {
          ip: null,
          userAgent: null,
          requestId: event.correlationId ?? null,
        });
        if (left > 0) logger.info({ eventId: event.id, left }, 'closed account: queue places given up');
        return;
      }
      case TOPICS.QUEUE_ENTRY_COMPLETED:
      case TOPICS.QUEUE_ENTRY_NO_SHOW: {
        // A malformed payload throws: retried, then parked in the dead-letter topic.
        const { entryId, businessId, sessionDate } = TicketEnded.parse(event.data);
        await deps.queue.recordOutcome(
          businessId,
          entryId,
          sessionDate === undefined ? undefined : new Date(`${sessionDate}T00:00:00Z`),
        );
        return;
      }
      default:
        return;
    }
  };
}
