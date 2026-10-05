import { describe, expect, it } from 'vitest';
import { checkSameOrigin, endsSession, gatewayPath } from '../src/lib/api/bff-rules';
import { gatewayHeaders, withQuery } from '../src/lib/api/gateway-headers';
import { clientIpFrom } from '../src/lib/http/client-ip';
import { requestIdFrom } from '../src/lib/http/request-id';
import { buildCsp, newNonce, originOnly } from '../src/lib/security/csp';

describe('Content-Security-Policy', () => {
  it('in production: scripts only with the nonce, nothing embeds us, http upgraded', () => {
    const csp = buildCsp({ nonce: 'abc123==', dev: false, mediaOrigin: 'https://media.buku.app' });
    expect(csp).toContain("script-src 'self' 'nonce-abc123==' 'strict-dynamic'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain(
      "img-src 'self' data: blob: https://media.buku.app https://lh3.googleusercontent.com;",
    );
    expect(csp).toContain("connect-src 'self';");
    expect(csp.endsWith('upgrade-insecure-requests')).toBe(true);
  });

  it('in development: eval for the error overlay and the dev-server websocket, no upgrade', () => {
    const csp = buildCsp({ nonce: 'n', dev: true });
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).toContain("connect-src 'self' ws: wss:");
    expect(csp).not.toContain('upgrade-insecure-requests');
  });

  it('pictures: our own, the media store, and Google account pictures — nothing else', () => {
    const csp = buildCsp({ nonce: 'n', dev: false });
    expect(csp).toContain("img-src 'self' data: blob: https://lh3.googleusercontent.com;");
    expect(csp).not.toMatch(/img-src[^;]*\*/);
  });

  it('nonces are fresh and long enough', () => {
    const a = newNonce();
    expect(a).not.toBe(newNonce());
    expect(atob(a)).toHaveLength(16);
  });

  it('a configured origin can never add directives', () => {
    expect(originOnly('https://media.buku.app')).toBe('https://media.buku.app');
    expect(originOnly('https://media.buku.app/')).toBe('https://media.buku.app');
    expect(originOnly("https://a.example; script-src 'unsafe-inline'")).toBeUndefined();
    expect(originOnly('https://a.example/path')).toBeUndefined();
    expect(originOnly('javascript:alert(1)')).toBeUndefined();
    expect(originOnly(undefined)).toBeUndefined();
  });
});

describe('API pass-through: only our own pages may use it', () => {
  const ours = 'https://buku.app';
  const h = (headers: Record<string, string>) => new Headers(headers);

  it('accepts our scripts', () => {
    expect(
      checkSameOrigin('POST', h({ 'x-buku-csrf': '1', origin: ours, 'sec-fetch-site': 'same-origin' }), ours),
    ).toBeNull();
    expect(checkSameOrigin('GET', h({ 'x-buku-csrf': '1' }), ours)).toBeNull();
  });

  it('refuses requests without our header, from other sites, or with no origin at all', () => {
    expect(checkSameOrigin('GET', h({}), ours)?.status).toBe(403);
    expect(
      checkSameOrigin('POST', h({ 'x-buku-csrf': '1', origin: 'https://evil.example' }), ours)?.status,
    ).toBe(403);
    expect(
      checkSameOrigin('POST', h({ 'x-buku-csrf': '1', 'sec-fetch-site': 'cross-site' }), ours)?.status,
    ).toBe(403);
    expect(
      checkSameOrigin('POST', h({ 'x-buku-csrf': '1', 'sec-fetch-site': 'same-site' }), ours)?.status,
    ).toBe(403);
    expect(checkSameOrigin('POST', h({ 'x-buku-csrf': '1' }), ours)?.status).toBe(403);
  });
});

describe('API pass-through: which gateway path', () => {
  it('maps segments to /v1', () => {
    expect(gatewayPath(['auth', 'me'])).toEqual({ path: '/v1/auth/me' });
    expect(gatewayPath(['businesses', 'salt-and-pepper', 'reviews'])).toEqual({
      path: '/v1/businesses/salt-and-pepper/reviews',
    });
  });

  it('refuses traversal, odd characters and calls that need a token only the server holds', () => {
    for (const bad of [[], ['..', 'admin'], ['auth', '.'], ['a%2Fb'], ['a\\b'], ['a b'], ['x'.repeat(201)]]) {
      expect(gatewayPath(bad)).toMatchObject({ status: 404 });
    }
    expect(gatewayPath(['auth', 'refresh'])).toMatchObject({ status: 404 });
    expect(gatewayPath(['auth', 'logout'])).toMatchObject({ status: 404 });
    expect(gatewayPath(['auth', 'mfa', 'verify'])).toMatchObject({ status: 404 });
    expect(gatewayPath(['auth', 'mfa'])).toEqual({ path: '/v1/auth/mfa' });
    expect(gatewayPath(Array.from({ length: 13 }, () => 'a'))).toMatchObject({ status: 404 });
  });

  it('knows which successful calls end the session in this browser', () => {
    expect(endsSession('POST', '/v1/auth/logout-all')).toBe(true);
    expect(endsSession('POST', '/v1/auth/password')).toBe(true);
    expect(endsSession('DELETE', '/v1/auth/me')).toBe(true);
    expect(endsSession('GET', '/v1/auth/me')).toBe(false);
  });
});

describe("the visitor's address (D-084)", () => {
  it('is taken only from the platform header, and only if it is an address', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '203.0.113.7' }), 'x-real-ip')).toBe('203.0.113.7');
    expect(clientIpFrom(new Headers({ 'x-real-ip': '2001:db8::1' }), 'x-real-ip')).toBe('2001:db8::1');
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }), 'x-forwarded-for')).toBe(
      '203.0.113.7',
    );
    expect(clientIpFrom(new Headers({ 'x-real-ip': 'evil; drop' }), 'x-real-ip')).toBeUndefined();
    expect(clientIpFrom(new Headers({ 'x-real-ip': '203.0.113.7' }), undefined)).toBeUndefined();
  });
});

describe('request ids', () => {
  it('keeps a boring incoming id, replaces anything else', () => {
    expect(requestIdFrom('2f6c1d0e-1234-4abc-9def-0123456789ab')).toBe(
      '2f6c1d0e-1234-4abc-9def-0123456789ab',
    );
    expect(requestIdFrom('short')).not.toBe('short');
    expect(requestIdFrom('id\nInjected: yes')).not.toContain('\n');
    expect(requestIdFrom(null)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('calls from the web server to the API', () => {
  const webKey = 'f'.repeat(64);

  it('carry the visitor’s address only together with the key that vouches for it (D-084)', () => {
    const both = gatewayHeaders(undefined, { requestId: 'r1', visitor: '203.0.113.7', webKey });
    expect(both.get('x-buku-client-ip')).toBe('203.0.113.7');
    expect(both.get('x-buku-web-key')).toBe(webKey);
    expect(both.get('x-request-id')).toBe('r1');
    // No address: no key either (it never travels on its own); no key: the address would be ignored.
    for (const call of [{ webKey }, { visitor: '203.0.113.7' }]) {
      const h = gatewayHeaders(undefined, call);
      expect(h.has('x-buku-web-key')).toBe(false);
      expect(h.has('x-buku-client-ip')).toBe(false);
    }
  });

  it('add the session only when there is one, keeping the headers they were given', () => {
    const h = gatewayHeaders({ accept: 'application/json' }, { accessToken: 'jwt' });
    expect(h.get('authorization')).toBe('Bearer jwt');
    expect(h.get('accept')).toBe('application/json');
    expect(gatewayHeaders(undefined, {}).has('authorization')).toBe(false);
  });

  it('file public data under its address alone, empty values left out', () => {
    expect(withQuery('/v1/businesses/search', { q: 'hair', city: 'Lahore', page: 2, open: true })).toBe(
      '/v1/businesses/search?q=hair&city=Lahore&page=2&open=true',
    );
    expect(withQuery('/v1/categories', { q: '', city: undefined })).toBe('/v1/categories');
    expect(withQuery('/v1/cities')).toBe('/v1/cities');
  });
});
