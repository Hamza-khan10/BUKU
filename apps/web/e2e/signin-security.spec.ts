import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable } from './helpers';

/**
 * What signing in must never allow, checked in a real browser against the
 * development stack: tokens a page script could read, admin tools reached
 * from this site, unlimited guessing, or an admin sign-in on the public page.
 */

const ours = { 'x-buku-csrf': '1' };

async function signIn(page: Page, email = `security.${randomUUID()}@example.com`) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill('Rehan Secure');
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** Looks like a session token: a JWT, or a long random string. */
const tokenLike = (value: string) => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value) || value.length > 40;

test.describe('Sign-in security', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('session tokens live only in HttpOnly cookies: nothing a page script can read', async ({
    page,
    context,
  }) => {
    await signIn(page);
    const seen = await page.evaluate(() => ({
      cookies: document.cookie
        .split('; ')
        .filter(Boolean)
        .map((c) => ({ name: c.slice(0, c.indexOf('=')), value: c.slice(c.indexOf('=') + 1) })),
      stored: [...Object.entries(localStorage), ...Object.entries(sessionStorage)].map(([key, value]) => ({
        key,
        value,
      })),
    }));
    // Scripts see at most the hint cookie: when the session lapses (a number), never a token.
    for (const c of seen.cookies) {
      expect(tokenLike(c.value), `cookie ${c.name} readable by scripts`).toBe(false);
    }
    expect(seen.cookies.find((c) => /buku_(at|rt)$/.test(c.name))).toBeUndefined();
    for (const s of seen.stored) expect(tokenLike(s.value), `storage ${s.key}`).toBe(false);

    // The tokens are there, but only for the browser to send: HttpOnly, never to other sites.
    const jar = await context.cookies();
    const access = jar.find((c) => /buku_at$/.test(c.name));
    const refresh = jar.find((c) => /buku_rt$/.test(c.name));
    expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax' });
    expect(refresh).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  });

  test('admin tools are enforced on the server: this site passes no admin call on, and has no admin pages', async ({
    page,
  }) => {
    await signIn(page);
    for (const path of ['/api/v1/admin/access-review', '/api/v1/admin/billing/plans']) {
      const res = await page.request.get(path, { headers: ours });
      expect([path, res.status()]).toEqual([path, 404]);
    }
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
  });

  test('the public sign-in page offers no admin sign-in', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByRole('radio', { name: /Customer/ })).toBeVisible();
    await expect(page.getByRole('radio', { name: /admin/i })).toHaveCount(0);
    await expect(page.getByRole('main')).not.toContainText(/platform admin/i);
  });

  test('signing in is limited per visitor: the 11th try in a minute is refused and said plainly', async ({
    page,
    baseURL,
  }) => {
    const origin = new URL(baseURL!).origin;
    for (let i = 0; i < 10; i++) {
      const res = await page.request.post('/api/v1/auth/dev/login', {
        headers: { ...ours, origin },
        data: { email: `limit.${randomUUID()}@example.com`, name: 'Limit Test' },
      });
      expect(res.ok()).toBe(true);
    }
    // Those signed this browser in; start the 11th from signed out, as the same visitor.
    await page.context().clearCookies();
    await page.goto('/signin');
    await page.getByLabel('Email').fill(`limit.${randomUUID()}@example.com`);
    await page.getByLabel(/^Name/).fill('Limit Test');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('Too many tries in a short time');
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
  });
});
