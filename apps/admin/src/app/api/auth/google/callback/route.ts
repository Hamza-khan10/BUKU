import {
  decodeFlow,
  errorForApi,
  GOOGLE_CALLBACK_PATH,
  GOOGLE_TOKEN_URL,
  nonceOf,
  sameState,
  type GoogleFlow,
  type SignInError,
} from '@buku/web-security/google-oauth';
import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import { NextResponse, type NextRequest } from 'next/server';
import { env, googleSignInEnabled } from '@admin/lib/env';
import { callApi } from '@admin/lib/gateway';
import { clearGoogleFlow, readGoogleFlow } from '@admin/lib/session';
import { settleSignIn } from '@admin/lib/sign-in';

/**
 * Google sends the admin back here with a one-time code. The answer must
 * belong to the sign-in this browser started (state); the code is swapped for
 * the ID token directly with Google (this app's secret, the PKCE verifier);
 * the token must be this sign-in's (nonce); the API checks it and signs in an
 * EXISTING account only — this app never accepts terms on anyone's behalf, so
 * it never creates an account — and only a platform admin keeps a session.
 * Anything else ends on /signin with a fixed reason.
 */

const TIMEOUT_MS = 10_000;

async function idTokenFor(
  code: string,
  flow: GoogleFlow,
): Promise<{ idToken: string } | { error: SignInError }> {
  const { APP_URL, ADMIN_GOOGLE_CLIENT_ID, ADMIN_GOOGLE_CLIENT_SECRET } = env();
  let res: Response;
  try {
    res = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        code_verifier: flow.verifier,
        client_id: ADMIN_GOOGLE_CLIENT_ID ?? '',
        client_secret: ADMIN_GOOGLE_CLIENT_SECRET ?? '',
        redirect_uri: `${APP_URL}${GOOGLE_CALLBACK_PATH}`,
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { error: 'google-unavailable' };
  }
  const body = (await res.json().catch(() => null)) as { id_token?: unknown } | null;
  if (!res.ok) return { error: res.status >= 500 ? 'google-unavailable' : 'google-failed' };
  const idToken = body?.id_token;
  if (typeof idToken !== 'string' || idToken.length > 8192) return { error: 'google-failed' };
  const nonce = nonceOf(idToken);
  if (!nonce || !sameState(flow.nonce, nonce)) return { error: 'google-failed' };
  return { idToken };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const go = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url), 303);
    response.headers.set('cache-control', 'no-store');
    response.headers.set(REQUEST_ID_HEADER, requestId);
    clearGoogleFlow(response);
    return response;
  };
  const back = (error: SignInError | 'not-admin') => go(`/signin?error=${error}`);
  if (!googleSignInEnabled()) return back('google-unavailable');

  const params = request.nextUrl.searchParams;
  const flow = decodeFlow(readGoogleFlow(request.cookies));
  if (!flow) return back('google-expired');
  const refused = params.get('error');
  if (refused) return back(refused === 'access_denied' ? 'google-cancelled' : 'google-failed');
  if (!sameState(flow.state, params.get('state'))) return back('google-expired');
  const code = params.get('code');
  if (!code || code.length > 2048) return back('google-failed');

  const token = await idTokenFor(code, flow);
  if ('error' in token) return back(token.error);

  const answer = await callApi({
    method: 'POST',
    path: '/v1/auth/oauth/google',
    // No acceptedTermsVersion: an unknown Google account is refused, never created here.
    body: { idToken: token.idToken, device: { platform: 'web', name: 'BUKU admin app' } },
    incoming: request.headers,
    requestId,
  });
  if (!answer.ok) {
    // An account that doesn't exist yet: this isn't where accounts are made.
    if (answer.error.code === 'TERMS_NOT_ACCEPTED') return back('not-admin');
    return back(errorForApi(answer.status, { error: answer.error }));
  }
  const settled = await settleSignIn(answer.data, { incoming: request.headers, requestId });
  if ('refusal' in settled) return back(settled.refusal.code === 'NOT_ADMIN' ? 'not-admin' : 'google-failed');
  const response = go(settled.next);
  settled.apply(response);
  return response;
}
