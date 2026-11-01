import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Body = z
  .object({
    emailEnabled: z.boolean(),
    whatsappEnabled: z.boolean(),
    whatsappPaidTypes: z.array(z.string().regex(/^[a-z0-9_]{1,50}$/)).max(20),
    whatsappMonthlyBudgetCents: z.number().int().min(0).max(100_000_000),
    whatsappMessageCostCents: z.number().min(0).max(1000),
    whatsappFreeWindowPerMonth: z.number().int().min(0).max(10_000_000),
    reminder24h: z.boolean(),
    reminder2h: z.boolean(),
    quietStartHour: z.number().int().min(0).max(23),
    quietEndHour: z.number().int().min(0).max(23),
    suggestionsEnabled: z.boolean(),
    suggestionMinDays: z.number().int().min(0).max(365),
    suggestionMaxPer30Days: z.number().int().min(0).max(30),
    suggestionMaxIgnored: z.number().int().min(0).max(100),
  })
  .partial()
  .refine((b) => Object.values(b).some((v) => v !== undefined));

/**
 * How BUKU tells people things (3.6k): email and WhatsApp on or off, what WhatsApp may cost,
 * reminders, quiet hours, suggestions. Applies within 30 seconds; the API records old and new.
 */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Check the numbers: hours 0–23, amounts and counts within range.',
      );
    return { method: 'PUT', path: '/v1/admin/notifications/settings', body: parsed.data };
  });
}
