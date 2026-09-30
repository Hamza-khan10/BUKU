import {
  zBody,
  zCountryCode,
  zEmail,
  zPagination,
  zPhone,
  zSafeText,
  zTimeOfDay,
  zTimezone,
  zUuid,
} from '@buku/common';
import { z } from 'zod';

/** Request contracts for business-service (source for docs/API_REFERENCE.md). */

const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
export const zIsoCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .refine((c) => CURRENCIES.has(c), 'must be an ISO 4217 currency code, e.g. "PKR"');

/** Only https websites: no javascript:, data:, or plain-http phishing links on profiles. */
export const zWebsite = z.url({ protocol: /^https$/, message: 'must be an https:// URL' }).max(500);

const profileFields = {
  name: zSafeText({ min: 2, max: 200 }),
  categoryId: zUuid,
  description: zSafeText({ max: 2000 }).optional(),
  phone: zPhone.optional(),
  email: zEmail.optional(),
  website: zWebsite.optional(),
  address: zSafeText({ min: 3, max: 500 }),
  city: zSafeText({ min: 1, max: 100 }),
  state: zSafeText({ max: 100 }).optional(),
  country: zCountryCode,
  postalCode: zSafeText({ max: 20 }).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  timezone: zTimezone,
  currency: zIsoCurrency,
};

export const CreateBusinessBody = zBody({
  ...profileFields,
  /** The Business Terms version the owner agreed to. */
  acceptedBusinessTermsVersion: z.string().max(20),
});

export const UpdateBusinessBody = zBody(
  Object.fromEntries(Object.entries(profileFields).map(([k, v]) => [k, v.optional()])) as {
    [K in keyof typeof profileFields]: z.ZodOptional<(typeof profileFields)[K]>;
  },
).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

export const IdParams = z.object({ id: zUuid });
/** Public profile lookup: a UUID or a slug. */
export const IdOrSlugParams = z.object({
  idOrSlug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'invalid business id or slug'),
});

const HoursInterval = z.strictObject({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: zTimeOfDay,
  closeTime: zTimeOfDay,
});

/** Full weekly opening hours; days not listed are closed. Split shifts allowed. */
export const SetHoursBody = zBody({
  hours: z
    .array(HoursInterval)
    .max(28)
    .superRefine((intervals, ctx) => {
      for (const [i, h] of intervals.entries()) {
        if (h.openTime >= h.closeTime) {
          ctx.addIssue({ code: 'custom', path: [i], message: 'openTime must be before closeTime' });
        }
      }
      const byDay = new Map<number, { open: string; close: string }[]>();
      for (const h of intervals)
        byDay.set(h.dayOfWeek, [...(byDay.get(h.dayOfWeek) ?? []), { open: h.openTime, close: h.closeTime }]);
      for (const [day, list] of byDay) {
        list.sort((a, b) => a.open.localeCompare(b.open));
        for (let k = 1; k < list.length; k++) {
          if (list[k]!.open < list[k - 1]!.close) {
            ctx.addIssue({ code: 'custom', message: `overlapping hours on day ${day}` });
          }
        }
      }
    }),
});

export const ReportBody = zBody({
  reason: z.enum(['fake_business', 'wrong_information', 'inappropriate_content', 'scam_or_fraud', 'other']),
  details: zSafeText({ max: 1000 }).optional(),
});

export const AdminListQuery = zPagination.extend({
  status: z.enum(['pending', 'verified', 'suspended', 'rejected']).default('pending'),
});

export const ReasonBody = zBody({ reason: zSafeText({ min: 3, max: 1000 }) });

export const ReportListQuery = zPagination.extend({
  status: z.enum(['open', 'reviewed', 'dismissed']).default('open'),
});

export const ResolveReportBody = zBody({ status: z.enum(['reviewed', 'dismissed']) });
