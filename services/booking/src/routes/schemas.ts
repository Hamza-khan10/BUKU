import { zBody, zSafeText, zTimeOfDay, zUuid } from '@buku/common';
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
  name: zSafeText({ min: 1, max: 100 }),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const UpdateCategoryBody = CategoryBody.partial().refine(atLeastOne, 'at least one field is required');

const serviceFields = {
  name: zSafeText({ min: 1, max: 200 }),
  description: zSafeText({ max: 2000 }).nullable().optional(),
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
  displayName: zSafeText({ min: 1, max: 100 }),
  bio: zSafeText({ max: 1000 }).nullable().optional(),
  specializations: z
    .array(zSafeText({ min: 1, max: 60 }))
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
  reason: zSafeText({ max: 200 }).optional(),
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
}).refine(atLeastOne, 'at least one field is required');
