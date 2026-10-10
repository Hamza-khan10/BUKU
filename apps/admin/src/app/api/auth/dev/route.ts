import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ownPageCall, smallJson } from '@admin/lib/endpoint';
import { devSignInEnabled } from '@admin/lib/env';
import { callApi } from '@admin/lib/gateway';
import { errorJson } from '@admin/lib/respond';
import { finishSignIn } from '@admin/lib/sign-in';

const Body = z.object({
  email: z.email({ message: 'Please enter an email address like name@example.com.' }).max(254),
  name: z.string().trim().max(100).optional(),
});

/**
 * Development sign-in as a platform admin (any email; never on the live site).
 * A new account is created as an admin; an existing account keeps its role, so
 * a customer's account is refused here.
 */
export async function POST(request: NextRequest) {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  if (!devSignInEnabled()) return errorJson(requestId, 404, 'NOT_FOUND', 'We couldn’t find that.');

  const parsed = Body.safeParse(await smallJson(request));
  if (!parsed.success) {
    return errorJson(
      requestId,
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the form.',
    );
  }
  const answer = await callApi({
    method: 'POST',
    path: '/v1/auth/dev/login',
    body: {
      email: parsed.data.email,
      ...(parsed.data.name && { name: parsed.data.name }),
      role: 'super_admin',
      device: { name: 'BUKU admin app', platform: 'web' },
    },
    incoming: request.headers,
    requestId,
  });
  if (!answer.ok)
    return errorJson(requestId, answer.status, answer.error.code, answer.error.message, answer.error.details);
  return finishSignIn(answer.data, { incoming: request.headers, requestId });
}
