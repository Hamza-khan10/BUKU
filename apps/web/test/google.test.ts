import { describe, expect, it } from 'vitest';
import {
  authorizationUrl,
  decodeFlow,
  encodeFlow,
  errorForApi,
  newFlow,
  nonceOf,
  pkceChallenge,
  purgeDay,
  sameState,
  signInErrorFrom,
  SIGN_IN_ERRORS,
} from '../src/lib/auth/google';
import { deviceNameFrom } from '../src/lib/http/device-name';

const CLIENT = '123456789-abcdef.apps.googleusercontent.com';
const CALLBACK = 'https://buku.example/api/auth/google/callback';

/** An unsigned token with these claims (only the payload matters to nonceOf). */
const tokenWith = (claims: Record<string, unknown>) =>
  `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;

describe('Google sign-in: leaving for Google', () => {
  it('uses PKCE S256 exactly as RFC 7636 computes it', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('asks Google for a code, tied to this sign-in by state, nonce and the PKCE challenge', () => {
    const flow = newFlow('/pricing', false);
    const url = new URL(authorizationUrl(flow, CLIENT, CALLBACK));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: CALLBACK,
      response_type: 'code',
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
    // The verifier itself never leaves the web server.
    expect(url.toString()).not.toContain(flow.verifier);
  });

  it('makes every sign-in unguessable and unlike the last', () => {
    const a = newFlow('/', false);
    const b = newFlow('/', false);
    for (const t of [a.state, a.nonce, a.verifier]) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Set([a.state, a.nonce, a.verifier, b.state, b.nonce, b.verifier]).size).toBe(6);
  });
});

describe('Google sign-in: the flow cookie', () => {
  it('reads back exactly what was stored', () => {
    const flow = newFlow('/b/salt-and-pepper?service=1', true);
    expect(decodeFlow(encodeFlow(flow))).toEqual(flow);
  });

  it('refuses anything that isn’t one of ours', () => {
    const flow = newFlow('/', false);
    for (const bad of [
      undefined,
      '',
      'not-base64-json',
      Buffer.from('{"state":1}').toString('base64url'),
      encodeFlow({ ...flow, state: 'short' }),
      encodeFlow({ ...flow, nonce: 'has spaces in it and is long enough to pass length' }),
      'x'.repeat(3000),
    ]) {
      expect(decodeFlow(bad)).toBeNull();
    }
    const { restore: _restore, ...missing } = flow;
    expect(decodeFlow(Buffer.from(JSON.stringify(missing)).toString('base64url'))).toBeNull();
  });

  it('compares the returning state exactly', () => {
    const { state } = newFlow('/', false);
    expect(sameState(state, state)).toBe(true);
    expect(sameState(state, `${state}x`)).toBe(false);
    expect(sameState(state, state.toUpperCase())).toBe(state === state.toUpperCase());
    expect(sameState(state, null)).toBe(false);
  });
});

describe('Google sign-in: coming back', () => {
  it('finds the nonce in the ID token, and nothing in a malformed one', () => {
    expect(nonceOf(tokenWith({ nonce: 'abc', sub: '1' }))).toBe('abc');
    expect(nonceOf(tokenWith({ sub: '1' }))).toBeNull();
    expect(nonceOf(tokenWith({ nonce: 42 }))).toBeNull();
    expect(nonceOf('one-part')).toBeNull();
    expect(nonceOf('a.not-json.b')).toBeNull();
  });

  it('turns the API’s refusals into the page’s own reasons', () => {
    const refusal = (code: string, details?: unknown) => ({ success: false, error: { code, details } });
    expect(errorForApi(403, refusal('ACCOUNT_SUSPENDED', { reason: 'account_deleted' }))).toBe(
      'deletion-pending',
    );
    expect(errorForApi(403, refusal('ACCOUNT_SUSPENDED'))).toBe('account-suspended');
    expect(errorForApi(403, refusal('FEATURE_DISABLED'))).toBe('google-unavailable');
    expect(errorForApi(429, refusal('RATE_LIMITED'))).toBe('too-many');
    expect(errorForApi(401, refusal('OAUTH_TOKEN_INVALID'))).toBe('google-failed');
    expect(errorForApi(422, refusal('TERMS_NOT_ACCEPTED'))).toBe('google-failed');
    expect(errorForApi(503, null)).toBe('google-unavailable');
  });

  it('says when a scheduled deletion happens, from the API’s own date only', () => {
    const body = { error: { details: { purgeAfter: '2026-11-03T10:00:00.000Z' } } };
    expect(purgeDay(body)).toBe('2026-11-03');
    expect(purgeDay({ error: { details: { purgeAfter: 'soon' } } })).toBeNull();
    expect(purgeDay(null)).toBeNull();
  });

  it('shows only reasons it knows, in its own words (nothing from the address is echoed)', () => {
    expect(signInErrorFrom('google-cancelled')).toBe('google-cancelled');
    expect(signInErrorFrom(['too-many', 'x'])).toBe('too-many');
    for (const bad of ['<script>', 'toString', '__proto__', '', undefined])
      expect(signInErrorFrom(bad)).toBeNull();
    for (const message of Object.values(SIGN_IN_ERRORS)) expect(message).toMatch(/\.$/);
  });
});

describe('device names', () => {
  it('names the browser and the system people recognise', () => {
    const chromeWindows =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
    const safariIphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
    expect(deviceNameFrom(chromeWindows)).toBe('Chrome on Windows');
    expect(deviceNameFrom(safariIphone)).toBe('Safari on iOS');
    expect(deviceNameFrom('curl/8.0')).toBe('Browser');
    expect(deviceNameFrom(null)).toBeUndefined();
  });
});
