import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, sidewaysOverflow } from './helpers';

/** Account settings: picture, name, time zone — against the development stack (and its storage). */

async function signInFresh(page: Page, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`settings.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** A real PNG, drawn by the browser (no picture files kept in the repository). */
async function drawnPicture(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#0f766e';
    ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#fef3c7';
    ctx.fillRect(16, 16, 32, 32);
    return canvas.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}

test.describe('Account settings', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('change your name and time zone; they’re kept', async ({ page }) => {
    await signInFresh(page, 'Hina Settings');
    await page.goto('/account');
    await page
      .getByRole('navigation', { name: 'Your account' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === '/account/settings');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expect(page.getByRole('region', { name: 'How you sign in' })).toContainText('@example.com');
    await expectAccessible(page);

    await page.getByLabel(/^Your name/).fill('Hina Aslam');
    await page.getByLabel(/^Time zone/).selectOption('Europe/London');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Your details are saved.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Account: Hina Aslam/ })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel(/^Your name/)).toHaveValue('Hina Aslam');
    await expect(page.getByLabel(/^Time zone/)).toHaveValue('Europe/London');
  });

  test.describe('on a small phone', () => {
    // This device's zone differs from the account's (UTC), so the longest line on the page shows.
    test.use({ viewport: { width: 320, height: 720 }, timezoneId: 'America/Argentina/Buenos_Aires' });

    test('nothing scrolls sideways, and the Settings tab is in view', async ({ page }) => {
      await signInFresh(page, 'Nadia Small');
      await page.goto('/account/settings');
      await expect(page.getByRole('button', { name: /^Use this device’s time zone/ })).toBeVisible();
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      expect(await sidewaysOverflow(page)).toBe(0);
      await expect(
        page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Settings' }),
      ).toBeInViewport();
    });
  });

  test('an empty name is explained, and nothing is saved', async ({ page }) => {
    await signInFresh(page, 'Zara Clean');
    await page.goto('/account/settings');
    await page.getByLabel(/^Your name/).fill('');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Please enter the name businesses should see.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/^Your name/)).toHaveValue('Zara Clean');
  });

  test.describe('pictures', () => {
    // The picture goes straight to storage, which takes only the headers it expects.
    test.use({ ownAddress: false });

    test('choose a picture: it goes to storage, shows, and can be removed', async ({ page }) => {
      const blocked: string[] = [];
      page.on('console', (m) => {
        if (/Content Security Policy|CORS/i.test(m.text())) blocked.push(m.text());
      });
      await signInFresh(page, 'Imran Picture');
      await page.goto('/account/settings');
      const section = page.getByRole('region', { name: 'Your picture' });
      await expect(section.locator('img')).toHaveCount(0);

      await page.getByLabel('Picture file').setInputFiles({
        name: 'me.png',
        mimeType: 'image/png',
        buffer: await drawnPicture(page),
      });
      await expect(page.getByText('Your new picture is saved.')).toBeVisible();
      // The cleaned picture loads (from storage, by a signed link), here and on the account button.
      const picture = section.locator('img');
      await expect(picture).toHaveCount(1);
      await expect
        .poll(() => picture.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0))
        .toBe(true);
      await expect(page.getByRole('button', { name: /^Account: Imran Picture/ }).locator('img')).toHaveCount(
        1,
      );
      expect(blocked).toEqual([]);

      await section.getByRole('button', { name: 'Remove' }).click();
      const dialog = page.getByRole('dialog', { name: 'Remove your picture?' });
      await dialog.getByRole('button', { name: 'Remove picture' }).click();
      await expect(page.getByText('Your picture is removed.')).toBeVisible();
      await expect(section.locator('img')).toHaveCount(0);
    });
  });

  test('a file that isn’t a picture is explained before anything is sent', async ({ page }) => {
    await signInFresh(page, 'Sadia Files');
    await page.goto('/account/settings');
    let asked = false;
    page.on('request', (r) => {
      if (r.url().includes('/avatar/uploads')) asked = true;
    });
    await page.getByLabel('Picture file').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a picture'),
    });
    await expect(page.getByRole('main').getByRole('alert')).toContainText(
      'Choose a JPEG, PNG or WebP picture.',
    );
    expect(asked).toBe(false);
  });
});
