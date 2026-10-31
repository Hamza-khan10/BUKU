import type { NextRequest } from 'next/server';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';

/**
 * One person's recent activity (3.6f): what they did and what was done to their account. Asked for
 * from the account card (so it's a POST here, a read at the API); the API records that it was opened.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/accounts/[id]/audit'>) {
  const { id } = await ctx.params;
  return adminAction(request, () => {
    if (!PUBLIC_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such account.');
    return { method: 'GET', path: `/v1/admin/accounts/${id}/audit` };
  });
}
