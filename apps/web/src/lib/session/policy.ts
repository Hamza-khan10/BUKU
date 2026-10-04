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
 *  • challenge — between the password (or Google) and the two-step code: the
 *    5-minute token that turns a correct code into a session. HttpOnly,
 *    SameSite=Strict; the sign-in page's script never holds it either.
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
    ? {
        access: '__Host-buku_at',
        refresh: '__Secure-buku_rt',
        hint: '__Host-buku_s',
        challenge: '__Host-buku_mfa',
      }
    : { access: 'buku_at', refresh: 'buku_rt', hint: 'buku_s', challenge: 'buku_mfa' };
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

// ── Two-step sign-in ──────────────────────────────────────────────────────

/** A sign-in waiting for its second step: the API's challenge token and when it lapses. */
export interface Challenge {
  token: string;
  expiresAt: string;
}

// The API's tokens are URL-safe random strings.
const CHALLENGE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * The challenge cookie. Its value carries the expiry in front of the token
 * ("1791108300.<token>"), so the code page can say how long is left without
 * asking the API.
 */
export function challengeCookie(challenge: Challenge, secure: boolean, now = Date.now()): CookieSpec {
  const expires = Date.parse(challenge.expiresAt);
  return {
    name: cookieNames(secure).challenge,
    value: `${Math.floor(expires / 1000)}.${challenge.token}`,
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: Math.max(0, Math.floor((expires - now) / 1000)),
  };
}

export function clearedChallengeCookie(secure: boolean): CookieSpec {
  return {
    name: cookieNames(secure).challenge,
    value: '',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  };
}

/** The challenge in a cookie's value, or null when it is malformed or has lapsed. */
export function readChallengeValue(value: string | undefined, now = Date.now()): Challenge | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  const seconds = Number(value.slice(0, dot));
  const token = value.slice(dot + 1);
  if (dot < 1 || !Number.isSafeInteger(seconds) || !CHALLENGE_TOKEN.test(token)) return null;
  if (seconds * 1000 <= now) return null;
  return { token, expiresAt: new Date(seconds * 1000).toISOString() };
}

/**
 * A sign-in answer that asks for the second step: `{ mfaRequired, mfaToken,
 * expiresAt }`. Take the token out — it becomes the challenge cookie — and
 * return the answer without it. A token that doesn't look like the API's is
 * still taken out (it never reaches the page), just not kept.
 */
export function takeChallenge(data: unknown): { challenge: Challenge | null; data: unknown } {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { challenge: null, data };
  const record = data as Record<string, unknown>;
  if (record.mfaRequired !== true) return { challenge: null, data };
  const { mfaToken, ...rest } = record;
  const { expiresAt } = record;
  const valid =
    typeof mfaToken === 'string' &&
    CHALLENGE_TOKEN.test(mfaToken) &&
    typeof expiresAt === 'string' &&
    !Number.isNaN(Date.parse(expiresAt));
  return { challenge: valid ? { token: mfaToken, expiresAt } : null, data: rest };
}
