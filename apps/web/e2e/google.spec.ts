import { encodeFlow, newFlow } from '../src/lib/auth/google';
import { expect, test } from './fixtures';
import { expectAccessible } from './helpers';

/**
 * Google sign-in's guard rails. On a site with the Google client set up
 * (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET), the way to Google is checked
 * and the callback must refuse anything that isn't a sign-in this browser
 * started; on a site without it (CI, a deployment without the API), Google
 * isn't offered and both routes say so calmly. The sign-in at Google itself
 * needs a person at Google's account chooser. None of this reaches the API.
 */

const START = '/api/auth/google/start';
const CALLBACK = '/api/auth/google/callback';

const location = (headers: Record<string, string>) => new URL(headers['location']!, 'http://x');

test.describe('Sign in with Google', () => {
  let configured = false;
  test.beforeAll(async ({ request }) => {
    configured = (await (await request.get('/signin')).text()).includes('Continue with Google');
  });

  test.describe('where it isn’t set up', () => {
    test.beforeEach(() => test.skip(configured, 'Google is set up on this site'));

    test('isn’t offered, and both of its routes say so (never an error page)', async ({ page, request }) => {
      await page.goto('/signin');
      await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
      for (const path of [`${START}?next=/pricing`, `${CALLBACK}?code=abc&state=xyz`]) {
        const res = await request.get(path, { maxRedirects: 0 });
        expect(res.status()).toBe(303);
        expect(location(res.headers()).searchParams.get('error')).toBe('google-unavailable');
      }
    });
  });

  test.describe('where it is set up', () => {
    test.beforeEach(() => test.skip(!configured, 'Google isn’t set up on this site'));

    test('sends people to Google, tied to this browser', async ({ request, baseURL }) => {
      const res = await request.get(`${START}?next=/pricing`, { maxRedirects: 0 });
      expect(res.status()).toBe(303);
      const to = location(res.headers());
      expect(to.origin + to.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(to.searchParams.get('client_id')).toMatch(/\.apps\.googleusercontent\.com$/);
      expect(to.searchParams.get('redirect_uri')).toBe(`${new URL(baseURL!).origin}${CALLBACK}`);
      expect(to.searchParams.get('code_challenge_method')).toBe('S256');
      expect(res.headers()['set-cookie']).toMatch(/buku_oauth=.+;.*HttpOnly/i);
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
    // Inside the page's own content: Next.js keeps a route announcer (role="alert") outside it.
    const alerts = page.getByRole('main').getByRole('alert');
    await page.goto('/signin?error=%3Cb%3Ehello%3C%2Fb%3E');
    await expect(page.getByRole('heading', { name: 'Sign in to BUKU' })).toBeVisible();
    await expect(alerts).toHaveCount(0);
    await expect(page.getByText('hello')).toHaveCount(0);
    await page.goto('/signin?error=toString');
    await expect(alerts).toHaveCount(0);
    await expect(page.getByText('function')).toHaveCount(0);
    await page.goto('/signin?error=deletion-pending&until=%3Cscript%3E');
    await expect(page.getByText('This account is scheduled for deletion.', { exact: true })).toBeVisible();
  });
});
