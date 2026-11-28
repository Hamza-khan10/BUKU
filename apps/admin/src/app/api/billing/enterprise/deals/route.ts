import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';

const Day = z.iso.date();
const Body = z.object({
  businessId: z.string().regex(PUBLIC_ID),
  name: z.string().trim().min(2).max(160),
  currency: z.string().regex(/^[A-Z]{3}$/),
  term: z.enum(['month', 'year', 'two_years']),
  pricePerBranch: z.number().min(0).max(10_000_000).multipleOf(0.01),
  startsOn: Day,
  endsOn: Day.optional(),
  notes: z.string().trim().max(500).optional(),
});

/** A deal agreed with an Enterprise chain (D-151). The API records it. */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Give a branch’s ID (12 letters and digits), the chain’s name, the price a branch and the start date.',
      );
    const { endsOn, notes, ...rest } = parsed.data;
    return {
      path: '/v1/admin/billing/enterprise/deals',
      body: { ...rest, ...(endsOn && { endsOn }), ...(notes && { notes }) },
    };
  });
}
