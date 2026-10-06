import { REQUEST_ID_HEADER } from '@buku/web-security/request-id';
import { NextResponse } from 'next/server';

/** A JSON answer from this app's own endpoints, never cached. */
export function json(requestId: string, data: unknown, status = 200): NextResponse {
  return NextResponse.json(
    { success: true, data },
    { status, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
  );
}

export function errorJson(
  requestId: string,
  status: number,
  code: string,
  message: string,
  details?: unknown,
): NextResponse {
  return NextResponse.json(
    { success: false, error: { code, message, ...(details !== undefined && { details }), requestId } },
    { status, headers: { [REQUEST_ID_HEADER]: requestId, 'cache-control': 'no-store' } },
  );
}
