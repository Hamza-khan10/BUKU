/**
 * How a signed-in session lives in the browser (WEB_PLAN §4). The browser
 * never sees a token: the web server keeps them in cookies JavaScript can't
 * read, and calls the API with them on the visitor's behalf.
 *
 *  • access  — the 15-minute access token. HttpOnly, SameSite=Lax (sent when
 *    someone follows a link to us, so signed-in pages render), Path=/.
 *  • refresh — the long-lived refresh token. HttpOnly, SameSite=Strict, and
 *    only sent to /api (where sessions are renewed), never with page loads.
 *  • hint    — no secret: when the access token expires. Readable by our
 *    scripts so they renew a session just before it lapses, and by the server
 *    to know someone is signed in. Lives as long as the refresh token.
 *
 * Over HTTPS the names carry the browser-enforced prefixes: `__Host-` (exactly
 * this site, Path=/, Secure) and `__Secure-` (Secure). Plain names over
 * http://localhost in development.
 */

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict';
  path: string;
  maxAge: number;
}

export function cookieNames(secure: boolean) {
  return secure
    ? { access: '__Host-buku_at', refresh: '__Secure-buku_rt', hint: '__Host-buku_s' }
    : { access: 'buku_at', refresh: 'buku_rt', hint: 'buku_s' };
}

/** Renew this long before the access token actually expires (clock skew, slow networks). */
export const ACCESS_SKEW_SECONDS = 30;

const secondsUntil = (iso: string, now: number) => Math.max(0, Math.floor((Date.parse(iso) - now) / 1000));

/** The three cookies for a fresh session. */
export function sessionCookies(tokens: SessionTokens, secure: boolean, now = Date.now()): CookieSpec[] {
  const names = cookieNames(secure);
  const accessSeconds = Math.max(0, secondsUntil(tokens.accessTokenExpiresAt, now) - ACCESS_SKEW_SECONDS);
  const refreshSeconds = secondsUntil(tokens.refreshTokenExpiresAt, now);
  const accessExpiresEpoch = Math.floor(now / 1000) + accessSeconds;
  return [
    {
      name: names.access,
      value: tokens.accessToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: accessSeconds,
    },
    {
      name: names.refresh,
      value: tokens.refreshToken,
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path: '/api',
      maxAge: refreshSeconds,
    },
    {
      name: names.hint,
      value: String(accessExpiresEpoch),
      httpOnly: false,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: refreshSeconds,
    },
  ];
}

/** Cookies that end the session in this browser. */
export function clearedCookies(secure: boolean): CookieSpec[] {
  const names = cookieNames(secure);
  const base = { value: '', httpOnly: true, secure, maxAge: 0 };
  return [
    { ...base, name: names.access, sameSite: 'lax', path: '/' },
    { ...base, name: names.refresh, sameSite: 'strict', path: '/api' },
    { ...base, name: names.hint, sameSite: 'lax', path: '/', httpOnly: false },
  ];
}

const TOKEN_FIELDS = [
  'accessToken',
  'accessTokenExpiresAt',
  'refreshToken',
  'refreshTokenExpiresAt',
] as const;

const onlyTokens = (t: SessionTokens): SessionTokens => ({
  accessToken: t.accessToken,
  accessTokenExpiresAt: t.accessTokenExpiresAt,
  refreshToken: t.refreshToken,
  refreshTokenExpiresAt: t.refreshTokenExpiresAt,
});

function isTokens(value: unknown): value is SessionTokens {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return TOKEN_FIELDS.every((f) => typeof v[f] === 'string' && v[f].length > 0);
}

/**
 * Some API answers carry a new session: signing in, finishing two-step
 * sign-in, confirming two-step setup (`session` inside the answer). Take the
 * tokens out — they become cookies — and return the answer without them, so
 * they never reach the browser's JavaScript.
 */
export function takeSession(data: unknown): { tokens: SessionTokens | null; data: unknown } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { tokens: null, data };
  const record = data as Record<string, unknown>;
  if (isTokens(record)) {
    const rest = { ...record };
    for (const f of TOKEN_FIELDS) delete rest[f];
    return { tokens: onlyTokens(record), data: rest };
  }
  if (isTokens(record.session)) {
    const { session, ...rest } = record;
    return { tokens: onlyTokens(session), data: { ...rest, session: { renewed: true } } };
  }
  return { tokens: null, data };
}
