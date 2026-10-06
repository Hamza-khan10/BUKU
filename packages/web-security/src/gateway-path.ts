import type { Refusal } from './same-origin';

// A path segment: ordinary URL characters only. No "..", no empty segments,
// no encoded slashes or backslashes that could change which route is reached.
const SEGMENT = /^[A-Za-z0-9._~@:+-]{1,200}$/;

const NOT_FOUND: Refusal = { status: 404, code: 'NOT_FOUND', message: 'We couldn’t find that.' };

/**
 * The gateway path for `/api/v1/<segments>`, or a refusal. Each site says
 * which calls it passes on: `allowed` sees the clean segments (a site lets
 * through only what its pages need), and `serverOnly` lists calls that need a
 * token only the web server holds (the refresh token, a two-step challenge).
 */
export function gatewayPathFor(
  segments: readonly string[],
  rules: { serverOnly: ReadonlySet<string>; allowed: (segments: readonly string[]) => boolean },
): { path: string } | Refusal {
  if (segments.length === 0 || segments.length > 12) return NOT_FOUND;
  for (const s of segments) {
    if (!SEGMENT.test(s) || s === '.' || s === '..') return NOT_FOUND;
  }
  const joined = segments.join('/');
  if (rules.serverOnly.has(joined) || !rules.allowed(segments)) return NOT_FOUND;
  return { path: `/v1/${joined}` };
}
