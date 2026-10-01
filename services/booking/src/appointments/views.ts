import type { Prisma } from '@buku/database';
import { wallClock } from '../availability/time.js';

/**
 * What customers and businesses see of an appointment. Receipts (D-057) are
 * built from the appointment row when asked for: nothing is generated or
 * stored, and the app draws the QR code from `qr` (just the booking code —
 * never personal data). The business checks a receipt against its own list.
 */

export const appointmentInclude = {
  business: {
    select: { id: true, slug: true, name: true, address: true, city: true, phone: true, timezone: true },
  },
  service: { select: { id: true, name: true, durationMinutes: true } },
  staff: { select: { id: true, displayName: true } },
  user: { select: { id: true, name: true } },
} as const;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

const LIVE = new Set(['pending', 'confirmed']);

function timing(a: AppointmentRow) {
  const tz = a.business.timezone;
  const start = wallClock(a.startAt, tz);
  return {
    startAt: a.startAt.toISOString(),
    endAt: a.endAt.toISOString(),
    local: { date: start.date, startTime: start.time, endTime: wallClock(a.endAt, tz).time, timezone: tz },
  };
}

function cancellationInfo(a: AppointmentRow) {
  return a.status === 'cancelled'
    ? {
        cancelledAt: a.cancelledAt?.toISOString() ?? null,
        cancelledBy: a.cancelledBy,
        reasonCode: a.cancelReasonCode,
        reason: a.cancelReason,
      }
    : null;
}

/** The customer's receipt. */
export function receiptView(a: AppointmentRow, cancellationWindowHours: number, now = new Date()) {
  const windowStart = new Date(a.startAt.getTime() - cancellationWindowHours * 3_600_000);
  const live = LIVE.has(a.status) && a.startAt > now;
  return {
    id: a.id,
    code: a.confirmationCode,
    /** Content of the QR code the app shows. */
    qr: a.confirmationCode,
    status: a.status,
    business: {
      id: a.business.id,
      slug: a.business.slug,
      name: a.business.name,
      address: { line: a.business.address, city: a.business.city },
      phone: a.business.phone,
    },
    service: { id: a.service.id, name: a.service.name, durationMinutes: a.service.durationMinutes },
    staff: a.staff ? { id: a.staff.id, displayName: a.staff.displayName } : null,
    ...timing(a),
    price: a.price.toFixed(2),
    currency: a.currency,
    payment: 'pay_at_venue' as const,
    notes: a.notes,
    policy: {
      canCancel: live,
      /** Cancelling after this counts as a late cancellation. */
      freeCancellationUntil: windowStart.toISOString(),
      canReschedule: live && now < windowStart,
    },
    cancellation: cancellationInfo(a),
    rescheduledFromId: a.rescheduledFromId,
    createdAt: a.createdAt.toISOString(),
  };
}

/** The business's view: the same receipt plus who the customer is and internal notes. Never contact details or pictures. */
export function businessView(a: AppointmentRow) {
  return {
    id: a.id,
    code: a.confirmationCode,
    status: a.status,
    customer: { id: a.user.id, name: a.user.name },
    service: { id: a.service.id, name: a.service.name, durationMinutes: a.service.durationMinutes },
    staff: a.staff ? { id: a.staff.id, displayName: a.staff.displayName } : null,
    ...timing(a),
    price: a.price.toFixed(2),
    currency: a.currency,
    notes: a.notes,
    internalNotes: a.internalNotes,
    cancellation: cancellationInfo(a) && { ...cancellationInfo(a), late: a.lateCancellation },
    rescheduledFromId: a.rescheduledFromId,
    createdAt: a.createdAt.toISOString(),
  };
}
