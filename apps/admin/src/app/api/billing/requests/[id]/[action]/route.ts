import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';
import { PLAN_CODE } from '@admin/lib/billing';

const Approve = z.object({
  planCode: z.string().regex(PLAN_CODE).optional(),
  until: z.iso.date().optional(),
  note: z.string().trim().min(3).max(500).optional(),
});
const Decline = z.object({ reason: z.string().trim().min(3).max(500) });

/**
 * A decision on a business's plan request (3.6h): approve (the plan as a grant, optionally another
 * plan, optionally free until a date) or decline with a note the business sees. The API records it.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/requests/[id]/[action]'>) {
  const { id, action } = await ctx.params;
  return adminAction(request, (body) => {
    if (!DECIMAL_ID.test(id) || (action !== 'approve' && action !== 'decline'))
      return refuse(404, 'NOT_FOUND', 'No such request or step.');
    if (action === 'decline') {
      const parsed = Decline.safeParse(body);
      if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Say why, in 3 to 500 characters.');
      return { path: `/v1/admin/billing/plan-requests/${id}/decline`, body: { note: parsed.data.reason } };
    }
    const parsed = Approve.safeParse(body ?? {});
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Check the plan, the date and the note.');
    const { planCode, until, note } = parsed.data;
    return {
      path: `/v1/admin/billing/plan-requests/${id}/approve`,
      body: {
        ...(planCode && { planCode }),
        // Free until the end of that day, UTC.
        ...(until && { until: `${until}T23:59:59Z` }),
        ...(note && { note }),
      },
    };
  });
}
