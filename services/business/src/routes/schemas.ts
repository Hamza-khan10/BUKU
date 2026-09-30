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
import { DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_PHOTO_BYTES, PHOTO_TYPES } from '../storage/file-types.js';

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

// ── Legal profile (KYB) ────────────────────────────────────────────────────

/** Registration numbers vary by country; allow the usual characters only. */
const zIdentifier = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9 .\-/]+$/, 'may contain letters, digits, spaces, "-", "." and "/" only');

export const LegalProfileBody = zBody({
  legalName: zSafeText({ min: 2, max: 300 }),
  registrationCountry: zCountryCode,
  /** Free text per country, e.g. "NTN", "SECP company", "Companies House", "EIN". */
  registrationType: zSafeText({ min: 2, max: 100 }),
  registrationNumber: zIdentifier,
  taxId: zIdentifier.optional(),
  registeredAddress: zSafeText({ min: 5, max: 500 }),
  responsiblePerson: z.strictObject({
    name: zSafeText({ min: 2, max: 200 }),
    role: zSafeText({ min: 2, max: 100 }),
    email: zEmail.optional(),
    phone: zPhone.optional(),
  }),
});

// ── Uploads ────────────────────────────────────────────────────────────────

export const DocumentUploadBody = zBody({
  type: z.enum([
    'business_license',
    'medical_license',
    'id_proof',
    'address_proof',
    'tax_certificate',
    'other',
  ]),
  contentType: z.enum(DOCUMENT_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
});

export const PhotoUploadBody = zBody({
  contentType: z.enum(PHOTO_TYPES),
  sizeBytes: z.number().int().min(1).max(MAX_PHOTO_BYTES),
  altText: zSafeText({ max: 300 }).optional(),
});

export const DocumentParams = z.object({ id: zUuid, documentId: zUuid });
export const PhotoParams = z.object({ id: zUuid, photoId: zUuid });

// ── Admin ──────────────────────────────────────────────────────────────────

export const ReviewDocumentBody = zBody({
  decision: z.enum(['approved', 'rejected']),
  note: zSafeText({ max: 1000 }).optional(),
});

export const ExportBody = zBody({
  country: zCountryCode,
  /** The official request's reference number (e.g. a regulator's letter id). */
  reference: zSafeText({ min: 3, max: 100 }),
  /** Why this disclosure is lawful. Recorded in the audit log. */
  legalBasis: zSafeText({ min: 10, max: 1000 }),
});
