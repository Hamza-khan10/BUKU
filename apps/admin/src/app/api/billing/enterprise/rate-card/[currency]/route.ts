import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Amount = z.number().min(0).max(10_000_000).multipleOf(0.01);
const Percent = z.number().min(0).max(100).multipleOf(0.01);
const Branches = z.number().int().min(2).max(100_000);
const Body = z.object({
  tiers: z
    .array(z.object({ fromBranches: Branches, price: Amount, floor: Amount }))
    .min(1)
    .max(12),
  terms: z.object({
    costPerBranch: Amount,
    yearlyDiscountPercent: Percent,
    twoYearDiscountPercent: Percent,
    askedDiscountPercent: Percent,
    askedDiscountFromBranches: Branches,
    withholdingPercent: Percent,
  }),
});

/** Enterprise's rate card in one currency (D-151): its tiers replaced and its terms set. */
export async function POST(
  request: NextRequest,
  ctx: RouteContext<'/api/billing/enterprise/rate-card/[currency]'>,
) {
  const { currency } = await ctx.params;
  return adminAction(request, (body) => {
    if (!/^[A-Z]{3}$/.test(currency)) return refuse(404, 'NOT_FOUND', 'No such currency.');
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Each tier needs where it starts (2 branches or more), a price and a floor; percentages from 0 to 100.',
      );
    return { method: 'PUT', path: `/v1/admin/billing/enterprise/rate-card/${currency}`, body: parsed.data };
  });
}
