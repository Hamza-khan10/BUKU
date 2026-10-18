import { logger, zId } from '@buku/common';
import { TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import type { AppointmentService } from '../appointments/appointment-service.js';
import type { PersonSync } from '../appointments/person-sync.js';
import type { StaffService } from '../staff/staff-service.js';

/**
 * Events booking-service reacts to. Kafka delivers at least once, so every
 * handler is idempotent. Events carry internal IDs as decimal strings (DB-042).
 */

/** Its own: after each, the customer's side of the appointment is brought up to date (D3d). */
const OWN = [
  TOPICS.BOOKINGS_CREATED,
  TOPICS.BOOKINGS_CONFIRMED,
  TOPICS.BOOKINGS_CANCELLED,
  TOPICS.BOOKINGS_RESCHEDULED,
  TOPICS.BOOKINGS_COMPLETED,
  TOPICS.BOOKINGS_NO_SHOW,
] as const;

export const CONSUMED_TOPICS: Topic[] = [
  TOPICS.BUSINESSES_MEMBER_REMOVED,
  TOPICS.USERS_DELETED,
  TOPICS.BOOKINGS_CREATED,
  TOPICS.BOOKINGS_CONFIRMED,
  TOPICS.BOOKINGS_CANCELLED,
  TOPICS.BOOKINGS_RESCHEDULED,
  TOPICS.BOOKINGS_COMPLETED,
  TOPICS.BOOKINGS_NO_SHOW,
];

const MemberRemoved = z.object({ businessId: zId, userId: zId });
const UserDeleted = z.object({ userId: zId });
const Booking = z.object({
  appointmentId: zId,
  businessId: zId,
  previousAppointmentId: zId.optional(),
});

export function bookingEventHandler(deps: {
  staff: StaffService;
  appointments: AppointmentService;
  persons: PersonSync;
}): EventHandler {
  return async (event) => {
    switch (event.type) {
      case TOPICS.BUSINESSES_MEMBER_REMOVED: {
        // Someone left the team: they can no longer be booked.
        const { businessId, userId } = MemberRemoved.parse(event.data);
        const detached = await deps.staff.detachMember(businessId, userId);
        if (detached > 0)
          logger.info({ eventId: event.id, businessId: businessId.toString() }, 'staff profile deactivated');
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
      default: {
        if (!(OWN as readonly string[]).includes(event.type)) return;
        // A malformed payload throws: retried, then parked in the dead-letter topic.
        const { appointmentId, businessId, previousAppointmentId } = Booking.parse(event.data);
        await deps.persons.sync(businessId, appointmentId);
        if (previousAppointmentId) await deps.persons.sync(businessId, previousAppointmentId);
      }
    }
  };
}
