import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** Signing in (development sign-in), the account menu, and signing out — against the dev stack. */

/** On this page (by path — the sign-in address itself ends with ?next=/pricing). */
const onPage = (path: string) => (url: URL) => url.pathname === path;

const unique = (who: string) => `${who}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.com`;

async function signIn(page: Page, path: string, name: string) {
  await page.goto(path);
  await page.getByLabel('Email').fill(unique(name.split(' ')[0]!.toLowerCase()));
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
}

test.describe('Signing in', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('the sign-in page is accessible and says what development sign-in is', async ({ page }) => {
    await page.goto('/signin');
    await expect(page.getByRole('heading', { name: 'Sign in to BUKU' })).toBeVisible();
    await expect(page.getByText('Development sign-in')).toBeVisible();
    await expectAccessible(page);
  });

  test('sign in, come back where you were, stay signed in, sign out', async ({ page }) => {
    await signIn(page, '/signin?next=/pricing', 'Ayesha Khan');
    // A new account stops at the welcome first.
    await expect(page).toHaveURL(onPage('/welcome'));
    await expect(page.getByText('Welcome to BUKU, Ayesha')).toBeVisible();
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(onPage('/pricing'));
    const account = page.getByRole('button', { name: 'Account: Ayesha Khan' });
    await expect(account).toBeVisible();

    await page.reload();
    await expect(account).toBeVisible();
    // Signed in, the sign-in page sends you on.
    await page.goto('/signin?next=/help');
    await expect(page).toHaveURL(onPage('/help'));

    await account.click();
    await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click();
    await expect(page).toHaveURL(onPage('/'));
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
    // The session is over at the API too, not just in this browser.
    expect((await page.request.get('/api/v1/auth/me', { headers: { 'x-buku-csrf': '1' } })).status()).toBe(
      401,
    );
  });

  test('never sends you to another site after signing in', async ({ page }) => {
    await signIn(page, `/signin?next=${encodeURIComponent('https://evil.example/')}`, 'Bilal Ahmed');
    await expect(page).toHaveURL((url) => url.pathname === '/welcome' && url.host.startsWith('localhost'));
    await expect(page.getByRole('link', { name: 'Skip for now' })).toHaveAttribute('href', '/');
  });

  test('checks the form before sending, and cleans the name as you type', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Email').fill('not-an-email');
    await page.getByRole('button', { name: 'Sign in', exact: true }).last().click();
    await expect(page.getByText('Please enter an email address like name@example.com.')).toBeVisible();
    const name = page.getByLabel(/^Name/);
    await name.pressSequentially(`Sara ${String.fromCodePoint(0x1f600)}`);
    await expect(name).toHaveValue('Sara ');
  });

  test('sign out of every device ends every session', async ({ page, browser }) => {
    await signIn(page, '/signin?next=/about', 'Hamid Raza');
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(onPage('/about'));
    await page.goto('/signout');
    await page.getByRole('button', { name: 'Sign out of every device' }).click();
    await expect(page.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
    await expectAccessible(page);
    // Someone signed out who opens the page just sees that they are signed out.
    const other = await browser.newPage();
    await other.goto(page.url());
    await expect(other.getByRole('heading', { name: 'You’re signed out' })).toBeVisible();
    await other.close();
  });

  test('personal pages ask signed-out visitors to sign in first', async ({ request }) => {
    const res = await request.get('/account', { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()['location']).toBe('/signin?next=%2Faccount');
  });
});
