import type { NextRequest } from 'next/server';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

/** Remove a running cost (3.6j). The API records it. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/costs/[id]'>) {
  const { id } = await ctx.params;
  return adminAction(request, () => {
    if (!DECIMAL_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such cost.');
    return { method: 'DELETE', path: `/v1/admin/billing/costs/${id}` };
  });
}
