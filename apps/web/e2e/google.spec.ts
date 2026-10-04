import { encodeFlow, newFlow } from '../src/lib/auth/google';
import { expect, test } from './fixtures';
import { expectAccessible } from './helpers';

/**
 * Google sign-in's guard rails, against the development site. The round trip
 * through Google itself needs the real Google client (GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET); without it the site must not offer Google at all,
 * and the callback must refuse anything that isn't a sign-in it started.
 */

const START = '/api/auth/google/start';
const CALLBACK = '/api/auth/google/callback';
const configured = Boolean(process.env.GOOGLE_CLIENT_ID);

const location = (headers: Record<string, string>) => new URL(headers['location']!, 'http://x');

// None of these reach the API: they run wherever the website does, CI included.
test.describe('Sign in with Google', () => {
  test('isn’t offered where it isn’t set up, and its start says so', async ({ page, request }) => {
    test.skip(configured, 'Google is set up on this site');
    await page.goto('/signin');
    await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);

    const res = await request.get(`${START}?next=/pricing`, { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const to = location(res.headers());
    expect(to.pathname).toBe('/signin');
    expect(Object.fromEntries(to.searchParams)).toEqual({ error: 'google-unavailable', next: '/pricing' });
  });

  test('the callback refuses an answer this browser didn’t ask for', async ({
    request,
    context,
    baseURL,
  }) => {
    // No sign-in started here: whatever comes back is refused.
    const none = await request.get(`${CALLBACK}?code=abc&state=xyz`, { maxRedirects: 0 });
    expect(location(none.headers()).searchParams.get('error')).toBe('google-expired');

    // A sign-in started here, but the answer carries another state (someone else's code slipped in).
    const flow = newFlow('/help', false);
    await context.addCookies([{ name: 'buku_oauth', value: encodeFlow(flow), url: baseURL! }]);
    const forged = await context.request.get(`${CALLBACK}?code=abc&state=not-${flow.state}`, {
      maxRedirects: 0,
    });
    const to = location(forged.headers());
    expect(Object.fromEntries(to.searchParams)).toEqual({ error: 'google-expired', next: '/help' });
    // The sign-in in progress is used up either way.
    expect(forged.headers()['set-cookie']).toMatch(/buku_oauth=;.*Max-Age=0/i);
  });

  test('leaving Google without choosing an account is said plainly', async ({ page, context, baseURL }) => {
    const flow = newFlow('/about', false);
    await context.addCookies([{ name: 'buku_oauth', value: encodeFlow(flow), url: baseURL! }]);
    await page.goto(`${CALLBACK}?error=access_denied&state=${flow.state}`);
    await expect(page).toHaveURL(
      (url) => url.pathname === '/signin' && url.searchParams.get('next') === '/about',
    );
    await expect(
      page.getByText('You left Google before choosing an account. Nothing was changed.'),
    ).toBeVisible();
    await expectAccessible(page);
  });

  test('an account scheduled for deletion is offered its way back', async ({ page }) => {
    await page.goto('/signin?error=deletion-pending&until=2026-11-03&next=/help');
    await expect(
      page.getByText(
        'This account is scheduled for deletion. It will be deleted for good on 3 November 2026.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Restore and sign in' })).toHaveAttribute(
      'href',
      `${START}?next=%2Fhelp&restore=1`,
    );
    await expectAccessible(page);
  });

  test('only known reasons are shown, never text from the address', async ({ page }) => {
    await page.goto('/signin?error=%3Cb%3Ehello%3C%2Fb%3E');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.goto('/signin?error=toString');
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.goto('/signin?error=deletion-pending&until=%3Cscript%3E');
    await expect(page.getByText('This account is scheduled for deletion.', { exact: true })).toBeVisible();
  });
});
