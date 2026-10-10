import { logger } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { AppointmentService } from '../appointments/appointment-service.js';
import type { StaffService } from '../staff/staff-service.js';

/**
 * Events booking-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent.
 */

export const CONSUMED_TOPICS: Topic[] = [TOPICS.BUSINESSES_MEMBER_REMOVED, TOPICS.USERS_DELETED];

const MemberRemoved = z.object({ businessId: z.uuid(), userId: z.uuid() });
const UserDeleted = z.object({ userId: z.uuid() });

export function bookingEventHandler(deps: {
  staff: StaffService;
  appointments: AppointmentService;
}): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.BUSINESSES_MEMBER_REMOVED: {
        // Someone left the team: they can no longer be booked.
        const { businessId, userId } = MemberRemoved.parse(event.data);
        const detached = await deps.staff.detachMember(businessId, userId);
        if (detached > 0) logger.info({ eventId: event.id, businessId }, 'staff profile deactivated');
        return;
      }
      case TOPICS.USERS_DELETED: {
        // Someone closed their account: their visits still to come are cancelled.
        const { userId } = UserDeleted.parse(event.data);
        const cancelled = await deps.appointments.cancelForClosedAccount(userId, {
          ip: null,
          userAgent: null,
          requestId: event.correlationId ?? null,
        });
        if (cancelled > 0)
          logger.info({ eventId: event.id, cancelled }, 'closed account: bookings cancelled');
        return;
      }
      default:
        return;
    }
  };
}
