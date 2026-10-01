import { logger } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { StaffService } from '../staff/staff-service.js';

/**
 * Events booking-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent.
 */

export const CONSUMED_TOPICS: Topic[] = [TOPICS.BUSINESSES_MEMBER_REMOVED];

const MemberRemoved = z.object({ businessId: z.uuid(), userId: z.uuid() });

export function bookingEventHandler(deps: { staff: StaffService }): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.BUSINESSES_MEMBER_REMOVED: {
        // Someone left the team: they can no longer be booked.
        const { businessId, userId } = MemberRemoved.parse(event.data);
        const detached = await deps.staff.detachMember(businessId, userId);
        if (detached > 0) logger.info({ eventId: event.id, businessId }, 'staff profile deactivated');
        return;
      }
      default:
        return;
    }
  };
}
