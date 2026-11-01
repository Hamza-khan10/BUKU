import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

const Body = z.object({ reason: z.string().trim().min(3).max(300) });

/**
 * End a subscription now (3.6h): a grant or trial here; a paid one is cancelled in Paddle at once.
 * Says why; the API records it.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/subscriptions/[id]/end'>) {
  const { id } = await ctx.params;
  return adminAction(request, (body) => {
    if (!DECIMAL_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such subscription.');
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Say why, in 3 to 300 characters.');
    return { path: `/v1/admin/billing/subscriptions/${id}/end`, body: parsed.data };
  });
}
