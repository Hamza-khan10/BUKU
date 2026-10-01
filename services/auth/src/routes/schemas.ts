import { MEMBER_ROLES, zBody, zEmail, zPassword, zPhone, zSafeText, zTimezone } from '@buku/common';
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

// ── Employee accounts (D-034) ────────────────────────────────────────────

export const zUsername = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{2,39}$/, 'must be 3–40 characters: letters, digits, ".", "_" or "-"');

export const BusinessSignInBody = zBody({
  /** The business's handle (the slug in its BUKU link). */
  business: z.string().trim().toLowerCase().min(1).max(120),
  username: zUsername,
  password: z.string().min(1).max(256),
  device: DeviceSchema.optional(),
});

export const ChangePasswordBody = zBody({
  currentPassword: z.string().min(1).max(256),
  newPassword: zPassword,
});

export const BusinessParams = z.object({ businessId: z.uuid() });
export const MemberParams = z.object({ businessId: z.uuid(), memberId: z.uuid() });

export const CreateMemberBody = zBody({
  name: zSafeText({ min: 1, max: 100 }),
  username: zUsername,
  role: z.enum(MEMBER_ROLES),
});

export const UpdateMemberBody = zBody({
  name: zSafeText({ min: 1, max: 100 }).optional(),
  role: z.enum(MEMBER_ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');
