import 'server-only';
import { clientIpFrom } from '@buku/web-security/client-ip';
import { gatewayHeaders } from '@buku/web-security/gateway-headers';
import { REQUEST_ID_HEADER } from '@buku/web-security/request-id';
import { env } from './env';

/** An answer from the API, unwrapped: the data, or the error the API gave. */
export type Answer<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: number;
      error: { code: string; message: string; details?: unknown };
      requestId: string | null;
    };

const TIMEOUT_MS = 20_000;
const NETWORK = {
  code: 'NETWORK_ERROR',
  message: 'The API couldn’t be reached. Please try again in a moment.',
};

/**
 * This server's calls to the API gateway. Every call carries the admin app's
 * key (admin routes answer nothing else, D-091), the request id, the session's
 * access token when there is one, and the visitor's address where the host
 * provides it. Nothing from the browser is passed on except what's given here.
 */
export async function callApi<T>(call: {
  method?: string;
  path: string;
  body?: unknown;
  accessToken?: string | undefined;
  incoming: Headers;
  requestId: string;
}): Promise<Answer<T>> {
  const { API_URL, ADMIN_GATEWAY_KEY, ADMIN_CLIENT_IP_HEADER } = env();
  const headers = gatewayHeaders(
    call.body === undefined
      ? { accept: 'application/json' }
      : { accept: 'application/json', 'content-type': 'application/json' },
    {
      requestId: call.requestId,
      accessToken: call.accessToken,
      visitor: clientIpFrom(call.incoming, ADMIN_CLIENT_IP_HEADER),
      key: { header: 'x-buku-admin-key', value: ADMIN_GATEWAY_KEY, always: true },
    },
  );
  let res: Response;
  try {
    res = await fetch(`${API_URL}${call.path}`, {
      method: call.method ?? 'GET',
      headers,
      body: call.body === undefined ? null : JSON.stringify(call.body),
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 503, error: NETWORK, requestId: null };
  }
  if (res.status === 204) return { ok: true, status: 204, data: undefined as T };
  const body = (await res.json().catch(() => null)) as {
    data?: T;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  if (res.ok) return { ok: true, status: res.status, data: body?.data as T };
  return {
    ok: false,
    status: res.status,
    error: {
      code: body?.error?.code ?? (res.status === 401 ? 'UNAUTHORIZED' : 'ERROR'),
      message: body?.error?.message ?? 'That didn’t work. Please try again.',
      details: body?.error?.details,
    },
    requestId: res.headers.get(REQUEST_ID_HEADER),
  };
}
