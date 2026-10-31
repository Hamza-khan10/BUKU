import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { adminAction, PUBLIC_ID, refuse } from '@admin/lib/admin-action';

const Body = z.object({ query: z.string().trim().min(1).max(254) });

/**
 * Find one person's account by email or account ID (3.6). Sent in the body, so an email never sits
 * in a URL, the browser's history or a log. The API records every look.
 */
export async function POST(request: NextRequest) {
  return adminAction(request, (body) => {
    const parsed = Body.safeParse(body);
    if (!parsed.success) return refuse(400, 'VALIDATION_ERROR', 'Type an email or an account ID.');
    const { query } = parsed.data;
    if (query.includes('@')) return { path: '/v1/admin/accounts/find', body: { email: query } };
    if (PUBLIC_ID.test(query)) return { path: '/v1/admin/accounts/find', body: { id: query } };
    return refuse(
      400,
      'VALIDATION_ERROR',
      'That’s neither an email nor an account ID (12 letters and digits).',
    );
  });
}
