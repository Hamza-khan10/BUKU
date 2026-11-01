import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';
import { PLAN_CODE } from '@admin/lib/billing';

const Body = z
  .object({
    enabled: z.boolean().optional(),
    defaultPlanCode: z.string().regex(PLAN_CODE).optional(),
    planWhenDisabledCode: z.string().regex(PLAN_CODE).optional(),
    trialEnabled: z.boolean().optional(),
    trialDays: z.number().int().min(1).max(365).optional(),
    trialPlanCode: z.string().regex(PLAN_CODE).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined));

/**
 * Billing's settings for businesses (3.6i): charging on or off, the plans they fall back to, the
 * free trial. Customers are free (D-101): the API refuses turning charging on for them.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/settings/[audience]'>) {
  const { audience } = await ctx.params;
  return adminAction(request, (body) => {
    if (audience !== 'business' && audience !== 'user') return refuse(404, 'NOT_FOUND', 'No such audience.');
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(400, 'VALIDATION_ERROR', 'Check the plans and the trial’s length (1 to 365 days).');
    return { method: 'PUT', path: `/v1/admin/billing/settings/${audience}`, body: parsed.data };
  });
}
