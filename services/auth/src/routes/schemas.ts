import { zBody, zEmail, zPhone, zSafeText, zTimezone } from '@buku/common';
import { z } from 'zod';

/** Request/response contracts for auth-service. Also the source for docs/API_REFERENCE.md. */

export const zLocale = z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/, 'must look like "en" or "en-PK"');

export const DeviceSchema = z.strictObject({
  name: zSafeText({ min: 1, max: 100 }).optional(),
  platform: z.enum(['ios', 'android', 'web']).optional(),
});

export const OAuthSignInBody = zBody({
  idToken: z.string().min(20).max(8192),
  /** Required for NEW accounts: the Terms/Privacy version the user agreed to. */
  acceptedTermsVersion: z.string().max(20).optional(),
  /** Set after the user chose "Restore my account" (sign-in during the deletion grace period). */
  restoreAccount: z.boolean().optional(),
  device: DeviceSchema.optional(),
  timezone: zTimezone.optional(),
  locale: zLocale.optional(),
});

export const DevSignInBody = zBody({
  email: zEmail,
  name: zSafeText({ min: 1, max: 200 }).optional(),
  role: z.enum(['user', 'business_owner', 'super_admin']).default('user'),
  device: DeviceSchema.optional(),
});

export const RefreshTokenBody = zBody({
  refreshToken: z.string().min(20).max(200),
});

export const SessionIdParams = z.object({ id: z.uuid() });

export const UpdateMeBody = zBody({
  name: zSafeText({ min: 1, max: 200 }).optional(),
  timezone: zTimezone.optional(),
  locale: zLocale.optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

export const SetPhoneBody = zBody({
  phone: zPhone,
  /** Explicit consent to receive WhatsApp notifications (WhatsApp Business policy). */
  whatsappOptIn: z.boolean(),
});

export const PushTokenBody = zBody({
  token: z.string().min(10).max(4096),
  platform: z.enum(['ios', 'android', 'web']),
});

export const PushTokenParams = z.object({ token: z.string().min(10).max(4096) });

export const DeleteAccountBody = zBody({
  /** Typed confirmation, so a stray request can't delete an account. */
  confirmation: z.literal('DELETE'),
  /** Optional feedback: why the person is leaving. */
  reason: zSafeText({ max: 500 }).optional(),
});
