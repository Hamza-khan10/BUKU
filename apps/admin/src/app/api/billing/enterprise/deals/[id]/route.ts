import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, DECIMAL_ID, refuse } from '@admin/lib/admin-action';

const Body = z
  .object({
    term: z.enum(['month', 'year', 'two_years']).optional(),
    pricePerBranch: z.number().min(0).max(10_000_000).multipleOf(0.01).optional(),
    endsOn: z.iso.date().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined));

/** A live deal changed: a new price a branch after quoting again, how often they pay, its end. */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/billing/enterprise/deals/[id]'>) {
  const { id } = await ctx.params;
  return adminAction(request, (body) => {
    if (!DECIMAL_ID.test(id)) return refuse(404, 'NOT_FOUND', 'No such deal.');
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(400, 'VALIDATION_ERROR', 'Change the price, how often they pay or the end date.');
    return { method: 'PATCH', path: `/v1/admin/billing/enterprise/deals/${id}`, body: parsed.data };
  });
}
