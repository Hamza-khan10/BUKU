import { randomBytes } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';
import { addEmployee, removeEmployee, teamBusiness, totp, visitor, withTwoStep } from './team';

/**
 * Employee sign-in (business + username + password), replacing a temporary
 * password, and the two-step code — against the development stack.
 */

const onPage = (path: string) => (url: URL) => url.pathname === path;
const strongPassword = () => `quiet-river-${randomBytes(6).toString('hex')}-lamp`;

async function signInAsEmployee(
  page: Page,
  fields: { business: string; username: string; password: string },
) {
  await page.getByLabel('Business', { exact: true }).fill(fields.business);
  await page.getByLabel('Username', { exact: true }).fill(fields.username);
  await page.getByLabel('Password', { exact: true }).fill(fields.password);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
}

/** Paste into the focused field, the way a clipboard paste arrives. */
async function paste(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).focus();
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    document.activeElement?.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true }),
    );
  }, text);
}

test.describe('Employee sign-in', () => {
  // One after another: they share the test business (made by whichever runs first).
  test.describe.configure({ mode: 'default' });

  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('the pages explain themselves and pass WCAG 2.2 AA', async ({ page }) => {
    await page.goto('/signin');
    await page.getByRole('link', { name: 'Sign in with your username' }).click();
    await expect(page).toHaveURL(onPage('/signin/business'));
    await expect(page.getByRole('heading', { name: 'Sign in to your business' })).toBeVisible();
    await expectAccessible(page);

    // No sign-in waiting for a code in this browser: it says so, and offers the way back.
    await page.goto('/signin/verify?start=business');
    await expect(page.getByText('There’s no sign-in waiting for a code')).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true })).toHaveAttribute(
      'href',
      '/signin/business',
    );
    await expectAccessible(page);
  });

  test('a temporary password is replaced right away, then you’re in', async ({ page, baseURL }) => {
    const team = await teamBusiness(baseURL!);
    const sana = await addEmployee(team, 'Sana');
    try {
      await page.goto('/signin/business?next=/pricing');
      // The business's link pasted whole works as its handle.
      await signInAsEmployee(page, {
        business: `${baseURL}/b/${team.business.slug}`,
        username: sana.username.toUpperCase(),
        password: sana.temporaryPassword,
      });
      await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible();
      await expectAccessible(page);

      const fresh = page.getByLabel('New password', { exact: true });
      const again = page.getByLabel('New password again', { exact: true });
      const save = page.getByRole('button', { name: 'Save and continue' });
      await fresh.fill(`${sana.username}-at-work`);
      await save.click();
      await expect(page.getByText('Your password must not contain your username.')).toBeVisible();

      const password = strongPassword();
      await fresh.fill(password);
      await again.fill(`${password}x`);
      await save.click();
      await expect(page.getByText('The two passwords don’t match.')).toBeVisible();

      await again.fill(password);
      await save.click();
      await expect(page).toHaveURL(onPage('/pricing'));
      await expect(page.getByText('Your password is set. Welcome, Sana')).toBeVisible();
      await expect(page.getByRole('button', { name: `Account: ${sana.name}` })).toBeVisible();

      // The temporary password is gone for good.
      const other = await visitor(baseURL!);
      const old = await other.post('/api/v1/auth/business-login', {
        data: { business: team.business.slug, username: sana.username, password: sana.temporaryPassword },
      });
      expect(old.status()).toBe(401);
      await other.dispose();
    } finally {
      await removeEmployee(team, sana);
    }
  });

  test('a wrong password says so, keeps what was typed, and never says which part was wrong', async ({
    page,
    baseURL,
  }) => {
    const team = await teamBusiness(baseURL!);
    const omar = await addEmployee(team, 'Omar');
    try {
      // A link from the business can fill in who you are.
      await page.goto(`/signin/business?business=${team.business.slug}&username=${omar.username}`);
      const business = page.getByLabel('Business', { exact: true });
      const username = page.getByLabel('Username', { exact: true });
      const password = page.getByLabel('Password', { exact: true });
      await expect(business).toHaveValue(team.business.slug);
      await expect(username).toHaveValue(omar.username);
      await expect(password).toBeFocused();

      await password.fill('not-the-password');
      await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(page.getByText('Business, username or password is incorrect')).toBeVisible();
      await expect(business).toHaveValue(team.business.slug);
      await expect(username).toHaveValue(omar.username);
      await expect(password).toHaveValue('');
      await expect(password).toBeFocused();

      // The show-password switch, for checking what was typed.
      await password.fill('typed');
      await page.getByRole('button', { name: 'Show password' }).click();
      await expect(password).toHaveAttribute('type', 'text');
    } finally {
      await removeEmployee(team, omar);
    }
  });

  test('two-step: a wrong code is refused, a pasted recovery code signs you in', async ({
    page,
    baseURL,
  }) => {
    const team = await teamBusiness(baseURL!);
    const hina = await addEmployee(team, 'Hina');
    try {
      const password = strongPassword();
      const { secret, recoveryCodes } = await withTwoStep(baseURL!, team, hina, password);

      await page.goto('/signin/business?next=/help');
      await signInAsEmployee(page, { business: team.business.slug, username: hina.username, password });
      await expect(page).toHaveURL(onPage('/signin/verify'));
      await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible();
      await expectAccessible(page);

      // Six digits are sent as soon as they're in; a wrong code is refused.
      const valid = [-1, 0, 1].map((s) => totp(secret, s));
      const wrong = ['111111', '222222', '333333'].find((c) => !valid.includes(c))!;
      await page.getByLabel('6-digit code').pressSequentially(wrong);
      await expect(page.getByText('That code isn’t right.', { exact: false })).toBeVisible();
      await expect(page.getByLabel('6-digit code')).toHaveValue('');

      // A recovery code pasted into the code box is recognised as one.
      await paste(page, '6-digit code', recoveryCodes[0]!.toLowerCase());
      await expect(page.getByLabel('Recovery code')).toHaveValue(recoveryCodes[0]!);
      await page.getByRole('button', { name: 'Continue' }).click();
      await expect(page).toHaveURL(onPage('/help'));
      await expect(page.getByText('You used a recovery code. 9 are left.')).toBeVisible();
      await expect(page.getByRole('button', { name: `Account: ${hina.name}` })).toBeVisible();
    } finally {
      await removeEmployee(team, hina);
    }
  });

  test('two-step: a lapsed sign-in starts again; the app’s code signs you in', async ({
    page,
    context,
    baseURL,
  }) => {
    const team = await teamBusiness(baseURL!);
    const bilal = await addEmployee(team, 'Bilal');
    try {
      const password = strongPassword();
      const { secret } = await withTwoStep(baseURL!, team, bilal, password);
      const sign = { business: team.business.slug, username: bilal.username, password };

      await page.goto('/signin/business?next=/about');
      await signInAsEmployee(page, sign);
      await expect(page).toHaveURL(onPage('/signin/verify'));

      // The few minutes pass (the challenge cookie is gone): the form says so and starts again.
      await context.clearCookies({ name: /buku_mfa$/ });
      await page.getByLabel('6-digit code').pressSequentially(totp(secret));
      await expect(page.getByText('This sign-in has expired')).toBeVisible();
      await page.getByRole('link', { name: 'Sign in again' }).click();
      await expect(page).toHaveURL(onPage('/signin/business'));

      await signInAsEmployee(page, sign);
      await expect(page).toHaveURL(onPage('/signin/verify'));
      await page.getByLabel('6-digit code').pressSequentially(totp(secret));
      await expect(page).toHaveURL(onPage('/about'));
      await expect(page.getByRole('button', { name: `Account: ${bilal.name}` })).toBeVisible();
      // The code page has nothing left to do once signed in.
      await page.goto('/signin/verify?next=/help');
      await expect(page).toHaveURL(onPage('/help'));
    } finally {
      await removeEmployee(team, bilal);
    }
  });
});
