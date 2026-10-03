import 'server-only';
import { headers } from 'next/headers';
import { env } from '../env';
import { REQUEST_ID_HEADER } from '../http/request-id';
import { ApiError, apiErrorFrom, NETWORK_MESSAGE } from './errors';

/**
 * Public API data for server-rendered pages (business profiles, categories,
 * search results). The same for everyone, so cached briefly by the web
 * server; no session and no visitor address are sent, which is what makes it
 * shareable. Personal data never goes through here — that's the browser's
 * `/api/v1` path, with the session.
 */

export interface PublicResult<T, M = unknown> {
  data: T;
  meta?: M;
}

export async function getPublic<T, M = unknown>(
  path: string,
  options: { revalidate?: number; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<PublicResult<T, M>> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(options.query ?? {}))
    if (v !== undefined && v !== '') params.set(k, String(v));
  const qs = params.toString();
  const requestId = (await headers()).get(REQUEST_ID_HEADER) ?? undefined;

  let res: Response;
  try {
    res = await fetch(`${env().API_URL}${path}${qs ? `?${qs}` : ''}`, {
      headers: { accept: 'application/json', ...(requestId && { [REQUEST_ID_HEADER]: requestId }) },
      next: { revalidate: options.revalidate ?? 60 },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE, requestId);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiErrorFrom(res.status, body, res.headers.get(REQUEST_ID_HEADER) ?? requestId);
  const envelope = body as { data: T; meta?: M };
  return { data: envelope.data, ...(envelope.meta !== undefined && { meta: envelope.meta }) };
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
