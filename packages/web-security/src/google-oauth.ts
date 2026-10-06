import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Signing in with Google, done by a web server (OpenID Connect,
 * authorization code flow with PKCE). No Google script ever runs on our
 * pages: the browser goes to Google and comes back to our callback, which
 * swaps the one-time code for Google's ID token — over a direct, verified
 * connection, with our client secret — and hands that token to the API,
 * which checks it and signs the person in (D-090).
 *
 * Pure functions (no request, no cookies), so every rule is tested on its own.
 */

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** The path Google sends people back to (registered in the Google Cloud console). */
export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';

/** How long someone may spend at Google's account chooser before the sign-in must start again. */
export const FLOW_SECONDS = 600;

/** One sign-in in progress: kept in an HttpOnly cookie between leaving for Google and coming back. */
export interface GoogleFlow {
  /** Ties Google's answer to this browser (stops someone else's code being slipped in). */
  state: string;
  /** Ties the ID token to this sign-in (stops a token being replayed). */
  nonce: string;
  /** PKCE: proves the code is swapped by whoever started the sign-in. */
  verifier: string;
  /** Where to go afterwards (already checked by safeNext). */
  next: string;
  /** Restore an account that is scheduled for deletion (the person chose to). */
  restore: boolean;
}

const random = () => randomBytes(32).toString('base64url');

export function newFlow(next: string, restore: boolean): GoogleFlow {
  return { state: random(), nonce: random(), verifier: random(), next, restore };
}

/** PKCE S256: base64url(SHA-256(verifier)) — RFC 7636. */
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export function authorizationUrl(flow: GoogleFlow, clientId: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: flow.state,
    nonce: flow.nonce,
    code_challenge: pkceChallenge(flow.verifier),
    code_challenge_method: 'S256',
    // Shared computers: always let people pick (or add) the account.
    prompt: 'select_account',
  });
  return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
}

// ── The flow cookie ───────────────────────────────────────────────────────

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const encodeFlow = (flow: GoogleFlow) => Buffer.from(JSON.stringify(flow)).toString('base64url');

/** The flow in a cookie's value, or null when it is missing or not one of ours. */
export function decodeFlow(value: string | undefined): GoogleFlow | null {
  if (!value || value.length > 2048) return null;
  try {
    const f = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<GoogleFlow>;
    if (
      typeof f.state !== 'string' ||
      typeof f.nonce !== 'string' ||
      typeof f.verifier !== 'string' ||
      typeof f.next !== 'string' ||
      typeof f.restore !== 'boolean' ||
      ![f.state, f.nonce, f.verifier].every((t) => TOKEN.test(t))
    ) {
      return null;
    }
    return { state: f.state, nonce: f.nonce, verifier: f.verifier, next: f.next, restore: f.restore };
  } catch {
    return null;
  }
}

/** Compared in constant time: the answer's state must be exactly the one we sent. */
export function sameState(expected: string, received: string | null): boolean {
  if (!received) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The `nonce` claim in an ID token. Read without checking the signature: the
 * token came straight from Google's token endpoint over TLS (OpenID Connect
 * Core §3.1.3.7), and the API checks the signature, audience and expiry
 * before anyone is signed in.
 */
export function nonceOf(idToken: string): string | null {
  const payload = idToken.split('.')[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { nonce?: unknown };
    return typeof claims.nonce === 'string' ? claims.nonce : null;
  } catch {
    return null;
  }
}

// ── What the sign-in page says when it didn't work ───────────────────────

/**
 * Why a Google sign-in ended back on /signin (`?error=`). Only these codes
 * are ever put in the address; the page has its own words for each.
 */
export const SIGN_IN_ERRORS = {
  'google-cancelled': 'You left Google before choosing an account. Nothing was changed.',
  'google-expired': 'That sign-in took too long or was started in another browser. Please try again.',
  'google-failed': 'Google didn’t confirm who you are. Please try again.',
  'google-unavailable': 'Signing in with Google isn’t available right now. Please try again later.',
  'account-suspended': 'This account is suspended. If you think that’s a mistake, contact us.',
  'too-many': 'That was a lot of sign-in attempts. Please wait a minute and try again.',
  'deletion-pending': 'This account is scheduled for deletion.',
} as const;

export type SignInError = keyof typeof SIGN_IN_ERRORS;

export const signInErrorFrom = (value: string | string[] | undefined): SignInError | null => {
  const code = Array.isArray(value) ? value[0] : value;
  // Own keys only: `in` would also accept inherited names like "toString".
  return code && Object.hasOwn(SIGN_IN_ERRORS, code) ? (code as SignInError) : null;
};

/** The API's refusal of a sign-in, as one of our codes. */
export function errorForApi(status: number, body: unknown): SignInError {
  const error = (body as { error?: { code?: unknown; details?: { reason?: unknown } } } | null)?.error;
  if (status === 403 && error?.code === 'ACCOUNT_SUSPENDED') {
    return error.details?.reason === 'account_deleted' ? 'deletion-pending' : 'account-suspended';
  }
  if (status === 403 && error?.code === 'FEATURE_DISABLED') return 'google-unavailable';
  if (status === 429) return 'too-many';
  if (status === 401 || status === 400 || status === 422) return 'google-failed';
  return 'google-unavailable';
}

/** "2026-11-03" from the API's purge time, for "scheduled for deletion on …" (null if odd). */
export function purgeDay(body: unknown): string | null {
  const after = (body as { error?: { details?: { purgeAfter?: unknown } } } | null)?.error?.details
    ?.purgeAfter;
  if (typeof after !== 'string' || Number.isNaN(Date.parse(after))) return null;
  return new Date(after).toISOString().slice(0, 10);
}
