import { randomUUID } from 'node:crypto';
import { API, apiAvailable, devSignIn, expect, expectAccessible, test, totp } from './helpers';

/**
 * The admin app (D-091): its own sign-in, platform admins only, two-step
 * sign-in required before anything is shown, cookies of its own that no page
 * script can read, and nothing accepted from other sites.
 */

const newEmail = () => `operator.${randomUUID()}@example.com`;

test.describe('Admin app', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('signed out, every page goes to sign in; the sign-in page is plain and accessible', async ({
    page,
  }) => {
    for (const path of ['/', '/two-step']) {
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === '/signin');
    }
    await expect(page.getByRole('heading', { name: 'Sign in to BUKU admin' })).toBeVisible();
    await expectAccessible(page);
    const robots = (await page.request.get('/signin')).headers()['x-robots-tag'];
    expect(robots).toContain('noindex');
  });

  test('a new admin must set up two-step sign-in first, then sees the access review', async ({
    page,
    context,
  }) => {
    const email = newEmail();
    await devSignIn(page, email, 'Mariam Operator');
    await expect(page).toHaveURL((url) => url.pathname === '/two-step');
    // Nothing else is reachable until two-step sign-in is on.
    await page.goto('/');
    await expect(page).toHaveURL((url) => url.pathname === '/two-step');
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Set it up' }).click();
    const secret = (await page.getByLabel('Setup key').innerText()).replace(/\s+/g, '');
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    await expect(page.getByRole('main').getByRole('alert')).toContainText('That code isn’t right');
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    await expect(page.getByRole('list', { name: 'Your recovery codes' }).getByRole('listitem')).toHaveCount(
      10,
    );
    await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.getByLabel('I’ve saved my recovery codes somewhere safe').check();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByRole('heading', { name: 'Access review' })).toBeVisible();
    const me = page.getByRole('row').filter({ hasText: email });
    await expect(me).toContainText('On');
    await expectAccessible(page);

    // The session lives in this app's own HttpOnly cookies; page scripts see no token.
    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(['buku_admin_at', 'buku_admin_rt', 'buku_admin_s']));
    expect(names.some((n) => /^(__Host-)?buku_(at|rt|s)$/.test(n))).toBe(false);
    for (const c of await context.cookies()) {
      if (/buku_admin_(at|rt)$/.test(c.name)) expect(c.httpOnly).toBe(true);
    }
    expect(await page.evaluate(() => /buku_admin_(at|rt)=/.test(document.cookie))).toBe(false);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
    expect((await context.cookies()).some((c) => c.name === 'buku_admin_at')).toBe(false);
  });

  test('a customer’s account is refused here, and gets no session', async ({ page, context }) => {
    const email = newEmail();
    // A customer, made the way the website makes them.
    const made = await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, name: 'Just A Customer' }),
    });
    expect(made.ok).toBe(true);

    await devSignIn(page, email, 'Just A Customer');
    await expect(page.getByRole('main').getByRole('alert')).toContainText('isn’t a BUKU platform admin');
    await expect(page).toHaveURL((url) => url.pathname === '/signin');
    expect((await context.cookies()).filter((c) => c.name.startsWith('buku_admin'))).toEqual([]);
  });

  test('without the admin app’s own Google client, Google isn’t offered and its endpoints say so', async ({
    page,
  }) => {
    test.skip(process.env.ADMIN_GOOGLE_CLIENT_ID !== undefined, 'Google is set up for this admin app');
    await page.goto('/signin');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
    for (const path of ['/api/auth/google/start', '/api/auth/google/callback?code=x&state=y']) {
      await page.goto(path);
      await expect(page).toHaveURL(
        (url) => url.pathname === '/signin' && url.searchParams.get('error') === 'google-unavailable',
      );
      await expect(page.getByRole('main').getByRole('alert')).toContainText('isn’t available right now');
    }
  });

  test('calls from other sites are refused, and the admin API is closed to everyone else', async ({
    page,
    baseURL,
  }) => {
    const res = await page.request.post('/api/auth/dev', {
      headers: { 'x-buku-csrf': '1', origin: 'https://evil.example', 'content-type': 'application/json' },
      data: { email: newEmail() },
    });
    expect(res.status()).toBe(403);
    const noHeader = await page.request.post('/api/auth/dev', {
      headers: { origin: new URL(baseURL!).origin, 'content-type': 'application/json' },
      data: { email: newEmail() },
    });
    expect(noHeader.status()).toBe(403);
    // Straight at the gateway, without the admin app's key, admin routes don't exist.
    expect((await fetch(`${API}/v1/admin/access-review`)).status).toBe(404);
  });
});
