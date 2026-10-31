import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';

const ACTIONS = ['suspend', 'reinstate', 'end-sessions'] as const;
const Body = z.object({ reason: z.string().trim().min(3).max(500).optional() });

/**
 * A step on one person's account (3.6): suspend (signed out everywhere, can't sign in), reinstate,
 * or end their sessions. Suspending and signing out say why; the API records it and refuses
 * platform admins and the admin's own account.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/accounts/[id]/[action]'>) {
  const { id, action } = await ctx.params;
  return adminAction(request, (body) => {
    const step = ACTIONS.find((a) => a === action);
    if (!PUBLIC_ID.test(id) || !step) return refuse(404, 'NOT_FOUND', 'No such account or step.');
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Say why, in 3 to 500 characters.');
    if (step !== 'reinstate' && !parsed.data.reason)
      return refuse(400, 'VALIDATION_ERROR', 'Say why: the record keeps it.');
    return { path: `/v1/admin/accounts/${id}/${step}`, body: parsed.data };
  });
}
