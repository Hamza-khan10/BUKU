import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Body = z.object({
  percent: z.number().min(0).max(100).multipleOf(0.01),
  fixedAmount: z.number().min(0).max(10_000_000).multipleOf(0.01),
});

/** What a channel keeps of each payment (3.6j): a percentage and a fixed amount. Recorded by the API. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/fees/[channel]'>) {
  const { channel } = await ctx.params;
  return adminAction(request, (body) => {
    if (channel !== 'web' && channel !== 'ios' && channel !== 'android')
      return refuse(404, 'NOT_FOUND', 'No such channel.');
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'A percentage from 0 to 100 and a fixed amount, 2 decimals at most.',
      );
    return { method: 'PUT', path: `/v1/admin/billing/fees/${channel}`, body: parsed.data };
  });
}
