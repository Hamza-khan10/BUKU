import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';

const ACTIONS = ['verify', 'reject', 'suspend', 'reinstate'] as const;
/** Rejecting and suspending say why (the owner is told); the API's own limits. */
const Reason = z.object({ reason: z.string().trim().min(3, 'Say why, in a few words.').max(1000) });

/** Verify, reject, suspend or reinstate a business (3.6b). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/businesses/[id]/[action]'>) {
  const { id, action } = await ctx.params;
  return adminAction(request, (body) => {
    if (!PUBLIC_ID.test(id) || !(ACTIONS as readonly string[]).includes(action))
      return refuse(404, 'NOT_FOUND', 'No such action.');
    if (action !== 'reject' && action !== 'suspend') return { path: `/v1/admin/businesses/${id}/${action}` };
    const parsed = Reason.safeParse(body);
    if (!parsed.success)
      return refuse(400, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Say why.');
    return { path: `/v1/admin/businesses/${id}/${action}`, body: parsed.data };
  });
}
