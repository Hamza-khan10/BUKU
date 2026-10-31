import { logger, zId } from '@buku/common';
import { ShardNotFoundError, type BusinessTx, type DataPlane } from '@buku/database';
import { processOnceOnShard, TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import { shortName, toCustomer, toTeam } from '../messages.js';
import type { Delivery, Notifier } from '../notifier.js';
import { approvers, loadVisit } from '../visits.js';
import type { WhatsAppService } from '../whatsapp/whatsapp-service.js';

/**
 * Booking, review and queue events → messages (D-071), on database v2 (D3f). Events carry
 * internal IDs (DB-042); names, times and the business are read on the business's shard when the
 * message is built. Each recipient's shard handles the event once (`processOnceOnShard`): their
 * inbox rows are written in that transaction; pushes go out after it commits.
 *
 * Who hears what:
 *  • the customer — their bookings and queue tickets;
 *  • the employee doing the service (or the owner if nobody is assigned or
 *    linked) — new bookings, cancellations and moves;
 *  • owner, managers and front desk — requests that need approving.
 * An account closed (`users.deleted`): its WhatsApp number is let go at once.
 */

export const CONSUMED_TOPICS: Topic[] = [
  TOPICS.BOOKINGS_CREATED,
  TOPICS.BOOKINGS_CONFIRMED,
  TOPICS.BOOKINGS_CANCELLED,
  TOPICS.BOOKINGS_RESCHEDULED,
  TOPICS.BOOKINGS_NO_SHOW,
  TOPICS.QUEUE_POSITION_UPDATED,
  TOPICS.QUEUE_ENTRY_CALLED,
  TOPICS.QUEUE_ENTRY_LEFT,
  TOPICS.REVIEWS_CREATED,
  TOPICS.REVIEWS_RESPONDED,
  TOPICS.USERS_DELETED,
];

const CONSUMER = 'notification-service';

const Booking = z.object({
  appointmentId: zId,
  businessId: zId,
  status: z.string().optional(),
  cancelledBy: z.enum(['user', 'business', 'system']).optional(),
  reasonCode: z.string().optional(),
  late: z.boolean().optional(),
});
const ReviewEvent = z.object({ reviewId: zId, appointmentId: zId, businessId: zId });
const QueueEvent = z.object({
  entryId: zId,
  businessId: zId,
  sessionDate: z.iso.date().optional(),
  userId: zId.nullable(),
  ticket: z.string(),
  ahead: z.number().int().optional(),
  reason: z.string().optional(),
});
const UserDeleted = z.object({ userId: zId });

export function notificationHandler(deps: {
  plane: DataPlane;
  notifier: Notifier;
  whatsapp: WhatsAppService;
}): EventHandler {
  const log = logger.child({ module: 'notification-events' });
  return async (event) => {
    if (!CONSUMED_TOPICS.includes(event.type)) return;
    if (event.type === TOPICS.USERS_DELETED) {
      const { userId } = UserDeleted.parse(event.data);
      if (await deps.whatsapp.forget(userId))
        log.info({ eventId: event.id }, 'closed account: WhatsApp number let go');
      return;
    }
    // A malformed payload throws: retried, then parked in the dead-letter topic.
    const deliveries = event.type.startsWith('bookings.')
      ? await bookingDeliveries(deps.plane, event.type, Booking.parse(event.data))
      : event.type.startsWith('reviews.')
        ? await reviewDeliveries(deps.plane, event.type, ReviewEvent.parse(event.data))
        : await queueDeliveries(deps.plane, event.type, QueueEvent.parse(event.data));
    if (!deliveries.length) return;
    await deps.notifier.deliver(deliveries, async (tx, ids) =>
      (await processOnceOnShard(tx, CONSUMER, event)) ? ids : [],
    );
  };
}

/** Work in the business's transaction; a business no longer placed anywhere has nothing to say. */
function atBusiness<T>(plane: DataPlane, businessId: bigint, work: (tx: BusinessTx) => Promise<T[]>) {
  return plane.inBusiness(businessId, work).catch((err: unknown) => {
    if (err instanceof ShardNotFoundError) return [] as T[];
    throw err;
  });
}

function bookingDeliveries(plane: DataPlane, type: Topic, e: z.infer<typeof Booking>): Promise<Delivery[]> {
  return atBusiness(plane, e.businessId, async (tx) => {
    const loaded = await loadVisit(tx, e.appointmentId);
    if (!loaded) return [];
    const { appointment: a, visit, doer } = loaded;
    const customer = (message: Delivery['message']): Delivery => ({
      userId: a.userId,
      message,
      appointmentId: a.id,
    });
    const team = (userIds: bigint[], message: Delivery['message']): Delivery[] =>
      [...new Set(userIds)]
        .filter((id) => id !== a.userId)
        .map((userId) => ({ userId, message, appointmentId: a.id }));

    switch (type) {
      case TOPICS.BOOKINGS_CREATED:
        if (e.status === 'pending') {
          return [
            customer(toCustomer.requested(visit)),
            ...team(await approvers(tx, a.business), toTeam.request(visit)),
          ];
        }
        return team([doer], toTeam.booked(visit)); // the customer hears from `bookings.confirmed`
      case TOPICS.BOOKINGS_CONFIRMED:
        return [customer(toCustomer.confirmed(visit))];
      case TOPICS.BOOKINGS_CANCELLED:
        if (e.cancelledBy === 'user') return team([doer], toTeam.cancelled(visit, Boolean(e.late)));
        return [
          customer(
            e.reasonCode === 'declined'
              ? toCustomer.declined(visit, a.cancelReason)
              : toCustomer.cancelledByBusiness(visit, a.cancelReason),
          ),
        ];
      case TOPICS.BOOKINGS_RESCHEDULED:
        return [customer(toCustomer.rescheduled(visit)), ...team([doer], toTeam.moved(visit))];
      case TOPICS.BOOKINGS_NO_SHOW:
        return [customer(toCustomer.missed(visit))];
      default:
        return [];
    }
  });
}

/** New review → owner and managers (who can reply). Reply → the reviewer. */
function reviewDeliveries(
  plane: DataPlane,
  type: Topic,
  e: z.infer<typeof ReviewEvent>,
): Promise<Delivery[]> {
  return atBusiness(plane, e.businessId, async (tx) => {
    const review = await tx.review.findFirst({
      where: { id: e.reviewId, businessId: e.businessId },
      include: { business: { select: { id: true, publicId: true, name: true, ownerUserId: true } } },
    });
    if (!review || !review.isVisible) return [];
    const visit = await tx.appointment.findFirst({
      where: { id: review.appointmentId, startAt: review.appointmentStartAt },
      select: { publicId: true, customerName: true, service: { select: { name: true } } },
    });
    if (!visit) return [];
    if (type === TOPICS.REVIEWS_RESPONDED) {
      return [
        {
          userId: review.userId,
          message: toCustomer.reviewReplied({
            appointmentId: visit.publicId,
            businessName: review.business.name,
          }),
          appointmentId: review.appointmentId,
        },
      ];
    }
    const managers = await tx.businessMember.findMany({
      where: { businessId: review.businessId, status: 'active', role: 'manager' },
      select: { userId: true },
    });
    const message = toTeam.newReview({
      businessId: review.business.publicId,
      reviewId: review.id.toString(),
      reviewer: shortName(visit.customerName ?? 'A customer'),
      overall: review.overallRating,
      serviceName: visit.service.name,
    });
    return [...new Set([review.business.ownerUserId, ...managers.map((m) => m.userId)])]
      .filter((id) => id !== review.userId)
      .map((userId) => ({ userId, message, appointmentId: review.appointmentId }));
  });
}

function queueDeliveries(plane: DataPlane, type: Topic, e: z.infer<typeof QueueEvent>): Promise<Delivery[]> {
  if (!e.userId) return Promise.resolve([]); // walk-ins have no account to notify
  const userId = e.userId;
  return atBusiness(plane, e.businessId, async (tx) => {
    const ticket = await tx.queueTicket.findFirst({
      where: {
        id: e.entryId,
        businessId: e.businessId,
        ...(e.sessionDate && { sessionDate: new Date(`${e.sessionDate}T00:00:00Z`) }),
      },
      include: {
        session: { select: { gracePeriodSeconds: true } },
        business: { select: { name: true, timezone: true } },
      },
    });
    if (!ticket) return [];
    const { business } = ticket;
    const entryId = ticket.id.toString();
    const to = (message: Delivery['message']): Delivery[] => [{ userId, message, queueTicketId: ticket.id }];

    switch (type) {
      case TOPICS.QUEUE_POSITION_UPDATED:
        return e.ahead === undefined ? [] : to(toCustomer.queueAhead(entryId, business.name, e.ahead));
      case TOPICS.QUEUE_ENTRY_CALLED: {
        const comeBy = ticket.calledAt
          ? new Date(ticket.calledAt.getTime() + ticket.session.gracePeriodSeconds * 1000)
          : null;
        return to(toCustomer.queueCalled(entryId, business.name, e.ticket, comeBy, business.timezone));
      }
      case TOPICS.QUEUE_ENTRY_LEFT:
        // Leaving by choice needs no message; the queue closing on them does.
        return e.reason === 'queue_closed'
          ? to(toCustomer.queueClosed(entryId, business.name, e.ticket))
          : [];
      default:
        return [];
    }
  });
}
