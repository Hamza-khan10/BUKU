import 'server-only';
import { unstable_cache } from 'next/cache';
import { headers } from 'next/headers';
import { cache } from 'react';
import { env } from '../env';
import { clientIpFrom } from '../http/client-ip';
import { REQUEST_ID_HEADER } from '../http/request-id';
import { ApiError, apiErrorFrom, NETWORK_MESSAGE } from './errors';
import { gatewayHeaders, withQuery } from './gateway-headers';

/**
 * Public API data for server-rendered pages (business profiles, categories,
 * search results). The same for everyone, so the web server keeps a copy for
 * `revalidate` seconds, filed under the API address alone. No session is
 * ever sent; personal data never comes through here (that's the browser's
 * `/api/v1` path, with the session).
 *
 * When the API has to be asked — nobody asked for this address lately, or
 * the copy is stale — it is asked as the visitor whose page needs it (their
 * address, D-084), so the gateway's per-visitor limits fall on whoever caused
 * the request: someone sending endless different searches is slowed down,
 * nobody else is (D-089).
 */

export interface PublicResult<T, M = unknown> {
  data: T;
  meta?: M;
}

/** Who a call to the API is made for: the page request's id and the visitor's address. */
interface Asker {
  requestId: string | undefined;
  visitor: string | undefined;
}

async function ask(target: string, asker: Asker): Promise<PublicResult<unknown>> {
  const { API_URL, WEB_GATEWAY_KEY } = env();
  let res: Response;
  try {
    res = await fetch(`${API_URL}${target}`, {
      headers: gatewayHeaders(
        { accept: 'application/json' },
        { requestId: asker.requestId, visitor: asker.visitor, webKey: WEB_GATEWAY_KEY },
      ),
      // Kept below, by address only: the fetch cache would file it under these headers too.
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE, asker.requestId);
  }
  const body: unknown = await res.json().catch(() => null);
  // Refusals (not found, too many requests) are never kept: the next visitor asks for themself.
  if (!res.ok) throw apiErrorFrom(res.status, body, res.headers.get(REQUEST_ID_HEADER) ?? asker.requestId);
  const envelope = body as { data: unknown; meta?: unknown };
  return { data: envelope.data, ...(envelope.meta !== undefined && { meta: envelope.meta }) };
}

/**
 * One answer per API address per page request: the page and its metadata
 * (which both need the business) share it instead of asking twice.
 */
const answerFor = cache(async (target: string, revalidate: number): Promise<PublicResult<unknown>> => {
  const incoming = await headers();
  const asker: Asker = {
    requestId: incoming.get(REQUEST_ID_HEADER) ?? undefined,
    visitor: clientIpFrom(incoming, env().WEB_CLIENT_IP_HEADER),
  };
  if (revalidate === 0) return ask(target, asker);
  // The key is the address alone; who asked (in the closure) is deliberately not part of it.
  return unstable_cache(() => ask(target, asker), ['public-api', target], { revalidate })();
});

export function getPublic<T, M = unknown>(
  path: string,
  options: { revalidate?: number; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<PublicResult<T, M>> {
  return answerFor(withQuery(path, options.query), options.revalidate ?? 60) as Promise<PublicResult<T, M>>;
}

/** Like getPublic, but "not found" is an answer (null), not an error. */
export async function findPublic<T, M = unknown>(
  ...args: Parameters<typeof getPublic>
): Promise<PublicResult<T, M> | null> {
  try {
    return await getPublic<T, M>(...args);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
