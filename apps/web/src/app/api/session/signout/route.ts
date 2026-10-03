import { NextResponse, type NextRequest } from 'next/server';
import { checkSameOrigin } from '@/lib/api/bff-rules';
import { endSession } from '@/lib/api/gateway';
import { errorResponse } from '@/lib/api/respond';
import { env } from '@/lib/env';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';
import { clearSession, readSession } from '@/lib/session/cookies';

/** Sign out of this browser: the session ends at the API too, not just here. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const notOurs = checkSameOrigin('POST', request.headers, env().APP_URL);
  if (notOurs) return errorResponse(requestId, notOurs.status, notOurs.code, notOurs.message);

  const { refreshToken } = readSession(request);
  if (refreshToken) await endSession(refreshToken, request.headers, requestId);

  const response = new NextResponse(null, {
    status: 204,
    headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' },
  });
  clearSession(response);
  return response;
}
