import { gatewayPathFor } from '@buku/web-security/gateway-path';
import { checkSameOrigin as sharedSameOrigin } from '@buku/web-security/same-origin';

/**
 * Rules for the web server's API pass-through (`/api/v1/*` → gateway `/v1/*`).
 * Pure functions, so every rule is unit-tested on its own.
 */

export { CSRF_HEADER, type Refusal } from '@buku/web-security/same-origin';

/** Only this website's own pages may use the pass-through (the shared same-origin rule). */
export const checkSameOrigin = (method: string, headers: Headers, appOrigin: string) =>
  sharedSameOrigin(method, headers, appOrigin, 'the BUKU website');

/**
 * Calls that need a token only the web server holds (see /api/session): the
 * refresh token, and a sign-in's two-step challenge.
 */
const SERVER_ONLY = new Set(['auth/refresh', 'auth/logout', 'auth/mfa/verify']);

/**
 * The gateway path for `/api/v1/<segments>`, or a refusal. Platform admin tools
 * are never passed on from this site, whatever its session (D-091): they answer
 * only the separate admin app.
 */
export const gatewayPath = (segments: readonly string[]) =>
  gatewayPathFor(segments, { serverOnly: SERVER_ONLY, allowed: (s) => s[0] !== 'admin' });

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
