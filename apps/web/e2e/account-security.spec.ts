import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test, visitorAddress } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';
import { totp } from './team';

/** Two-step sign-in and signed-in devices, from the settings page — against the development stack. */

const ours = { 'x-buku-csrf': '1' };
const newEmail = () => `security.${randomUUID()}@example.com`;

/** Development sign-in; a new account skips the welcome. */
async function signIn(page: Page, email: string, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).not.toHaveURL((url) => url.pathname === '/signin');
  const skip = page.getByRole('link', { name: 'Skip for now' });
  if (await skip.isVisible()) await skip.click();
}

/** Two-step sign-in turned on through the API (the setup screens have their own test). */
async function twoStepOn(page: Page, baseURL: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  // As our own pages send it: changes need the site's origin.
  const headers = { ...ours, origin: new URL(baseURL).origin };
  const setup = await page.request.post('/api/v1/auth/mfa/setup', { headers });
  expect(setup.status()).toBe(200);
  const { secret } = ((await setup.json()) as { data: { secret: string } }).data;
  const confirm = await page.request.post('/api/v1/auth/mfa/confirm', {
    headers,
    data: { code: totp(secret) },
  });
  expect(confirm.status()).toBe(200);
  return { secret, ...((await confirm.json()) as { data: { recoveryCodes: string[] } }).data };
}

test.describe('Account security', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('turn on two-step sign-in: add the app, check a code, keep the codes', async ({ page }) => {
    await signIn(page, newEmail(), 'Farah Secure');
    await page.goto('/account/settings');
    const section = page.getByRole('region', { name: 'Two-step sign-in' });
    await expect(section).toContainText('Off');
    await section.getByRole('link', { name: 'Turn on two-step sign-in' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/account/settings/two-step');
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByRole('img', { name: /QR code to add BUKU/ })).toBeVisible();
    const secret = (await page.getByLabel('Setup key').innerText()).replace(/\s+/g, '');
    await page.getByLabel(/^6-digit code/).fill('000000');
    await expect(page.getByText(/That code isn’t right/)).toBeVisible();
    await page.getByLabel(/^6-digit code/).fill(totp(secret));

    const codes = page.getByRole('list', { name: 'Your recovery codes' }).getByRole('listitem');
    await expect(codes).toHaveCount(10);
    await expectAccessible(page);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download' }).click();
    expect((await download).suggestedFilename()).toMatch(/^buku-recovery-codes-\d{4}-\d{2}-\d{2}\.txt$/);
    await expect(page.getByRole('button', { name: 'Done' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I’ve saved my recovery codes somewhere safe' }).click();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/account/settings');
    await expect(page.getByText('Two-step sign-in is on.')).toBeVisible();
    await expect(section).toContainText('10 recovery codes left.');
  });

  test('lost the phone: a recovery code gets new codes, and one of those turns it off', async ({
    page,
    baseURL,
  }) => {
    await signIn(page, newEmail(), 'Kamran Lost');
    const { recoveryCodes } = await twoStepOn(page, baseURL!);
    await page.goto('/account/settings');
    const section = page.getByRole('region', { name: 'Two-step sign-in' });
    await expect(section).toContainText('10 recovery codes left.');

    await section.getByRole('button', { name: 'Get new recovery codes' }).click();
    let dialog = page.getByRole('dialog', { name: 'Get new recovery codes?' });
    await dialog.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    await dialog.getByLabel(/^Recovery code/).fill(recoveryCodes[0]!);
    await dialog.getByRole('button', { name: 'Get new codes' }).click();
    dialog = page.getByRole('dialog', { name: 'Your new recovery codes' });
    const newCodes = dialog.getByRole('list', { name: 'Your recovery codes' }).getByRole('listitem');
    await expect(newCodes).toHaveCount(10);
    const fresh = await newCodes.allInnerTexts();
    await dialog.getByRole('checkbox', { name: 'I’ve saved my recovery codes somewhere safe' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Your new recovery codes are ready to use.')).toBeVisible();

    await section.getByRole('button', { name: 'Turn off' }).click();
    dialog = page.getByRole('dialog', { name: 'Turn off two-step sign-in?' });
    await dialog.getByRole('button', { name: 'Lost your phone? Use a recovery code' }).click();
    // The old codes stopped working.
    await dialog.getByLabel(/^Recovery code/).fill(recoveryCodes[1]!);
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(dialog.getByText('That recovery code isn’t right, or it was already used.')).toBeVisible();
    await dialog.getByLabel(/^Recovery code/).fill(fresh[0]!.trim());
    await dialog.getByRole('button', { name: 'Turn off' }).click();
    await expect(page.getByText('Two-step sign-in is off.')).toBeVisible();
    await expect(section.getByRole('link', { name: 'Turn on two-step sign-in' })).toBeVisible();
  });

  test('signed-in devices: this browser first; sign another one out and it really is', async ({
    page,
    browser,
    baseURL,
  }) => {
    const email = newEmail();
    await signIn(page, email, 'Sana Devices');
    const other = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-real-ip': visitorAddress() } });
    const elsewhere = await other.newPage();
    await signIn(elsewhere, email, 'Sana Devices');

    await page.goto('/account/settings');
    const section = page.getByRole('region', { name: 'Where you’re signed in' });
    const rows = section.getByRole('listitem');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('This browser');
    await expectAccessible(page);

    await rows
      .nth(1)
      .getByRole('button', { name: /^Sign out on / })
      .click();
    await expect(page.getByText(/^Signed out on /)).toBeVisible();
    await expect(rows).toHaveCount(1);
    await expect(section.getByRole('link', { name: 'Sign out everywhere…' })).toHaveCount(0);

    // That browser's session is over at the API, not just hidden here.
    await expect
      .poll(async () => (await elsewhere.request.get('/api/v1/auth/me', { headers: ours })).status())
      .toBe(401);
    await other.close();
  });
});
