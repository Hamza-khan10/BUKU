import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';
import { PLAN_CODE } from '@admin/lib/billing';

const Price = z.object({
  channel: z.enum(['web', 'ios', 'android']),
  amount: z.number().min(0).max(100_000).multipleOf(0.01),
  interval: z.enum(['month', 'year']).default('month'),
});

/**
 * A plan (3.6i): stop selling it, sell it again, or give it a new price on one channel (new
 * customers pay it; subscribers keep the price they agreed to). The API records each change.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/plans/[code]/[action]'>) {
  const { code, action } = await ctx.params;
  return adminAction(request, (body) => {
    if (!PLAN_CODE.test(code)) return refuse(404, 'NOT_FOUND', 'No such plan.');
    if (action === 'archive' || action === 'restore')
      return { path: `/v1/admin/billing/plans/${code}/${action}` };
    if (action !== 'prices') return refuse(404, 'NOT_FOUND', 'No such step.');
    const parsed = Price.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Choose where it’s sold and an amount up to 100,000 with at most 2 decimals.',
      );
    return { path: `/v1/admin/billing/plans/${code}/prices`, body: parsed.data };
  });
}
