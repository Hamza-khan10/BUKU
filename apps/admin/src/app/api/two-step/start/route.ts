import type { NextRequest } from 'next/server';
import { currentAccess, isPlatformAdmin } from '@admin/lib/access';
import { ownPageCall } from '@admin/lib/endpoint';
import { callApi } from '@admin/lib/gateway';
import { errorJson, json } from '@admin/lib/respond';
import { setSession } from '@admin/lib/session';

/** Start setting up two-step sign-in: a new secret for the authenticator app. */
export async function POST(request: NextRequest) {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  const access = await currentAccess(request, requestId);
  if (!access) return errorJson(requestId, 401, 'NOT_SIGNED_IN', 'Please sign in again.');
  if (!(await isPlatformAdmin(access.accessToken, request, requestId))) {
    return errorJson(requestId, 403, 'NOT_ADMIN', 'This account isn’t a BUKU platform admin.');
  }
  const setup = await callApi<{ secret: string; otpauthUri: string }>({
    method: 'POST',
    path: '/v1/auth/mfa/setup',
    accessToken: access.accessToken,
    incoming: request.headers,
    requestId,
  });
  if (!setup.ok) return errorJson(requestId, setup.status, setup.error.code, setup.error.message);
  const response = json(requestId, setup.data);
  if (access.renewed) setSession(response, access.renewed);
  return response;
}
