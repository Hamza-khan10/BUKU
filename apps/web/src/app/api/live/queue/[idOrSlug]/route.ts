import type { NextRequest } from 'next/server';
import { callGateway } from '@/lib/api/gateway';
import { REQUEST_ID_HEADER, requestIdFrom } from '@/lib/http/request-id';

/**
 * A business's live queue (ticket numbers only — public, no session), passed
 * through from the gateway as server-sent events. Browsers' EventSource can't
 * send our custom header, and this needs none: it reads public data and
 * changes nothing. The visitor's address goes along for the stream limits.
 */

const ID_OR_SLUG = /^[a-z0-9-]{1,200}$/;
/** Hosting platforms end long requests; EventSource simply reconnects. */
const MAX_STREAM_MS = 5 * 60_000;

export async function GET(request: NextRequest, ctx: RouteContext<'/api/live/queue/[idOrSlug]'>) {
  const { idOrSlug } = await ctx.params;
  if (!ID_OR_SLUG.test(idOrSlug)) return new Response('Not found', { status: 404 });
  const requestId = requestIdFrom(request.headers.get(REQUEST_ID_HEADER));
  let upstream: Response;
  try {
    upstream = await callGateway({
      method: 'GET',
      path: `/v1/queue/public/${idOrSlug}/stream`,
      headers: new Headers({ accept: 'text/event-stream' }),
      incoming: request.headers,
      requestId,
      signal: request.signal,
      timeoutMs: MAX_STREAM_MS,
    });
  } catch {
    return new Response('Unavailable', { status: 503, headers: { 'retry-after': '5' } });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response(null, { status: upstream.status, headers: { 'cache-control': 'no-store' } });
  }
  return new Response(upstream.body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      [REQUEST_ID_HEADER]: requestId,
    },
  });
}
