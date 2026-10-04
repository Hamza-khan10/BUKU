/**
 * Rules for the web server's API pass-through (`/api/v1/*` → gateway `/v1/*`).
 * Pure functions, so every rule is unit-tested on its own.
 */

/** The header our own scripts send; a page on another site can't send it without our permission. */
export const CSRF_HEADER = 'x-buku-csrf';

export type Refusal = { status: number; code: string; message: string };

/**
 * Only our own pages may use the pass-through: the request must carry our
 * header (cross-site pages can't add custom headers without a CORS grant,
 * which we never give), and — where the browser says — come from our origin.
 */
export function checkSameOrigin(method: string, headers: Headers, appOrigin: string): Refusal | null {
  const refuse = {
    status: 403,
    code: 'FORBIDDEN',
    message: 'This request didn’t come from the BUKU website.',
  };
  if (headers.get(CSRF_HEADER) !== '1') return refuse;
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return refuse;
  const origin = headers.get('origin');
  if (origin && origin !== appOrigin) return refuse;
  if (method !== 'GET' && method !== 'HEAD' && !origin && !site) return refuse;
  return null;
}

// A path segment: ordinary URL characters only. No "..", no empty segments,
// no encoded slashes or backslashes that could change which route is reached.
const SEGMENT = /^[A-Za-z0-9._~@:+-]{1,200}$/;

/**
 * Calls that need a token only the web server holds (see /api/session): the
 * refresh token, and a sign-in's two-step challenge.
 */
const SERVER_ONLY = new Set(['auth/refresh', 'auth/logout', 'auth/mfa/verify']);

/** The gateway path for `/api/v1/<segments>`, or a refusal. */
export function gatewayPath(segments: readonly string[]): { path: string } | Refusal {
  const notFound = { status: 404, code: 'NOT_FOUND', message: 'We couldn’t find that.' };
  if (segments.length === 0 || segments.length > 12) return notFound;
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..') return notFound;
  }
  const joined = segments.join('/');
  if (SERVER_ONLY.has(joined)) return notFound;
  return { path: `/v1/${joined}` };
}

/** Successful calls after which this browser's session is over. */
export function endsSession(method: string, path: string): boolean {
  return (
    (method === 'POST' && path === '/v1/auth/logout-all') ||
    (method === 'POST' && path === '/v1/auth/password') ||
    (method === 'DELETE' && path === '/v1/auth/me')
  );
}

/** The most a pass-through request body may be (the gateway's own limit is 128 KB). */
export const MAX_BODY_BYTES = 128 * 1024;

/** Request headers worth passing on to the API (everything else is dropped). */
export const FORWARDED_REQUEST_HEADERS = [
  'accept',
  'accept-language',
  'content-type',
  'idempotency-key',
] as const;

/** Response headers worth passing back to the browser. */
export const FORWARDED_RESPONSE_HEADERS = [
  'content-type',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'x-request-id',
] as const;
