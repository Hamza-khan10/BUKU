import { NextResponse, type NextRequest } from 'next/server';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { buildCsp, newNonce, originOnly } from '@/lib/security/csp';

/**
 * Runs before every page (not /api or static files):
 *  • a fresh nonce and the Content-Security-Policy built on it — Next.js puts
 *    the nonce on its own scripts, and no other script can run;
 *  • a request id that follows the request into the API's logs;
 *  • personal areas send signed-out visitors to sign in first, and back after.
 *    (A convenience only: the API refuses anyone without a valid session.)
 */

const PERSONAL = ['/account', '/appointments', '/queue', '/business', '/admin', '/welcome'];
const SESSION_HINTS = ['__Host-buku_s', 'buku_s'];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const personal = PERSONAL.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (personal && !SESSION_HINTS.some((name) => request.cookies.has(name))) {
    const signIn = new URL('/signin', request.url);
    signIn.searchParams.set('next', `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  const nonce = newNonce();
  const csp = buildCsp({
    nonce,
    dev: process.env.NODE_ENV === 'development',
    mediaOrigin: originOnly(process.env.MEDIA_ORIGIN),
    storageOrigin: originOnly(process.env.STORAGE_ORIGIN),
  });
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
      source:
        '/((?!api/|_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
