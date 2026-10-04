import { NextResponse, type NextRequest } from 'next/server';
import { signInHref, verifyHref, welcomeHref } from '@/features/auth/paths';
import { callGateway } from '@/lib/api/gateway';
import {
  decodeFlow,
  errorForApi,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_TOKEN_URL,
  nonceOf,
  purgeDay,
  sameState,
  type GoogleFlow,
  type SignInError,
} from '@/lib/auth/google';
import { env } from '@/lib/env';
import { googleSignInEnabled } from '@/lib/flags';
import { deviceNameFrom } from '@/lib/http/device-name';
import { seeOther } from '@/lib/http/see-other';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { TERMS_VERSION } from '@/lib/legal-versions';
import { clearGoogleFlow, readGoogleFlow, setChallenge, setSession } from '@/lib/session/cookies';
import { takeChallenge, takeSession } from '@/lib/session/policy';

/**
 * Google sends the browser back here with a one-time code (D-090):
 *  1. the answer must belong to the sign-in this browser started (state);
 *  2. the code is swapped for Google's ID token, directly with Google, with
 *     our client secret and the PKCE verifier only this sign-in knows;
 *  3. the token must be the one made for this sign-in (nonce);
 *  4. the API checks it (signature, audience, expiry) and signs the person in
 *     — creating the account on first use, under the terms the sign-in page
 *     stated — and the session becomes cookies, or two-step sign-in follows.
 * Anything else ends back on /signin with a reason (a fixed code, never text
 * from the request). The flow cookie is used once and cleared either way.
 */

const TIMEOUT_MS = 10_000;

/** Swap the one-time code for Google's ID token, or say why not. */
async function idTokenFor(
  code: string,
  flow: GoogleFlow,
): Promise<{ idToken: string } | { error: SignInError }> {
  const { APP_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = env();
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: flow.verifier,
        client_id: GOOGLE_CLIENT_ID ?? '',
        client_secret: GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: `${APP_URL}${GOOGLE_CALLBACK_PATH}`,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { error: 'google-unavailable' };
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  // A code that was already used, has expired or wasn't issued to us: Google says 400.
  if (!res.ok) return { error: res.status >= 500 ? 'google-unavailable' : 'google-failed' };
  const idToken = body?.id_token;
  if (typeof idToken !== 'string' || idToken.length > 8192) return { error: 'google-failed' };
  const nonce = nonceOf(idToken);
  if (!nonce || !sameState(flow.nonce, nonce)) return { error: 'google-failed' };
  return { idToken };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Not set up on this site: nothing to finish (checked before reading any other setting).
  if (!googleSignInEnabled()) return seeOther(signInHref('signin', '/', { error: 'google-unavailable' }));
  const { APP_URL } = env();
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const params = request.nextUrl.searchParams;
  const flow = decodeFlow(readGoogleFlow(request));
  const next = flow?.next ?? '/';

  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, APP_URL), 303);
    response.headers.set('cache-control', 'no-store');
    response.headers.set(REQUEST_ID_HEADER, requestId);
    clearGoogleFlow(response);
    return response;
  };
  const back = (error: SignInError, extra: Record<string, string | undefined> = {}) =>
    go(signInHref('signin', next, { error, ...extra }));

  if (!flow) return back('google-expired');
  const refused = params.get('error');
  if (refused) return back(refused === 'access_denied' ? 'google-cancelled' : 'google-failed');
  if (!sameState(flow.state, params.get('state'))) return back('google-expired');
  const code = params.get('code');
  if (!code || code.length > 2048) return back('google-failed');

  const token = await idTokenFor(code, flow);
  if ('error' in token) return back(token.error);

  const name = deviceNameFrom(request.headers.get('user-agent'));
  let upstream: Response;
  try {
    upstream = await callGateway({
      method: 'POST',
      path: '/v1/auth/oauth/google',
      body: JSON.stringify({
        idToken: token.idToken,
        // The sign-in page says that signing in means agreeing to these.
        acceptedTermsVersion: TERMS_VERSION,
        ...(flow.restore && { restoreAccount: true }),
        device: { platform: 'web', ...(name && { name }) },
      }),
      headers: new Headers({ 'content-type': 'application/json', accept: 'application/json' }),
      incoming: request.headers,
      requestId,
    });
  } catch {
    return back('google-unavailable');
  }
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) {
    const error = errorForApi(upstream.status, body);
    return back(error, error === 'deletion-pending' ? { until: purgeDay(body) ?? undefined } : {});
  }

  const data = (body as { data?: unknown } | null)?.data;
  const signedIn = takeSession(data);
  if (signedIn.tokens) {
    const isNewUser = (signedIn.data as { isNewUser?: unknown }).isNewUser === true;
    const response = go(isNewUser ? welcomeHref(next) : next);
    setSession(response, signedIn.tokens);
    return response;
  }
  const asked = takeChallenge(data);
  if (asked.challenge) {
    const response = go(verifyHref('signin', next));
    setChallenge(response, asked.challenge);
    return response;
  }
  return back('google-failed');
}
