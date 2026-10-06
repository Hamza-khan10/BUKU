import {
  authorizationUrl,
  encodeFlow,
  FLOW_SECONDS,
  GOOGLE_CALLBACK_PATH,
  newFlow,
} from '@buku/web-security/google-oauth';
import { NextResponse, type NextRequest } from 'next/server';
import { env, googleSignInEnabled } from '@admin/lib/env';
import { setGoogleFlow } from '@admin/lib/session';

/**
 * "Continue with Google" for admins: a new sign-in (fresh state, nonce and PKCE
 * verifier in an HttpOnly cookie for ten minutes), then off to Google's account
 * chooser — with this app's own Google client (D-090, D-091).
 */
export function GET(request: NextRequest): NextResponse {
  if (!googleSignInEnabled())
    return NextResponse.redirect(new URL('/signin?error=google-unavailable', request.url), 303);
  const { APP_URL, ADMIN_GOOGLE_CLIENT_ID } = env();
  const flow = newFlow('/', false);
  const response = NextResponse.redirect(
    authorizationUrl(flow, ADMIN_GOOGLE_CLIENT_ID!, `${APP_URL}${GOOGLE_CALLBACK_PATH}`),
    303,
  );
  response.headers.set('cache-control', 'no-store');
  setGoogleFlow(response, encodeFlow(flow), FLOW_SECONDS);
  return response;
}
