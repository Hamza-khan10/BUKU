import type { NextRequest } from 'next/server';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

/** A deal ended: out of the month's revenue, kept for the record. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/billing/enterprise/deals/[id]/end'>,
) {
  const { id } = await ctx.params;
  return adminAction(request, () => {
    if (!DECIMAL_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such deal.');
    return { path: `/v1/admin/billing/enterprise/deals/${id}/end` };
  });
}
