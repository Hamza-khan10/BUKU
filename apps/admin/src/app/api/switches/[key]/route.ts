import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';
import { SWITCH_KEY } from '@admin/lib/switches';

const Body = z.object({
  off: z.boolean(),
  reason: z.string().trim().min(3).max(500).optional(),
});

/**
 * Turn an emergency switch off (with a reason) or back on (D-129). The API checks again that it's
 * a platform admin with two-step sign-in, records who and why, and every service obeys within
 * seconds.
 */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/switches/[key]'>) {
  const { key } = await ctx.params;
  return adminAction(request, (body) => {
    if (!SWITCH_KEY.test(key)) return refuse(404, 'NOT_FOUND', 'No such switch.');
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Say why, in 3 to 500 characters.');
    if (parsed.data.off && !parsed.data.reason)
      return refuse(400, 'VALIDATION_ERROR', 'Say why it’s being turned off.');
    return { method: 'PUT', path: `/v1/admin/switches/${key}`, body: parsed.data };
  });
}
