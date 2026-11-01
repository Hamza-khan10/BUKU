import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';
import { PLAN_CODE } from '@admin/lib/billing';

const Body = z.object({
  businessId: z.string().regex(PUBLIC_ID),
  planCode: z.string().regex(PLAN_CODE),
  until: z.iso.date().optional(),
  reason: z.string().trim().min(3).max(300),
  replace: z.boolean().optional(),
});

/** Give a business a plan free of charge (3.6h), optionally until a date. The API records it. */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(400, 'VALIDATION_ERROR', 'Give the business’s ID, a plan and why (3 to 300 characters).');
    const { businessId, planCode, until, reason, replace } = parsed.data;
    return {
      path: '/v1/admin/billing/grants',
      body: {
        businessId,
        planCode,
        note: reason,
        ...(until && { until: `${until}T23:59:59Z` }),
        ...(replace && { replace }),
      },
    };
  });
}
