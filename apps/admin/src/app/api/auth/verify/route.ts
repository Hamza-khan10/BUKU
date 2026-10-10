import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ownPageCall, smallJson } from '@admin/lib/endpoint';
import { callApi } from '@admin/lib/gateway';
import { errorJson } from '@admin/lib/respond';
import { readChallenge } from '@admin/lib/session';
import { finishSignIn } from '@admin/lib/sign-in';

const Body = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6 digits from your authenticator app.') }),
  z.object({ recoveryCode: z.string().trim().min(8).max(20) }),
]);

/** The second step of signing in: the challenge (an HttpOnly cookie) and the code. */
export async function POST(request: NextRequest) {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  const challenge = readChallenge(request.cookies);
  if (!challenge)
    return errorJson(requestId, 401, 'SIGN_IN_EXPIRED', 'This sign-in has expired. Please start again.');
  const parsed = Body.safeParse(await smallJson(request));
  if (!parsed.success)
    return errorJson(
      requestId,
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the code.',
    );

  const answer = await callApi({
    method: 'POST',
    path: '/v1/auth/mfa/verify',
    body: { mfaToken: challenge.token, ...parsed.data },
    incoming: request.headers,
    requestId,
  });
  if (!answer.ok)
    return errorJson(requestId, answer.status, answer.error.code, answer.error.message, answer.error.details);
  return finishSignIn(answer.data, { incoming: request.headers, requestId });
}
