import { NextResponse, type NextRequest } from 'next/server';
import {
  checkSameOrigin,
  endsSession,
  FORWARDED_REQUEST_HEADERS,
  FORWARDED_RESPONSE_HEADERS,
  gatewayPath,
  MAX_BODY_BYTES,
} from '@/lib/api/bff-rules';
import { NETWORK_MESSAGE } from '@/lib/api/errors';
import { callGateway, refreshSession } from '@/lib/api/gateway';
import { errorResponse } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { clearChallenge, clearSession, readSession, setChallenge, setSession } from '@/lib/session/cookies';
import { takeChallenge, takeSession, type Challenge, type SessionTokens } from '@/lib/session/policy';

/**
 * The browser's way to the API: `/api/v1/<path>` → gateway `/v1/<path>`, with
 * the session's access token added here (the browser never holds it), the
 * visitor's address passed on (D-084), sessions renewed when the access token
 * has lapsed, and any new session in an answer turned into cookies — as is a
 * sign-in's two-step challenge (D-088).
 */

const MAX_QUERY_LENGTH = 2048;

/** The answer said the access token is no good — worth one renewal. */
async function tokenRejected(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null);
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  // The gateway's own 401 ({ message }) or the service's TOKEN_EXPIRED / TOKEN_INVALID.
  return code === undefined || code === 'TOKEN_EXPIRED' || code === 'TOKEN_INVALID';
}

async function handle(request: NextRequest, ctx: RouteContext<'/api/v1/[...path]'>): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const method = request.method;

  const notOurs = checkSameOrigin(method, request.headers, env().APP_URL);
  if (notOurs) return errorResponse(requestId, notOurs.status, notOurs.code, notOurs.message);

  const target = gatewayPath((await ctx.params).path);
  if ('status' in target) return errorResponse(requestId, target.status, target.code, target.message);

  const search = request.nextUrl.search;
  if (search.length > MAX_QUERY_LENGTH) return errorResponse(requestId, 414, 'URI_TOO_LONG');

  let body: ArrayBuffer | undefined;
  if (method !== 'GET') {
    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
      return errorResponse(requestId, 413, 'PAYLOAD_TOO_LARGE');
    }
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return errorResponse(requestId, 413, 'PAYLOAD_TOO_LARGE');
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  const session = readSession(request);
  let accessToken = session.accessToken;
  let renewed: SessionTokens | null = null;
  let sessionEnded = false;
  /** A new session in the answer itself (signing in, two-step). */
  let signedIn: SessionTokens | null = null;
  /** A sign-in that needs its two-step code first. */
  let challenge: Challenge | null = null;

  /** Renew with the refresh token. Returns a response to send instead, if renewing can't continue. */
  const renew = async (): Promise<NextResponse | null> => {
    if (!session.refreshToken) return null;
    const outcome = await refreshSession(session.refreshToken, request.headers, requestId).catch(() => null);
    if (!outcome) return errorResponse(requestId, 503, 'NETWORK_ERROR', NETWORK_MESSAGE);
    switch (outcome.kind) {
      case 'renewed':
        renewed = outcome.tokens;
        accessToken = outcome.tokens.accessToken;
        return null;
      case 'superseded':
        // Another tab renewed it a moment ago; the browser has the new cookies by now.
        return errorResponse(requestId, 401, 'SESSION_RETRY', 'Please try that again.');
      case 'ended':
        sessionEnded = true;
        accessToken = undefined;
        return null;
      case 'unavailable':
        return errorResponse(requestId, outcome.error.status, outcome.error.code, outcome.error.message);
    }
  };

  // The access cookie disappears just before the token expires: renew first.
  if (!accessToken && session.refreshToken) {
    const stop = await renew();
    if (stop) return stop;
  }

  const send = () =>
    callGateway({
      method,
      path: target.path,
      search,
      ...(body && { body }),
      headers,
      accessToken,
      incoming: request.headers,
      requestId,
      signal: request.signal,
    });

  let upstream: Response;
  try {
    upstream = await send();
    if (accessToken && !renewed && session.refreshToken && (await tokenRejected(upstream))) {
      const stop = await renew();
      if (stop) return stop;
      upstream = await send();
    }
  } catch {
    return errorResponse(requestId, 503, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  const out = new Headers({ 'cache-control': 'no-store' });
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  if (!out.has(REQUEST_ID_HEADER)) out.set(REQUEST_ID_HEADER, requestId);

  let response: NextResponse;
  const type = upstream.headers.get('content-type') ?? '';
  if (upstream.status === 204 || upstream.status === 304) {
    response = new NextResponse(null, { status: upstream.status, headers: out });
  } else if (type.includes('text/event-stream')) {
    // Live updates: pass the stream straight through.
    response = new NextResponse(upstream.body, { status: upstream.status, headers: out });
  } else if (type.includes('application/json')) {
    const json: unknown = await upstream.json().catch(() => null);
    let payload = json;
    if (upstream.ok && json && typeof json === 'object' && 'data' in json) {
      const taken = takeSession(json.data);
      signedIn = taken.tokens;
      const asked = signedIn ? { challenge: null, data: taken.data } : takeChallenge(taken.data);
      challenge = asked.challenge;
      payload = { ...json, data: asked.data };
    }
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    if (code === 'SESSION_REVOKED') sessionEnded = true;
    response = NextResponse.json(payload, { status: upstream.status, headers: out });
  } else {
    response = new NextResponse(upstream.body, { status: upstream.status, headers: out });
  }

  if (upstream.ok && endsSession(method, target.path)) sessionEnded = true;
  if (signedIn) {
    setSession(response, signedIn);
    clearChallenge(response);
  } else if (challenge) setChallenge(response, challenge);
  else if (sessionEnded) clearSession(response);
  else if (renewed) setSession(response, renewed);
  return response;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
