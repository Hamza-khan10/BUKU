import { expect, test } from './fixtures';
import { expectAccessible, watchForProblems } from './helpers';

/**
 * The checkout page (D-119): Paddle's link for a payment opens it with `?_ptxn=…`. Paddle.js is
 * replaced by a stand-in here, so the tests never reach Paddle and need no real token: it records
 * how the page starts it and lets a test play Paddle's events.
 */

const TRANSACTION = 'txn_01k7mx0aq3ewc4b2t9n6dv8rzs';

const STAND_IN = `
  window.__paddle = { calls: [] };
  window.Paddle = {
    Environment: { set: (e) => window.__paddle.calls.push(['environment', e]) },
    Initialize: (o) => {
      window.__paddle.calls.push(['initialize', o.token.slice(0, 5)]);
      window.__paddle.emit = o.eventCallback;
      setTimeout(() => o.eventCallback({ name: 'checkout.loaded' }), 50);
    },
    Checkout: { open: (o) => window.__paddle.calls.push(['open', o.transactionId]) },
  };`;

test.describe('Checkout', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://cdn.paddle.com/**', (route) =>
      route.fulfill({ contentType: 'text/javascript', body: STAND_IN }),
    );
  });

  test('opens Paddle’s checkout for the payment in the link; paid, then back to the business', async ({
    page,
  }) => {
    const problems = await watchForProblems(page);
    const res = await page.goto(`/checkout?_ptxn=${TRANSACTION}`);
    test.skip(
      (await page.getByText('Payments aren’t available here yet').count()) > 0,
      'no Paddle client-side token on this server',
    );
    // Only this page may load Paddle, and only the payment frame of the environment in use.
    const csp = res!.headers()['content-security-policy']!;
    expect(csp).toContain('https://cdn.paddle.com');
    expect(csp).toMatch(/frame-src https:\/\/(sandbox-)?buy\.paddle\.com;/);

    await expect(page.getByRole('status').filter({ hasText: 'Paddle’s checkout is open' })).toBeVisible();
    const calls = await page.evaluate(
      () => (window as unknown as { __paddle: { calls: unknown[] } }).__paddle.calls,
    );
    expect(calls).toContainEqual(['initialize', expect.stringMatching(/^(test|live)_$/)]);
    await expect(page.getByRole('status').filter({ hasText: 'Test payments only' })).toBeVisible();
    await expectAccessible(page);

    // Closed without paying: nothing charged, and it can be opened again.
    await page.evaluate(() =>
      (window as unknown as { __paddle: { emit(e: unknown): void } }).__paddle.emit({
        name: 'checkout.closed',
      }),
    );
    await page.getByRole('button', { name: 'Open the checkout again' }).click();
    expect(
      await page.evaluate(() => (window as unknown as { __paddle: { calls: unknown[] } }).__paddle.calls),
    ).toContainEqual(['open', TRANSACTION]);

    await page.evaluate(() =>
      (window as unknown as { __paddle: { emit(e: unknown): void } }).__paddle.emit({
        name: 'checkout.completed',
      }),
    );
    const paid = page.getByRole('status').filter({ hasText: 'Payment received' });
    await expect(paid).toBeVisible();
    await expect(paid.getByRole('link', { name: 'Back to your business' })).toHaveAttribute(
      'href',
      '/business',
    );
    expect(problems).toEqual([]);
  });

  test('without a payment in the link, or with a malformed one, nothing is opened', async ({ page }) => {
    for (const path of [
      '/checkout',
      '/checkout?_ptxn=txn_short',
      `/checkout?_ptxn=${TRANSACTION}%22onload%3D`,
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: 'Checkout', level: 1 })).toBeVisible();
      await expect(page.getByText('Paddle’s checkout is open')).toHaveCount(0);
      expect(await page.evaluate(() => 'Paddle' in window)).toBe(false);
    }
    await expectAccessible(page);
  });

  test('every other page still allows no frames and no Paddle', async ({ request }) => {
    const csp = (await request.get('/pricing')).headers()['content-security-policy']!;
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain('paddle');
  });
});
