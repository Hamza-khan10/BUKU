import { NextResponse, type NextRequest } from 'next/server';
import { checkSameOrigin } from '@/lib/api/bff-rules';
import { NETWORK_MESSAGE } from '@/lib/api/errors';
import { refreshSession } from '@/lib/api/gateway';
import { errorResponse } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { clearSession, readSession, setSession } from '@/lib/session/cookies';

/**
 * Renew this browser's session shortly before the access token lapses. Our
 * scripts call it once (single flight) instead of every request racing to.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const notOurs = checkSameOrigin('POST', request.headers, env().APP_URL);
  if (notOurs) return errorResponse(requestId, notOurs.status, notOurs.code, notOurs.message);

  const { refreshToken } = readSession(request);
  if (!refreshToken) return errorResponse(requestId, 401, 'NOT_SIGNED_IN', 'You’re not signed in.');

  const outcome = await refreshSession(refreshToken, request.headers, requestId).catch(() => null);
  if (!outcome) return errorResponse(requestId, 503, 'NETWORK_ERROR', NETWORK_MESSAGE);

  const ok = (renewed: boolean) =>
    NextResponse.json(
      { success: true, data: { renewed } },
      { headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
    );
  switch (outcome.kind) {
    case 'renewed': {
      const response = ok(true);
      setSession(response, outcome.tokens);
      return response;
    }
    case 'superseded':
      // Another tab renewed it a moment ago; its cookies are already in this browser.
      return ok(false);
    case 'ended': {
      const response = errorResponse(
        requestId,
        401,
        'SESSION_ENDED',
        'Your session has ended. Please sign in again.',
      );
      clearSession(response);
      return response;
    }
    case 'unavailable':
      return errorResponse(requestId, outcome.error.status, outcome.error.code, outcome.error.message);
  }
}
