import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, refuse } from '@admin/lib/admin-action';

const Body = z.object({
  taxPercent: z.number().min(0).max(100).optional(),
  subscribers: z
    .record(z.string().regex(/^[1-9][0-9]{0,18}$/), z.number().int().min(0).max(100_000_000))
    .optional(),
});

/** The economics for these assumptions (3.6j): a calculation, nothing changes. */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body ?? {});
    if (!parsed.success)
      return refuse(400, 'VALIDATION_ERROR', 'Tax from 0 to 100%, and whole numbers of subscribers.');
    return { path: '/v1/admin/billing/economics', body: parsed.data };
  });
}
