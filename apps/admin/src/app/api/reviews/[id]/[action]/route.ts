import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

const ACTIONS = ['hide', 'keep', 'restore'] as const;
const Body = z.object({ reason: z.string().trim().min(3).max(300).optional() });

/**
 * A decision on a review (3.6g): hide it (it stays stored, stops showing and counting; why is
 * kept), keep it (the report is closed), or put a hidden one back. The API records it.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/reviews/[id]/[action]'>) {
  const { id, action } = await ctx.params;
  return adminAction(request, (body) => {
    const step = ACTIONS.find((a) => a === action);
    if (!DECIMAL_ID.test(id) || !step) return refuse(404, 'NOT_FOUND', 'No such review or step.');
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Say why, in 3 to 300 characters.');
    if (step === 'hide' && !parsed.data.reason)
      return refuse(400, 'VALIDATION_ERROR', 'Say why it’s hidden.');
    return {
      path: `/v1/admin/reviews/${id}/decision`,
      body: step === 'hide' ? { action: 'hide', reason: parsed.data.reason } : { action: step },
    };
  });
}
