import { zBody, zPagination, zSafeText, zTimeOfDay, zUuid } from '@buku/common';
import { z } from 'zod';

/** Request contracts for booking-service (source for docs/API_REFERENCE.md). */

export const IdParams = z.object({ id: zUuid });
/** Public pages use the business's id or its slug. */
export const IdOrSlugParams = z.object({ idOrSlug: z.string().min(1).max(200) });
export const CategoryParams = z.object({ id: zUuid, categoryId: zUuid });
export const ServiceParams = z.object({ id: zUuid, serviceId: zUuid });
export const StaffParams = z.object({ id: zUuid, staffId: zUuid });
export const TimeOffParams = z.object({ id: zUuid, staffId: zUuid, entryId: zUuid });
export const ClosureParams = z.object({ id: zUuid, closureId: zUuid });

const atLeastOne = (b: Record<string, unknown>) => Object.values(b).some((v) => v !== undefined);

// ── Menu ───────────────────────────────────────────────────────────────────

export const CategoryBody = zBody({
  name: zSafeText({ kind: 'title', min: 1, max: 100 }),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const UpdateCategoryBody = CategoryBody.partial().refine(atLeastOne, 'at least one field is required');

const serviceFields = {
  name: zSafeText({ kind: 'title', min: 1, max: 200 }),
  description: zSafeText({ kind: 'text', max: 2000 }).nullable().optional(),
  categoryId: zUuid.nullable().optional(),
  durationMinutes: z.number().int().min(5).max(1440),
  /** Clean-up time after the service, not shown to customers. */
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  /** In the business's currency, at most 2 decimals. */
  price: z.number().min(0).max(10_000_000).multipleOf(0.01),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  staffIds: z.array(zUuid).max(200).optional(),
};
export const ServiceBody = zBody(serviceFields);
export const UpdateServiceBody = zBody({ ...serviceFields, isActive: z.boolean() })
  .partial()
  .refine(atLeastOne, 'at least one field is required');

// ── Staff ──────────────────────────────────────────────────────────────────

const staffFields = {
  displayName: zSafeText({ kind: 'personName', min: 1, max: 100 }),
  bio: zSafeText({ kind: 'text', max: 1000 }).nullable().optional(),
  specializations: z
    .array(zSafeText({ kind: 'title', min: 1, max: 60 }))
    .max(20)
    .optional(),
  userId: zUuid.nullable().optional(),
  serviceIds: z.array(zUuid).max(500).optional(),
};
export const StaffBody = zBody(staffFields);
export const UpdateStaffBody = zBody({ ...staffFields, isActive: z.boolean() })
  .partial()
  .refine(atLeastOne, 'at least one field is required');

// ── Schedules ──────────────────────────────────────────────────────────────

const zDate = z.iso.date();

export const HoursBody = zBody({
  /** Days not listed are days off. */
  days: z
    .array(
      z.strictObject({
        dayOfWeek: z.number().int().min(0).max(6),
        ranges: z
          .array(z.strictObject({ start: zTimeOfDay, end: zTimeOfDay }))
          .min(1)
          .max(4),
      }),
    )
    .max(7),
});

const timeOffFields = {
  from: zDate,
  to: zDate.optional(),
  startTime: zTimeOfDay.optional(),
  endTime: zTimeOfDay.optional(),
  reason: zSafeText({ kind: 'line', max: 200 }).optional(),
};
export const TimeOffBody = zBody({
  kind: z.enum(['time_off', 'extra_hours']).default('time_off'),
  ...timeOffFields,
});
export const ClosureBody = zBody(timeOffFields);

// ── Settings ───────────────────────────────────────────────────────────────

export const BookingSettingsBody = zBody({
  confirmationMode: z.enum(['automatic', 'manual']).optional(),
  bookingHorizonDays: z.number().int().min(1).max(1825).optional(),
  maxFutureBookingsPerCustomer: z.number().int().min(1).max(20).optional(),
  cancellationWindowHours: z.number().int().min(0).max(168).optional(),
  minNoticeMinutes: z.number().int().min(0).max(10080).optional(),
  slotStepMinutes: z.literal([5, 10, 15, 20, 30, 60]).optional(),
  noShowGraceMinutes: z.number().int().min(0).max(240).optional(),
  /** null switches it off. */
  approvalBelowShowUpPercent: z.number().int().min(50).max(99).nullable().optional(),
}).refine(atLeastOne, 'at least one field is required');

// ── Availability and appointments ──────────────────────────────────────────

export const AvailabilityQuery = z.object({
  serviceId: zUuid,
  date: zDate,
  days: z.coerce.number().int().min(1).max(14).default(1),
  staffId: zUuid.optional(),
});

export const BookBody = zBody({
  businessId: zUuid,
  serviceId: zUuid,
  /** Leave out for "anyone available". */
  staffId: zUuid.optional(),
  /** A start time offered by the availability endpoint, with its UTC offset. */
  startAt: z.iso.datetime({ offset: true }),
  notes: zSafeText({ kind: 'text', max: 500 }).optional(),
});

export const MyAppointmentsQuery = zPagination.extend({
  scope: z.enum(['upcoming', 'past']).default('upcoming'),
});

export const AppointmentParams = z.object({ id: zUuid });
export const BusinessAppointmentParams = z.object({ id: zUuid, appointmentId: zUuid });

export const CancelBody = zBody({
  reasonCode: z.enum([
    'schedule_conflict',
    'found_alternative',
    'too_expensive',
    'not_needed',
    'illness',
    'other',
  ]),
  note: zSafeText({ kind: 'text', max: 500 }).optional(),
  /** "I'll book later" → a reminder in a few days. */
  bookLater: z.boolean().optional(),
});

export const RescheduleBody = zBody({
  startAt: z.iso.datetime({ offset: true }),
  staffId: zUuid.optional(),
});

export const BusinessAppointmentsQuery = z.object({
  date: zDate.optional(),
  staffId: zUuid.optional(),
  status: z.enum(['pending', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled']).optional(),
  /** A booking code ("BK-7KQ2MX") or part of a customer's name. */
  q: zSafeText({ kind: 'line', min: 1, max: 100 }).optional(),
});

export const DeclineBody = zBody({ reason: zSafeText({ kind: 'text', max: 500 }).optional() });
export const BusinessCancelBody = zBody({ reason: zSafeText({ kind: 'text', min: 3, max: 500 }) });

// ── At the venue ───────────────────────────────────────────────────────────

/** Scanned from the receipt's QR, or typed. Case doesn't matter. */
export const CheckInByCodeBody = zBody({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^BK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/, 'must look like BK-7KQ2MX'),
});

export const ClockInBody = zBody({ note: zSafeText({ kind: 'line', max: 300 }).optional() });
export const AttendanceQuery = z.object({ date: zDate.optional(), staffId: zUuid.optional() });
export const ShiftParams = z.object({ id: zUuid, shiftId: zUuid });
export const CorrectShiftBody = zBody({
  checkInAt: z.iso.datetime({ offset: true }).optional(),
  checkOutAt: z.iso.datetime({ offset: true }).optional(),
  note: zSafeText({ kind: 'line', max: 300 }).optional(),
}).refine(atLeastOne, 'at least one field is required');

// ── Reviews ──
const star = z.number().int().min(1).max(5);
export const ReviewBody = zBody({
  overall: star,
  waitTime: star.optional(),
  staff: star.optional(),
  cleanliness: star.optional(),
  value: star.optional(),
  comment: zSafeText({ kind: 'text', max: 2000 }).optional(),
});
export const BusinessReviewsQuery = zPagination.extend({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  sort: z.enum(['recent', 'highest', 'lowest']).default('recent'),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  withComment: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export const ReviewParams = z.object({ id: zUuid, reviewId: zUuid });
export const AdminReviewParams = z.object({ reviewId: zUuid });
export const ReviewResponseBody = zBody({ text: zSafeText({ kind: 'text', min: 2, max: 1000 }) });
export const ReportReviewBody = zBody({
  reason: z.enum(['offensive', 'fake', 'not_a_customer', 'personal_info', 'other']),
  note: zSafeText({ kind: 'line', max: 150 }).optional(),
});
export const ModerateReviewBody = z.discriminatedUnion('action', [
  zBody({ action: z.literal('hide'), reason: zSafeText({ kind: 'text', min: 3, max: 300 }) }),
  zBody({ action: z.literal('keep') }),
  zBody({ action: z.literal('restore') }),
]);

// ── Reports ──
export const ReportQuery = z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }).strict();
