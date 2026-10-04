import { expect, test } from './fixtures';
import { expectAccessible, useTheme, watchForProblems } from './helpers';

test.describe('The website', () => {
  test('home: says what BUKU is, with no errors and no blocked scripts', async ({ page }) => {
    const problems = await watchForProblems(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Know exactly when.');
    await expect(page).toHaveTitle(/BUKU/);
    await page.waitForLoadState('networkidle');
    expect(problems).toEqual([]);
  });

  test('every page carries the security headers, and every script it sends the nonce', async ({
    request,
  }) => {
    const res = await request.get('/');
    const h = res.headers();
    const csp = h['content-security-policy'] ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['strict-transport-security']).toContain('max-age=');
    expect(h['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(h['x-powered-by']).toBeUndefined();

    // Scripts the server sends must carry this response's nonce (scripts they load
    // later are allowed by 'strict-dynamic'; browsers hide nonces from the DOM).
    const scripts = (await res.text()).match(/<script\b[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) expect(tag).toContain(`nonce="${nonce}"`);
  });

  test('a fresh nonce for every request', async ({ request }) => {
    const nonceOf = async () =>
      /'nonce-([^']+)'/.exec((await request.get('/')).headers()['content-security-policy'] ?? '')?.[1];
    expect(await nonceOf()).not.toBe(await nonceOf());
  });

  test('an unknown page: a real 404, kind words, a way home', async ({ page }) => {
    const res = await page.goto('/this-page-does-not-exist');
    expect(res?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'This page isn’t here' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to the home page' }).click();
    await expect(page).toHaveURL('/');
  });

  test('personal areas send signed-out visitors to sign in, and remember where they were going', async ({
    request,
  }) => {
    for (const path of ['/account', '/business/123/queue', '/admin', '/appointments/abc?x=1']) {
      const res = await request.get(path, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      const to = new URL(res.headers()['location'] ?? '', 'http://x');
      expect(to.pathname).toBe('/signin');
      expect(to.searchParams.get('next')).toBe(path);
    }
  });

  test('not indexed before launch', async ({ request, page }) => {
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /');
    await page.goto('/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });

  test('the chosen theme arrives with the page (no flash), and the toggle remembers it', async ({
    page,
    context,
    baseURL,
    isMobile,
  }) => {
    // On phones the theme toggle lives in the menu.
    const openToggle = async () => {
      if (isMobile) await page.getByRole('button', { name: 'Open menu' }).click();
    };
    await useTheme(context, 'dark', baseURL!);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await openToggle();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await openToggle();
    await page.getByRole('radio', { name: 'Use device setting' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('keyboard users can skip straight to the content', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard navigation');
    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await skip.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});

test.describe('Accessibility (WCAG 2.2 AA)', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const path of ['/', '/kit', '/this-page-does-not-exist']) {
      test(`${path} in ${theme}`, async ({ page, context, baseURL }) => {
        await useTheme(context, theme, baseURL!);
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectAccessible(page);
      });
    }
  }
});
