import { describe, expect, it } from 'vitest';
import { buildCsp } from '../src/csp';
import { gatewayHeaders } from '../src/gateway-headers';
import { gatewayPathFor } from '../src/gateway-path';
import { checkSameOrigin, CSRF_HEADER } from '../src/same-origin';
import { clearedCookies, cookieNames, sessionCookies } from '../src/session-policy';

const tokens = {
  accessToken: 'a'.repeat(30),
  accessTokenExpiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  refreshToken: 'r'.repeat(30),
  refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
};

describe('each site keeps its own session cookies', () => {
  it('the website and the admin app never share cookie names', () => {
    const web = cookieNames(true);
    const admin = cookieNames(true, 'buku_admin');
    expect(web).toEqual({
      access: '__Host-buku_at',
      refresh: '__Secure-buku_rt',
      hint: '__Host-buku_s',
      challenge: '__Host-buku_mfa',
      google: '__Host-buku_oauth',
    });
    expect(admin.access).toBe('__Host-buku_admin_at');
    for (const name of Object.values(admin)) expect(Object.values(web)).not.toContain(name);
    expect(cookieNames(false, 'buku_admin').refresh).toBe('buku_admin_rt');
  });

  it('the same rules for both: tokens HttpOnly, refresh only for /api, Strict', () => {
    for (const prefix of ['buku', 'buku_admin'] as const) {
      const [access, refresh, hint] = sessionCookies(tokens, true, Date.now(), prefix);
      expect(access).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true });
      expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'strict', path: '/api' });
      expect(hint).toMatchObject({ httpOnly: false });
      expect(hint!.value).toMatch(/^\d+$/);
      expect(clearedCookies(true, prefix).map((c) => c.name)).toEqual([
        access!.name,
        refresh!.name,
        hint!.name,
      ]);
    }
  });
});

describe('which calls a site passes on', () => {
  const rules = {
    serverOnly: new Set(['auth/refresh']),
    allowed: (s: readonly string[]) => s[0] === 'admin',
  };

  it('only clean segments, only what the site allows, never server-only calls', () => {
    expect(gatewayPathFor(['admin', 'access-review'], rules)).toEqual({ path: '/v1/admin/access-review' });
    expect(gatewayPathFor(['businesses', 'x'], rules)).toMatchObject({ status: 404 });
    expect(gatewayPathFor(['auth', 'refresh'], { ...rules, allowed: () => true })).toMatchObject({
      status: 404,
    });
    for (const bad of [[], ['admin', '..'], ['admin', ''], ['admin', 'a%2Fb'], ['admin', 'a\\b']]) {
      expect(gatewayPathFor(bad, rules)).toMatchObject({ status: 404 });
    }
  });

  it('a page elsewhere can’t use it: our header, our origin', () => {
    const ok = new Headers({
      [CSRF_HEADER]: '1',
      origin: 'https://admin.buku.app',
      'sec-fetch-site': 'same-origin',
    });
    expect(checkSameOrigin('POST', ok, 'https://admin.buku.app', 'the BUKU admin app')).toBeNull();
    const elsewhere = new Headers({ [CSRF_HEADER]: '1', origin: 'https://buku.app' });
    expect(checkSameOrigin('POST', elsewhere, 'https://admin.buku.app', 'the BUKU admin app')).toMatchObject({
      status: 403,
      message: 'This request didn’t come from the BUKU admin app.',
    });
  });
});

describe('what goes to the gateway', () => {
  it('the website’s key only with a visitor’s address; the admin key on every call', () => {
    const web = gatewayHeaders(undefined, { key: { header: 'x-buku-web-key', value: 'w'.repeat(64) } });
    expect(web.has('x-buku-web-key')).toBe(false);
    const admin = gatewayHeaders(undefined, {
      accessToken: 't',
      key: { header: 'x-buku-admin-key', value: 'k'.repeat(64), always: true },
    });
    expect(admin.get('x-buku-admin-key')).toBe('k'.repeat(64));
    expect(admin.has('x-buku-client-ip')).toBe(false);
    expect(admin.get('authorization')).toBe('Bearer t');
  });
});

describe('Content-Security-Policy', () => {
  it('extra picture origins only where a site asks for them', () => {
    expect(buildCsp({ nonce: 'n', dev: false })).toContain("img-src 'self' data: blob:;");
    expect(
      buildCsp({ nonce: 'n', dev: false, imageOrigins: ['https://lh3.googleusercontent.com'] }),
    ).toContain("img-src 'self' data: blob: https://lh3.googleusercontent.com;");
  });
});
