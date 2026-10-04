import { NextResponse, type NextRequest } from 'next/server';
import { signInHref } from '@/features/auth/paths';
import { authorizationUrl, encodeFlow, FLOW_SECONDS, GOOGLE_CALLBACK_PATH, newFlow } from '@/lib/auth/google';
import { env } from '@/lib/env';
import { googleSignInEnabled } from '@/lib/flags';
import { seeOther } from '@/lib/http/see-other';
import { setGoogleFlow } from '@/lib/session/cookies';
import { safeNext } from '@/lib/session/next';

/**
 * "Continue with Google": a new sign-in (fresh state, nonce and PKCE
 * verifier, kept in an HttpOnly cookie for ten minutes), then off to Google's
 * account chooser. `?restore=1` when the person chose to restore an account
 * that is scheduled for deletion (D-090).
 */
export function GET(request: NextRequest): NextResponse {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get('next'));
  // Not set up on this site: back to sign-in, which says so. Checked before reading any other
  // setting — a site deployed without the API has none to read.
  if (!googleSignInEnabled()) return seeOther(signInHref('signin', next, { error: 'google-unavailable' }));
  const { APP_URL, GOOGLE_CLIENT_ID } = env();
  if (!GOOGLE_CLIENT_ID) return seeOther(signInHref('signin', next, { error: 'google-unavailable' }));
  const flow = newFlow(next, params.get('restore') === '1');
  const response = NextResponse.redirect(
    authorizationUrl(flow, GOOGLE_CLIENT_ID, `${APP_URL}${GOOGLE_CALLBACK_PATH}`),
    303,
  );
  response.headers.set('cache-control', 'no-store');
  setGoogleFlow(response, encodeFlow(flow), FLOW_SECONDS);
  return response;
}
