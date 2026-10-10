import 'server-only';
import type { SessionTokens } from '@buku/web-security/session-policy';
import type { NextRequest } from 'next/server';
import type { Me } from './admin';
import { callApi } from './gateway';
import { readTokens } from './session';

/**
 * The access token for an endpoint call: the cookie's, or — when it has just
 * lapsed — a renewed one (the refresh cookie only ever reaches /api). The caller
 * sets the renewed cookies on its response. Null when there's no session.
 */
export async function currentAccess(
  request: NextRequest,
  requestId: string,
): Promise<{ accessToken: string; renewed: SessionTokens | null } | null> {
  const { accessToken, refreshToken } = readTokens(request.cookies);
  if (accessToken) return { accessToken, renewed: null };
  if (!refreshToken) return null;
  const r = await callApi<SessionTokens>({
    method: 'POST',
    path: '/v1/auth/refresh',
    body: { refreshToken },
    incoming: request.headers,
    requestId,
  });
  return r.ok ? { accessToken: r.data.accessToken, renewed: r.data } : null;
}

/** Is this session a platform admin's? (The API checks again on every admin call.) */
export async function isPlatformAdmin(accessToken: string, request: NextRequest, requestId: string) {
  const me = await callApi<Me>({ path: '/v1/auth/me', accessToken, incoming: request.headers, requestId });
  return me.ok && me.data.role === 'super_admin';
}
