import type { ShowUp } from '@buku/common';
import type { BusinessShard, BusinessTx } from '@buku/database';
import { wallClock } from '../availability/time.js';
import { formatMinor } from '../money.js';

/**
 * What customers and businesses see of an appointment. Receipts (D-057) are
 * built from the appointment row when asked for: nothing is generated or
 * stored, and the app draws the QR code from `qr` (just the booking code —
 * never personal data). The business checks a receipt against its own list.
 * Appointments and businesses are shown by their public IDs, a business's own rows by decimal
 * IDs (DB-042).
 */

export const appointmentInclude = {
  business: {
    select: {
      publicId: true,
      slug: true,
      name: true,
      address: true,
      city: true,
      phone: true,
      timezone: true,
    },
  },
  service: { select: { id: true, name: true, durationMinutes: true } },
  staff: { select: { id: true, displayName: true } },
} as const;

export type AppointmentRow = BusinessShard.Appointment & {
  business: {
    publicId: string;
    slug: string;
    name: string;
    address: string | null;
    city: string;
    phone: string | null;
    timezone: string;
  };
  service: { id: bigint; name: string; durationMinutes: number };
  staff: { id: bigint; displayName: string } | null;
};

/** An appointment by its ID, through the index that holds its partition key (DB-024). */
export async function loadAppointment(tx: BusinessTx, appointmentId: bigint): Promise<AppointmentRow | null> {
  const index = await tx.appointmentIndex.findUnique({
    where: { appointmentId },
    select: { startAt: true },
  });
  return index
    ? tx.appointment.findUnique({
        where: { id_startAt: { id: appointmentId, startAt: index.startAt } },
        include: appointmentInclude,
      })
    : null;
}

/** An appointment of this business by its public ID or its booking code. */
export async function findAppointment(
  tx: BusinessTx,
  businessId: bigint,
  ref: { publicId: string } | { code: string },
): Promise<AppointmentRow | null> {
  const index = await tx.appointmentIndex.findFirst({
    where: 'code' in ref ? { businessId, code: ref.code } : { businessId, publicId: ref.publicId },
    select: { appointmentId: true },
  });
  return index ? loadAppointment(tx, index.appointmentId) : null;
}

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

/** The public ID of the appointment a moved one came from (looked up by the caller). */
export type Moved = string | null;

/** The customer's receipt. */
export function receiptView(
  a: AppointmentRow,
  cancellationWindowHours: number,
  exponent: number,
  movedFrom: Moved,
  now = new Date(),
) {
  const windowStart = new Date(a.startAt.getTime() - cancellationWindowHours * 3_600_000);
  // Once the customer has checked in, the visit is underway: no cancelling or moving it.
  const live = LIVE.has(a.status) && a.startAt > now && a.checkedInAt === null;
  return {
    id: a.publicId,
    code: a.code,
    /** Content of the QR code the app shows. */
    qr: a.code,
    status: a.status,
    business: {
      id: a.business.publicId,
      slug: a.business.slug,
      name: a.business.name,
      address: { line: a.business.address, city: a.business.city },
      phone: a.business.phone,
    },
    service: {
      id: a.service.id.toString(),
      name: a.service.name,
      durationMinutes: a.service.durationMinutes,
    },
    staff: a.staff ? { id: a.staff.id.toString(), displayName: a.staff.displayName } : null,
    ...timing(a),
    price: formatMinor(a.priceMinor, exponent),
    currency: a.currency,
    payment: 'pay_at_venue' as const,
    notes: a.notes,
    policy: {
      canCancel: live,
      /** Cancelling after this counts as a late cancellation. */
      freeCancellationUntil: windowStart.toISOString(),
      canReschedule: live && now < windowStart,
    },
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    cancellation: cancellationInfo(a),
    rescheduledFromId: movedFrom,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * The business's view: the same receipt plus who the customer is (the name they booked under)
 * and internal notes. Never contact details or pictures. The customer's reliability is a label
 * only ("Shows up 95%" / "New customer"), never their history.
 */
export function businessView(
  a: AppointmentRow,
  customerPublicId: string | null,
  exponent: number,
  movedFrom: Moved,
  showUp?: ShowUp,
) {
  return {
    id: a.publicId,
    code: a.code,
    status: a.status,
    customer: {
      id: customerPublicId,
      name: a.customerName ?? 'Deleted user',
      ...(showUp && { reliability: { label: showUp.label, showsUpPercent: showUp.showsUpPercent } }),
    },
    service: {
      id: a.service.id.toString(),
      name: a.service.name,
      durationMinutes: a.service.durationMinutes,
    },
    staff: a.staff ? { id: a.staff.id.toString(), displayName: a.staff.displayName } : null,
    ...timing(a),
    price: formatMinor(a.priceMinor, exponent),
    currency: a.currency,
    notes: a.notes,
    internalNotes: a.internalNotes,
    checkedInAt: a.checkedInAt?.toISOString() ?? null,
    cancellation: cancellationInfo(a) && { ...cancellationInfo(a), late: a.lateCancellation },
    rescheduledFromId: movedFrom,
    createdAt: a.createdAt.toISOString(),
  };
}
