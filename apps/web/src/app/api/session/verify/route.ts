import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { checkSameOrigin, MAX_BODY_BYTES } from '@/lib/api/bff-rules';
import { apiErrorFrom, NETWORK_MESSAGE } from '@/lib/api/errors';
import { callGateway } from '@/lib/api/gateway';
import { errorResponse } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { clearChallenge, readChallenge, setSession } from '@/lib/session/cookies';
import { takeSession } from '@/lib/session/policy';

/**
 * The second step of signing in: a code from the authenticator app, or a
 * recovery code. The challenge token from the first step lives in a cookie
 * this browser's scripts can't read (D-088); it is added here, and a correct
 * code turns it into the session's cookies.
 */

const Body = z.union([
  z.strictObject({ code: z.string().regex(/^\d{6}$/) }),
  z.strictObject({ recoveryCode: z.string().min(8).max(20) }),
]);

const EXPIRED = 'This sign-in has expired. Please sign in again.';

export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const notOurs = checkSameOrigin('POST', request.headers, env().APP_URL);
  if (notOurs) return errorResponse(requestId, notOurs.status, notOurs.code, notOurs.message);

  const challenge = readChallenge(request);
  if (!challenge) {
    const response = errorResponse(requestId, 401, 'SIGN_IN_EXPIRED', EXPIRED);
    clearChallenge(response);
    return response;
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return errorResponse(requestId, 413, 'PAYLOAD_TOO_LARGE');
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON: refused just below.
  }
  const body = Body.safeParse(parsed);
  if (!body.success) {
    return errorResponse(
      requestId,
      422,
      'VALIDATION_ERROR',
      'Enter the 6-digit code from your authenticator app, or a recovery code.',
    );
  }

  let upstream: Response;
  try {
    upstream = await callGateway({
      method: 'POST',
      path: '/v1/auth/mfa/verify',
      body: JSON.stringify({ mfaToken: challenge.token, ...body.data }),
      headers: new Headers({ 'content-type': 'application/json', accept: 'application/json' }),
      incoming: request.headers,
      requestId,
      signal: request.signal,
    });
  } catch {
    return errorResponse(requestId, 503, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }

  const json: unknown = await upstream.json().catch(() => null);
  const headers = { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' };

  if (upstream.ok) {
    const taken = takeSession((json as { data?: unknown } | null)?.data);
    if (!taken.tokens) return errorResponse(requestId, 502, 'SERVER_ERROR');
    const response = NextResponse.json({ success: true, data: taken.data }, { headers });
    setSession(response, taken.tokens);
    clearChallenge(response);
    return response;
  }

  const error = apiErrorFrom(upstream.status, json, upstream.headers.get(REQUEST_ID_HEADER) ?? requestId);
  // Wrong code: try again. Any other 401 means the challenge itself is gone (lapsed, used, account closed).
  if (upstream.status === 401 && error.code !== 'MFA_INVALID_CODE') {
    const response = errorResponse(requestId, 401, 'SIGN_IN_EXPIRED', EXPIRED);
    clearChallenge(response);
    return response;
  }
  const response = errorResponse(error.requestId ?? requestId, upstream.status, error.code, error.message);
  const retryAfter = upstream.headers.get('retry-after');
  if (retryAfter) response.headers.set('retry-after', retryAfter);
  return response;
}
