import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Body = z.object({
  name: z.string().trim().min(1).max(100),
  category: z.enum(['infrastructure', 'messaging', 'software', 'other']),
  monthlyAmount: z.number().min(0).max(10_000_000).multipleOf(0.01),
  notes: z.string().trim().max(300).optional(),
});

/** A monthly running cost, in US dollars (3.6j), for the economics. The API records it. */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success)
      return refuse(
        400,
        'VALIDATION_ERROR',
        'Give a name, a kind and a monthly amount (2 decimals at most).',
      );
    const { notes, ...rest } = parsed.data;
    return { path: '/v1/admin/billing/costs', body: { ...rest, ...(notes && { notes }) } };
  });
}
