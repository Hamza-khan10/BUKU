import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

const Body = z.object({ status: z.enum(['reviewed', 'dismissed']) });

/** Close a report about a business: looked into (reviewed) or not a problem (dismissed). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/reports/[id]/resolve'>) {
  const { id } = await ctx.params;
  return adminAction(request, (body) => {
    if (!DECIMAL_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such report.');
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Choose reviewed or dismissed.');
    return { path: `/v1/admin/business-reports/${id}/resolve`, body: parsed.data };
  });
}
