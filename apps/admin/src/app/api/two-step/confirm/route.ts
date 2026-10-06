import { takeSession } from '@buku/web-security/session-policy';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { currentAccess } from '@admin/lib/access';
import { ownPageCall, smallJson } from '@admin/lib/endpoint';
import { callApi } from '@admin/lib/gateway';
import { errorJson, json } from '@admin/lib/respond';
import { setSession } from '@admin/lib/session';

const Body = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6 digits your app shows for BUKU.') });

/**
 * The app works: two-step sign-in is on. The API answers with the recovery
 * codes (shown once) and a session that has passed two-step sign-in, which
 * replaces this browser's cookies.
 */
export async function POST(request: NextRequest) {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  const access = await currentAccess(request, requestId);
  if (!access) return errorJson(requestId, 401, 'NOT_SIGNED_IN', 'Please sign in again.');
  const parsed = Body.safeParse(await smallJson(request));
  if (!parsed.success)
    return errorJson(
      requestId,
      400,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Check the code.',
    );

  const confirmed = await callApi({
    method: 'POST',
    path: '/v1/auth/mfa/confirm',
    body: parsed.data,
    accessToken: access.accessToken,
    incoming: request.headers,
    requestId,
  });
  if (!confirmed.ok)
    return errorJson(requestId, confirmed.status, confirmed.error.code, confirmed.error.message);
  const { tokens, data } = takeSession(confirmed.data);
  const response = json(requestId, {
    recoveryCodes: (data as { recoveryCodes?: string[] }).recoveryCodes ?? [],
  });
  if (tokens) setSession(response, tokens);
  else if (access.renewed) setSession(response, access.renewed);
  return response;
}
