import 'server-only';
import { env } from '../env';
import { clientIpFrom } from '../http/client-ip';
import { REQUEST_ID_HEADER } from '../http/request-id';
import type { SessionTokens } from '../session/policy';
import { apiErrorFrom, type ApiError } from './errors';
import { gatewayHeaders } from './gateway-headers';

/** The web server's calls to the API gateway (server-side only). */

/** Give up on the API after this long: a person is waiting. */
const TIMEOUT_MS = 20_000;

export interface GatewayCall {
  method: string;
  /** Gateway path, e.g. "/v1/auth/me". */
  path: string;
  /** Query string including "?", or "". */
  search?: string;
  body?: ArrayBuffer | string;
  /** Headers to pass on (already filtered). */
  headers?: Headers;
  accessToken?: string | undefined;
  /** The visitor's request headers: where their address comes from (D-084). */
  incoming: Headers;
  requestId: string;
  signal?: AbortSignal;
  /** Give up after this long (default 20 s); live streams pass a longer limit. */
  timeoutMs?: number;
}

export function callGateway(call: GatewayCall): Promise<Response> {
  const { API_URL, WEB_GATEWAY_KEY, WEB_CLIENT_IP_HEADER } = env();
  const headers = gatewayHeaders(call.headers, {
    requestId: call.requestId,
    accessToken: call.accessToken,
    visitor: clientIpFrom(call.incoming, WEB_CLIENT_IP_HEADER),
    webKey: WEB_GATEWAY_KEY,
  });
  const timeout = AbortSignal.timeout(call.timeoutMs ?? TIMEOUT_MS);
  return fetch(`${API_URL}${call.path}${call.search ?? ''}`, {
    method: call.method,
    headers,
    body: call.body ?? null,
    cache: 'no-store',
    redirect: 'manual',
    signal: call.signal ? AbortSignal.any([call.signal, timeout]) : timeout,
  });
}

export type RefreshOutcome =
  | { kind: 'renewed'; tokens: SessionTokens }
  /** Another tab renewed this session a moment ago; its cookies are on their way. */
  | { kind: 'superseded' }
  /** The session is over (signed out elsewhere, expired, account closed). */
  | { kind: 'ended'; error: ApiError }
  /** The API couldn't answer right now: keep the session, try again later. */
  | { kind: 'unavailable'; error: ApiError };

/** Renew a session with its refresh token (rotation: the old one stops working). */
export async function refreshSession(
  refreshToken: string,
  incoming: Headers,
  requestId: string,
): Promise<RefreshOutcome> {
  const res = await callGateway({
    method: 'POST',
    path: '/v1/auth/refresh',
    body: JSON.stringify({ refreshToken }),
    headers: new Headers({ 'content-type': 'application/json', accept: 'application/json' }),
    incoming,
    requestId,
  });
  const body: unknown = await res.json().catch(() => null);
  if (res.ok) {
    const data = (body as { data?: SessionTokens } | null)?.data;
    if (data?.accessToken && data.refreshToken) return { kind: 'renewed', tokens: data };
  }
  const error = apiErrorFrom(res.status, body, res.headers.get(REQUEST_ID_HEADER));
  const reason = (error.details as { reason?: unknown } | undefined)?.reason;
  if (res.status === 401 && reason === 'superseded') return { kind: 'superseded' };
  if (res.status === 401) return { kind: 'ended', error };
  return { kind: 'unavailable', error };
}

/** End a session at the API (idempotent; never fails the visitor's sign-out). */
export async function endSession(refreshToken: string, incoming: Headers, requestId: string): Promise<void> {
  await callGateway({
    method: 'POST',
    path: '/v1/auth/logout',
    body: JSON.stringify({ refreshToken }),
    headers: new Headers({ 'content-type': 'application/json' }),
    incoming,
    requestId,
  }).catch(() => undefined);
}
