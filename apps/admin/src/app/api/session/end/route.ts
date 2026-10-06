import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import { NextResponse, type NextRequest } from 'next/server';
import { callApi } from '@admin/lib/gateway';
import { clearSession, readTokens } from '@admin/lib/session';

/**
 * An account that isn't (or no longer is) a platform admin reached a page: its
 * session here ends, at the API too. Only from this app's own redirect (never a
 * link on another site, which would only sign someone out).
 */
export async function GET(request: NextRequest) {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') {
    return NextResponse.redirect(new URL('/', request.url), 303);
  }
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
  const response = NextResponse.redirect(new URL('/signin?error=not-admin', request.url), 303);
  clearSession(response);
  return response;
}
