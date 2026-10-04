import { request as playwright, type APIRequestContext } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable } from './helpers';

/**
 * The session round trip through the web server (WEB_PLAN §4): tokens become
 * cookies the page can't read, the API is reached with them, an expired
 * access token is renewed, sign-out ends the session at the API too.
 * Needs the API stack (`pnpm dev`) and development sign-in.
 */

const ours = (baseURL: string) => ({
  'x-buku-csrf': '1',
  origin: baseURL,
  'content-type': 'application/json',
});

async function signIn(request: APIRequestContext, baseURL: string) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post('/api/v1/auth/dev/login', { headers: ours(baseURL), data: { email } });
  return { res, email };
}

test.describe('Session through the web server', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('signing in sets cookies scripts can’t read, and no token reaches the page', async ({
    request,
    baseURL,
  }) => {
    const { res } = await signIn(request, baseURL!);
    expect(res.status()).toBe(201);
    const body = await res.text();
    expect(body).not.toMatch(/accessToken|refreshToken/);

    const cookies = res
      .headersArray()
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value);
    const access = cookies.find((c) => /buku_at=/.test(c))!;
    const refresh = cookies.find((c) => /buku_rt=/.test(c))!;
    const hint = cookies.find((c) => /buku_s=/.test(c))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=lax/i);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=strict/i);
    expect(refresh).toMatch(/Path=\/api/);
    expect(hint).not.toMatch(/HttpOnly/i);
  });

  test('the API is reached with the session; it is renewed when the access token lapses', async ({
    request,
    baseURL,
  }) => {
    const { email } = await signIn(request, baseURL!);
    const me = await request.get('/api/v1/auth/me', { headers: { 'x-buku-csrf': '1' } });
    expect(me.status()).toBe(200);
    expect((await me.json()).data.email).toBe(email);

    // Drop the access cookie, as the browser does when it lapses.
    const state = await request.storageState();
    const context = await playwright.newContext({
      baseURL: baseURL!,
      storageState: { ...state, cookies: state.cookies.filter((c) => !c.name.endsWith('buku_at')) },
    });
    const renewed = await context.get('/api/v1/auth/me', { headers: { 'x-buku-csrf': '1' } });
    expect(renewed.status()).toBe(200);
    expect(renewed.headersArray().some((h) => /^set-cookie$/i.test(h.name) && /buku_at=/.test(h.value))).toBe(
      true,
    );
    await context.dispose();
  });

  test('requests that don’t come from our pages are refused', async ({ request, baseURL }) => {
    expect((await request.get('/api/v1/auth/me')).status()).toBe(403);
    const foreign = await request.post('/api/v1/auth/logout-all', {
      headers: { 'x-buku-csrf': '1', origin: 'https://evil.example' },
    });
    expect(foreign.status()).toBe(403);
    expect((await request.post('/api/v1/auth/refresh', { headers: ours(baseURL!), data: {} })).status()).toBe(
      404,
    );
  });

  test('signing out ends the session at the API too', async ({ request, baseURL }) => {
    await signIn(request, baseURL!);
    const out = await request.post('/api/session/signout', { headers: ours(baseURL!) });
    expect(out.status()).toBe(204);
    expect((await request.get('/api/v1/auth/me', { headers: { 'x-buku-csrf': '1' } })).status()).toBe(401);
  });
});
