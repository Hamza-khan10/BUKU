import type { NextRequest } from 'next/server';
import { adminAction, refuse } from '@admin/lib/admin-action';

/** No more Enterprise quotes in one currency (D-151): its rate card goes; deals keep their prices. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/billing/enterprise/rate-card/[currency]/clear'>,
) {
  const { currency } = await ctx.params;
  return adminAction(request, () => {
    if (!/^[A-Z]{3}$/.test(currency)) return refuse(404, 'NOT_FOUND', 'No such currency.');
    return { method: 'DELETE', path: `/v1/admin/billing/enterprise/rate-card/${currency}` };
  });
}
