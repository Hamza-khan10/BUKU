import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import type { SessionTokens } from '@buku/web-security/session-policy';
import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from '@admin/lib/gateway';
import { safeNext } from '@admin/lib/next-path';
import { clearSession, readTokens, setSession } from '@admin/lib/session';

/**
 * A page found the access token lapsed: renew it with the refresh token (which
 * only ever reaches /api) and go back. If the session is over, sign in again.
 */
export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const next = safeNext(request.nextUrl.searchParams.get('next'));
  const { refreshToken } = readTokens(request.cookies);
  const renewed = refreshToken
    ? await callApi<SessionTokens>({
        method: 'POST',
        path: '/v1/auth/refresh',
        body: { refreshToken },
        incoming: request.headers,
        requestId,
      })
    : null;
  if (renewed?.ok) {
    const response = NextResponse.redirect(new URL(next, request.url), 303);
    setSession(response, renewed.data);
    return response;
  }
  const response = NextResponse.redirect(new URL('/signin', request.url), 303);
  clearSession(response);
  return response;
}
