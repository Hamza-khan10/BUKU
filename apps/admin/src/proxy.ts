import { buildCsp, newNonce } from '@buku/web-security/csp';
import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Runs before every page (not /api or static files):
 *  • a fresh nonce and the strictest Content-Security-Policy built on it: no
 *    pictures, media or connections to anywhere but this app;
 *  • a request id that follows the request into the API's logs;
 *  • signed-out visitors go to sign in (a convenience: every page asks the API,
 *    and the API refuses anyone without a valid admin session anyway).
 */

const PUBLIC = ['/signin'];
const SESSION_HINTS = ['__Host-buku_admin_s', 'buku_admin_s'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const open = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!open && !SESSION_HINTS.some((name) => request.cookies.has(name))) {
    return NextResponse.redirect(new URL('/signin', request.url));
  }

  const nonce = newNonce();
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === 'development' });
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const headers = new Headers(request.headers);
  headers.set('x-nonce', nonce);
  headers.set('content-security-policy', csp);
  headers.set(REQUEST_ID_HEADER, requestId);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set('content-security-policy', csp);
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

export const config = {
  matcher: [
    {
      source: '/((?!api/|_next/static|_next/image|favicon.ico|icon).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
