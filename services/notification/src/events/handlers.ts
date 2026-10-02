import { logger } from '@buku/common';
import type { Database, Transaction } from '@buku/database';
import { processOnce, TOPICS, type EventHandler, type Topic } from '@buku/kafka';
import { z } from 'zod';
import { toCustomer, toTeam, type Visit } from '../messages.js';
import type { Delivery, Notifier } from '../notifier.js';

/**
 * Booking and queue events → messages (D-071). Events carry ids only; names,
 * times and the business are read here (read-only) when the message is built.
 * Each event is handled once (`processOnce`): its inbox rows are written in
 * that transaction; pushes go out after it commits.
 *
 * Who hears what:
 *  • the customer — their bookings and queue tickets;
 *  • the employee doing the service (or the owner if nobody is assigned or
 *    linked) — new bookings, cancellations and moves;
 *  • owner, managers and front desk — requests that need approving.
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
];

const CONSUMER = 'notification-service';

const Booking = z.object({
  appointmentId: z.uuid(),
  status: z.string().optional(),
  cancelledBy: z.enum(['user', 'business', 'system']).optional(),
  reasonCode: z.string().optional(),
  late: z.boolean().optional(),
});
const QueueEvent = z.object({
  entryId: z.uuid(),
  businessId: z.uuid(),
  userId: z.uuid().nullable(),
  ticket: z.string(),
  ahead: z.number().int().optional(),
  reason: z.string().optional(),
});

export function notificationHandler(deps: { db: Database; notifier: Notifier }): EventHandler {
  const log = logger.child({ module: 'notification-events' });
  return async (event) => {
    if (!CONSUMED_TOPICS.includes(event.type)) return;
    let toPush: Delivery[] = [];
    await processOnce(deps.db, CONSUMER, event.id, async (tx) => {
      const deliveries = event.type.startsWith('bookings.')
        ? await bookingDeliveries(tx, event.type, Booking.parse(event.data))
        : await queueDeliveries(tx, event.type, QueueEvent.parse(event.data));
      toPush = await deps.notifier.record(tx, deliveries);
    });
    if (toPush.length) {
      // After the commit. A push failure must not make Kafka redeliver (the inbox is done).
      await deps.notifier
        .send(toPush)
        .catch((err: unknown) => log.error({ err, eventId: event.id }, 'push failed'));
    }
  };
}

async function bookingDeliveries(
  tx: Transaction,
  type: Topic,
  e: z.infer<typeof Booking>,
): Promise<Delivery[]> {
  const a = await tx.appointment.findUnique({
    where: { id: e.appointmentId },
    include: {
      business: { select: { id: true, name: true, timezone: true, ownerId: true } },
      service: { select: { name: true } },
      staff: { select: { displayName: true, userId: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!a) return [];
  const visit: Visit = {
    appointmentId: a.id,
    businessId: a.businessId,
    businessName: a.business.name,
    serviceName: a.service.name,
    staffName: a.staff?.displayName ?? null,
    customerName: a.user.name,
    code: a.confirmationCode,
    startAt: a.startAt,
    timezone: a.business.timezone,
  };
  const customer = (message: Delivery['message']): Delivery => ({
    userId: a.userId,
    message,
    appointmentId: a.id,
  });
  const team = (userIds: string[], message: Delivery['message']): Delivery[] =>
    [...new Set(userIds)]
      .filter((id) => id !== a.userId)
      .map((userId) => ({ userId, message, appointmentId: a.id }));
  // The employee doing it, if their profile is linked to a team account; else the owner.
  const doer = a.staff?.userId ?? a.business.ownerId;

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
}

async function queueDeliveries(
  tx: Transaction,
  type: Topic,
  e: z.infer<typeof QueueEvent>,
): Promise<Delivery[]> {
  if (!e.userId) return []; // walk-ins have no account to notify
  const entry = await tx.queueEntry.findUnique({
    where: { id: e.entryId },
    include: { session: { include: { business: { select: { name: true, timezone: true } } } } },
  });
  if (!entry) return [];
  const { business } = entry.session;
  const to = (message: Delivery['message']): Delivery[] => [
    { userId: e.userId!, message, queueEntryId: e.entryId },
  ];

  switch (type) {
    case TOPICS.QUEUE_POSITION_UPDATED:
      return e.ahead === undefined ? [] : to(toCustomer.queueAhead(e.entryId, business.name, e.ahead));
    case TOPICS.QUEUE_ENTRY_CALLED: {
      const comeBy = entry.calledAt
        ? new Date(entry.calledAt.getTime() + entry.session.gracePeriodSeconds * 1000)
        : null;
      return to(toCustomer.queueCalled(e.entryId, business.name, e.ticket, comeBy, business.timezone));
    }
    case TOPICS.QUEUE_ENTRY_LEFT:
      // Leaving by choice needs no message; the queue closing on them does.
      return e.reason === 'queue_closed'
        ? to(toCustomer.queueClosed(e.entryId, business.name, e.ticket))
        : [];
    default:
      return [];
  }
}

/** Owner, managers and front desk: the people who approve booking requests. */
async function approvers(tx: Transaction, business: { id: string; ownerId: string }): Promise<string[]> {
  const members = await tx.businessMember.findMany({
    where: { businessId: business.id, status: 'active', role: { in: ['manager', 'front_desk'] } },
    select: { userId: true },
  });
  return [business.ownerId, ...members.map((m) => m.userId)];
}
