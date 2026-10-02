import { zBody, zPagination, zSafeText, zUuid } from '@buku/common';
import { z } from 'zod';

/** Request contracts for billing-service (source for docs/API_REFERENCE.md). */

const zAudience = z.enum(['user', 'business']);
const zChannel = z.enum(['web', 'android', 'ios']);
const zCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'a 3-letter currency code');
const zPlanCode = z.string().regex(/^[a-z][a-z0-9_]{1,49}$/, 'lowercase letters, digits and _');
/** A count, or null for unlimited. */
const zLimit = z.number().int().min(0).max(1_000_000).nullable();

export const PricingQuery = z.object({
  audience: zAudience,
  channel: zChannel.default('web'),
  currency: zCurrency.default('USD'),
});

export const IdParams = z.object({ id: zUuid });
export const CodeParams = z.object({ code: zPlanCode });
export const AudienceParams = z.object({ audience: zAudience });
export const ChannelParams = z.object({ channel: zChannel });

const planFields = {
  name: zSafeText({ min: 1, max: 100 }),
  tagline: zSafeText({ max: 200 }).nullable().optional(),
  benefits: z
    .array(zSafeText({ min: 1, max: 200 }))
    .max(20)
    .optional(),
  limits: z.record(z.string(), zLimit).optional(),
  features: z.record(z.string(), z.boolean()).optional(),
  isPublic: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
};

export const CreatePlanBody = zBody({ code: zPlanCode, audience: zAudience, ...planFields });
export const UpdatePlanBody = zBody(planFields)
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

export const PriceBody = zBody({
  channel: zChannel,
  currency: zCurrency.default('USD'),
  amount: z.number().min(0).max(100_000).multipleOf(0.01),
  interval: z.enum(['month', 'year']).default('month'),
  taxInclusive: z.boolean().optional(),
  trialDays: z.number().int().min(0).max(365).optional(),
  externalPriceId: z.string().trim().min(1).max(200).optional(),
});

export const ExternalIdBody = zBody({ externalPriceId: z.string().trim().min(1).max(200).nullable() });

export const SettingsBody = zBody({
  enabled: z.boolean().optional(),
  defaultPlanCode: zPlanCode.optional(),
  planWhenDisabledCode: zPlanCode.optional(),
  /** Free trial: on/off, length, and which plan it gives (null → no trials). */
  trialEnabled: z.boolean().optional(),
  trialDays: z.number().int().min(1).max(365).optional(),
  trialPlanCode: zPlanCode.nullable().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

const zMoney = z.number().min(0).max(10_000_000).multipleOf(0.01);
const zCategory = z.enum(['infrastructure', 'messaging', 'software', 'other']);

export const CostBody = zBody({
  name: zSafeText({ min: 1, max: 100 }),
  category: zCategory,
  monthlyAmount: zMoney,
  notes: zSafeText({ max: 300 }).optional(),
});
export const UpdateCostBody = zBody({
  name: zSafeText({ min: 1, max: 100 }).optional(),
  category: zCategory.optional(),
  monthlyAmount: zMoney.optional(),
  notes: zSafeText({ max: 300 }).nullable().optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');

export const FeeBody = zBody({
  percent: z.number().min(0).max(100).multipleOf(0.01),
  fixedAmount: zMoney.default(0),
  notes: zSafeText({ max: 300 }).optional(),
});

export const EconomicsBody = zBody({
  taxPercent: z.number().min(0).max(100).optional(),
  /** "What if": subscribers per price id (others use the real count). */
  subscribers: z.record(zUuid, z.number().int().min(0).max(100_000_000)).optional(),
});

export const GrantBody = zBody({
  planCode: zPlanCode,
  userId: zUuid.optional(),
  businessId: zUuid.optional(),
  /** Until when (ISO date-time); leave out for open-ended. */
  until: z.iso.datetime({ offset: true }).optional(),
  note: zSafeText({ min: 3, max: 300 }),
  /** End the account's current grant or trial and give this plan instead. */
  replace: z.boolean().optional(),
}).refine((b) => Boolean(b.userId) !== Boolean(b.businessId), 'give exactly one of userId or businessId');

export const EndBody = zBody({ reason: zSafeText({ min: 3, max: 300 }) });

export const SubscriptionsQuery = zPagination.extend({
  planCode: zPlanCode.optional(),
  status: z.enum(['active', 'trialing', 'past_due', 'paused', 'cancelled']).optional(),
});

export const BusinessRequestParams = z.object({ id: zUuid, requestId: zUuid });

export const PlanRequestBody = zBody({
  planCode: zPlanCode,
  /** Who they are and why — e.g. "Hospital group, 14 branches, 300 staff". */
  message: zSafeText({ min: 10, max: 1000 }),
});

export const RequestsQuery = z.object({
  status: z.enum(['pending', 'approved', 'declined', 'withdrawn']).optional(),
});

export const ApproveBody = zBody({
  /** Free until (leave out for open-ended). */
  until: z.iso.datetime({ offset: true }).optional(),
  note: zSafeText({ min: 3, max: 500 }).optional(),
  /** Give a different plan than the one asked for. */
  planCode: zPlanCode.optional(),
});

export const DeclineBody = zBody({ note: zSafeText({ min: 3, max: 500 }) });
