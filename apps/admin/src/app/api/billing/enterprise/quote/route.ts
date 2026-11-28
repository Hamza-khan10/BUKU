import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Body = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  branches: z.number().int().min(1).max(100_000),
  term: z.enum(['month', 'year', 'two_years']),
  askedDiscountPercent: z.number().min(0).max(100).multipleOf(0.01).optional(),
});

/** What a chain would pay (D-151): worked out by the API from the rate card, nothing saved. */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Give the number of branches, how often they pay and any discount asked.',
      );
    return { path: '/v1/admin/billing/enterprise/quote', body: parsed.data };
  });
}
