import type { NextRequest } from 'next/server';
import { ownPageCall } from '@admin/lib/endpoint';
import { callApi } from '@admin/lib/gateway';
import { json } from '@admin/lib/respond';
import { clearSession, readTokens } from '@admin/lib/session';

/** Sign out of this browser: the session ends at the API too. */
export async function POST(request: NextRequest) {
  const start = ownPageCall(request);
  if ('refusal' in start) return start.refusal;
  const { requestId } = start;
  const { refreshToken } = readTokens(request.cookies);
  if (refreshToken) {
    await callApi({
      method: 'POST',
      path: '/v1/auth/logout',
      body: { refreshToken },
      incoming: request.headers,
      requestId,
    });
  }
  const response = json(requestId, { next: '/signin' });
  clearSession(response);
  return response;
}
