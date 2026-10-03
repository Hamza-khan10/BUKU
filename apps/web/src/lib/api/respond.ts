import 'server-only';
import { NextResponse } from 'next/server';
import { REQUEST_ID_HEADER } from '../http/request-id';
import { messageForStatus } from './errors';

/** An error in the API's own envelope, so the browser handles every refusal the same way. */
export function errorResponse(
  requestId: string,
  status: number,
  code: string,
  message = messageForStatus(status),
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, requestId } },
    { status, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
  );
}
