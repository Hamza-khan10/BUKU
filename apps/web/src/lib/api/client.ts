import { CSRF_HEADER } from './bff-rules';
import { ApiError, apiErrorFrom, NETWORK_MESSAGE } from './errors';

/**
 * The browser's API client. Every call goes to our own server (`/api/v1/…`),
 * which adds the session; this module never sees a token. Errors always
 * arrive as ApiError (code, message, request id).
 */

type Query = Record<string, string | number | boolean | null | undefined>;

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Makes a retried POST safe to repeat (the API answers the repeat like the first). */
  idempotencyKey?: string;
}

export interface ApiResult<T, M = unknown> {
  data: T;
  meta?: M;
}

const HINT_COOKIES = ['__Host-buku_s', 'buku_s'];

/** When this browser's access token lapses (seconds since epoch), or null when not signed in. */
export function sessionExpiresAt(): number | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (HINT_COOKIES.includes(part.slice(0, eq))) {
      const value = Number(part.slice(eq + 1));
      return Number.isFinite(value) ? value : null;
    }
  }
  return null;
}

export const isSignedIn = () => sessionExpiresAt() !== null;

let renewing: Promise<void> | null = null;

/** Renew the session once, however many requests notice at the same time. */
export function renewSession(): Promise<void> {
  renewing ??= fetch('/api/session/refresh', { method: 'POST', headers: { [CSRF_HEADER]: '1' } })
    .then(() => undefined)
    .catch(() => undefined)
    .finally(() => {
      renewing = null;
    });
  return renewing;
}

function url(path: string, query?: Query): string {
  const clean = path.replace(/^\/+/, '');
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();
  return `/api/v1/${clean}${qs ? `?${qs}` : ''}`;
}

async function send(path: string, options: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = { [CSRF_HEADER]: '1', accept: 'application/json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;
  try {
    return await fetch(url(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? null : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.signal && { signal: options.signal }),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }
}

/** Call the API; resolves with `{ data, meta }` or throws ApiError. */
export async function apiCall<T, M = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<ApiResult<T, M>> {
  const expires = sessionExpiresAt();
  if (expires !== null && Date.now() / 1000 >= expires - 5) await renewSession();

  let res = await send(path, options);
  if (res.status === 401) {
    const body: unknown = await res
      .clone()
      .json()
      .catch(() => null);
    // Another tab renewed the session a moment ago: the new cookies are here now.
    if ((body as { error?: { code?: string } } | null)?.error?.code === 'SESSION_RETRY') {
      res = await send(path, options);
    }
  }

  const requestId = res.headers.get('x-request-id');
  if (res.status === 204) return { data: undefined as T };
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiErrorFrom(res.status, body, requestId);
  const envelope = body as { data?: T; meta?: M } | null;
  return { data: envelope?.data as T, ...(envelope?.meta !== undefined && { meta: envelope.meta }) };
}

/** Call the API; resolves with the data only. */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  return (await apiCall<T>(path, options)).data;
}

/**
 * A call to the web server's own session routes (`/api/session/<name>`), for
 * steps that need a token only the server holds — finishing two-step sign-in.
 */
export async function sessionCall<T>(name: 'verify', body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/session/${name}`, {
      method: 'POST',
      headers: { [CSRF_HEADER]: '1', accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_MESSAGE);
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) throw apiErrorFrom(res.status, json, res.headers.get('x-request-id'));
  return (json as { data?: T } | null)?.data as T;
}

/** Sign out of this browser (the session ends at the API too). */
export async function signOut(): Promise<void> {
  await fetch('/api/session/signout', { method: 'POST', headers: { [CSRF_HEADER]: '1' } }).catch(
    () => undefined,
  );
}
