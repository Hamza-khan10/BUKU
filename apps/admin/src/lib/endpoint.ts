import 'server-only';
import { REQUEST_ID_HEADER, requestIdFrom } from '@buku/web-security/request-id';
import { checkSameOrigin } from '@buku/web-security/same-origin';
import type { NextRequest, NextResponse } from 'next/server';
import { env } from './env';
import { errorJson } from './respond';

/**
 * The start of every one of this app's endpoints that changes something: a
 * request id, and the check that the call came from this app's own pages (our
 * header, our origin). Returns the refusal to send, or the request id.
 */
export function ownPageCall(request: NextRequest): { refusal: NextResponse } | { requestId: string } {
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  const notOurs = checkSameOrigin(request.method, request.headers, env().APP_URL, 'the BUKU admin app');
  if (notOurs) return { refusal: errorJson(requestId, notOurs.status, notOurs.code, notOurs.message) };
  return { requestId };
}

/** A small JSON body, or null (never more than a sign-in form needs). */
export async function smallJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get('content-length') ?? 0) > 4096) return null;
  const text = await request.text().catch(() => '');
  if (text.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
