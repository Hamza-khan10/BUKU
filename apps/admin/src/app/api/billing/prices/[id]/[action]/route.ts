import type { NextRequest } from 'next/server';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

/**
 * A price (3.6i): stop selling it on its channel, or create it in Paddle (the plan's product and
 * this price) and link it. The API records each change.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/prices/[id]/[action]'>) {
  const { id, action } = await ctx.params;
  return adminAction(request, () => {
    if (!DECIMAL_ID.test(id) || (action !== 'archive' && action !== 'sync-paddle'))
      return refuse(404, 'NOT_FOUND', 'No such price or step.');
    return { path: `/v1/admin/billing/prices/${id}/${action}` };
  });
}
