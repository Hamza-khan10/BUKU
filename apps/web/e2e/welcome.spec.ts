import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** The first visit after creating an account (/welcome) — against the development stack. */

const onPage = (path: string) => (url: URL) => url.pathname === path;
const newEmail = () => `welcome.${randomUUID()}@example.com`;

async function devSignIn(page: Page, next: string, email: string, name = 'Ayesha Khan') {
  await page.goto(`/signin?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** The account's own settings, read through the website the way its pages do. */
async function account(page: Page) {
  const headers = { 'x-buku-csrf': '1' };
  const me = await (await page.request.get('/api/v1/auth/me', { headers })).json();
  const prefs = await (await page.request.get('/api/v1/users/me/notification-prefs', { headers })).json();
  return {
    me: (me as { data: { name: string; timezone: string } }).data,
    prefs: (prefs as { data: { emailBookingConfirmation: boolean; emailReminders: boolean } }).data,
  };
}

test.describe('Welcome', () => {
  test.use({ timezoneId: 'Asia/Karachi' });

  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('a new account chooses its name and emails, then goes where it was going', async ({ page }) => {
    await devSignIn(page, '/pricing', newEmail());
    await expect(page).toHaveURL(onPage('/welcome'));
    await expect(page.getByRole('heading', { name: 'Welcome to BUKU' })).toBeVisible();
    const name = page.getByLabel('Your name');
    await expect(name).toHaveValue('Ayesha Khan');
    await expect(page.getByText('Time zone: Asia/Karachi, from this device.')).toBeVisible();
    await expectAccessible(page);

    // An empty name is refused in words, not saved.
    await name.fill('');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Please enter the name businesses should see.')).toBeVisible();

    await name.fill('Ayesha Noor');
    await page.getByRole('checkbox', { name: 'Reminders' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(onPage('/pricing'));
    await expect(page.getByText('You’re all set')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Account: Ayesha Noor' })).toBeVisible();

    const saved = await account(page);
    expect(saved.me).toMatchObject({ name: 'Ayesha Noor', timezone: 'Asia/Karachi' });
    expect(saved.prefs).toMatchObject({ emailBookingConfirmation: true, emailReminders: false });
  });

  test('skipping keeps the defaults, and a returning account goes straight on', async ({ browser }) => {
    const email = newEmail();
    const first = await browser.newPage();
    await devSignIn(first, '/help', email, 'Sara Malik');
    await expect(first).toHaveURL(onPage('/welcome'));
    await first.getByRole('link', { name: 'Skip for now' }).click();
    await expect(first).toHaveURL(onPage('/help'));
    expect((await account(first)).prefs).toMatchObject({
      emailBookingConfirmation: true,
      emailReminders: true,
    });
    await first.close();

    // The same person on another device: no welcome the second time.
    const again = await browser.newPage();
    await devSignIn(again, '/about', email, 'Sara Malik');
    await expect(again).toHaveURL(onPage('/about'));
    await expect(again.getByText('Welcome back, Sara')).toBeVisible();
    await again.close();
  });
});
