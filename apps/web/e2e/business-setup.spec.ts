import { randomInt, randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { sql } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, watchForProblems } from './helpers';
import { png } from './pictures';

/**
 * Adding a business (3.5a), as an owner would on the website: what it is and where, the
 * business terms, opening hours, a first service done by the owner, then the page is live and
 * marked "Not verified". Each run's business is removed again afterwards (soft-deleted, as the
 * app removes things), so test runs don't fill the development site with test businesses.
 */

async function signInAsOwner(page: Page) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`setup.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill('Sana Malik');
  await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

const made: string[] = [];

test.describe('Adding a business', () => {
  // The page sends pictures straight to storage, which allows only the headers it expects.
  test.use({ ownAddress: false });

  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made)
      sql(`UPDATE businesses SET deleted_at = now() WHERE id = '${id}' AND deleted_at IS NULL`);
  });

  test('an owner adds their business, its hours and a first service; it goes live, not verified', async ({
    page,
  }) => {
    test.slow();
    await signInAsOwner(page);
    // Errors in the browser fail the test: a page that renders differently on the server and in
    // the browser (country names, say) logs a hydration error here.
    const problems = await watchForProblems(page);

    await page.goto('/business');
    await expect(page.getByRole('heading', { name: 'No business here yet' })).toBeVisible();
    await page.getByRole('main').getByRole('link', { name: 'Add your business' }).click();
    await expect(page).toHaveURL(/\/business\/new$/);
    await expectAccessible(page);

    // Nothing filled in: each problem is said on its field, and the first one gets the focus.
    await page.getByRole('button', { name: 'Put my business on BUKU' }).click();
    await expect(page.getByText('Please enter the business’s name.')).toBeVisible();
    await expect(page.getByText('Please choose what kind of business it is.')).toBeVisible();
    await expect(
      page.getByText('Set where the business is: use your location, or paste it from a map.'),
    ).toBeVisible();
    await expect(
      page.getByText('Please agree to the business terms to put your business on BUKU.'),
    ).toBeVisible();
    await expect(page.getByLabel('Business name')).toBeFocused();

    const name = `Setup Test Studio ${randomUUID().slice(0, 6)}`;
    await page.getByLabel('Business name').fill(name);
    await page.getByLabel('What kind of business').selectOption({ label: 'Barbershop' });
    await page.getByLabel('Street address').fill('12 Main Boulevard, Gulberg');
    await page.getByLabel('City').fill('Lahore');
    await page.getByLabel('Or paste it from a map').fill('31.5204, 74.3587');
    await expect(page.getByText('31.52040, 74.35870')).toBeVisible();
    await page.getByRole('checkbox', { name: /business terms/ }).click();
    await page.getByRole('button', { name: 'Put my business on BUKU' }).click();

    await expect(page).toHaveURL(/\/business\/[0-9a-f-]{36}\/setup$/, { timeout: 20_000 });
    const id = /\/business\/([0-9a-f-]{36})\//.exec(page.url())![1]!;
    made.push(id);

    // Opening hours: the usual week to start from, Sunday closed.
    await expect(page.getByRole('switch', { name: 'Sunday' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Save opening hours' }).click();
    await expect(page.getByText('Mon', { exact: true })).toBeVisible();

    // The first service, done by the owner.
    await page.getByLabel('Service', { exact: true }).fill('Haircut');
    await page.getByLabel(/^Price/).fill('800');
    await expect(page.getByRole('radio', { name: /Me, Sana Malik/ })).toBeChecked();
    await page.getByRole('button', { name: 'Add this service' }).click();
    await expect(page.getByRole('heading', { name: 'Your page is live' })).toBeVisible({ timeout: 20_000 });

    // Its logo and a cover photo (described for people who can't see it), cleaned by the API.
    await page.getByLabel('Logo file').setInputFiles({
      name: 'logo.png',
      mimeType: 'image/png',
      buffer: png(400, 400, [6, 127, 93]),
    });
    await expect(page.getByRole('img', { name: `${name}’s logo` })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel('Photo file').setInputFiles({
      name: 'front.png',
      mimeType: 'image/png',
      buffer: png(800, 600, [244, 248, 246]),
    });
    await page.getByLabel('Describe it').fill('The front of the shop');
    await page.getByRole('button', { name: 'Add the photo' }).click();
    await expect(page.getByRole('img', { name: 'The front of the shop' })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Cover', { exact: true })).toBeVisible();
    await expectAccessible(page);

    // Its own page: live, not verified, everything set up.
    await page.getByRole('link', { name: `Go to ${name}` }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Live, not verified yet')).toBeVisible();
    await expect(page.getByText('3 of 3 done')).toBeVisible();
    await expectAccessible(page);

    // The public page says "Not verified", shows the cover, and offers the service.
    await page.getByRole('link', { name: 'See your page' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByRole('img', { name: 'The front of the shop' })).toBeVisible();
    await expect(page.getByText('Haircut').first()).toBeVisible();
    await expect(page.getByText('Not verified').first()).toBeVisible();

    // And the account lists it.
    await page.goto('/business');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a kind BUKU doesn’t list: a name that means the same is spotted; a new one is added and used', async ({
    page,
  }) => {
    test.slow();
    await signInAsOwner(page);
    const problems = await watchForProblems(page);
    // The form answers once its scripts are running (a choice made before that is reset).
    await page.goto('/business/new', { waitUntil: 'networkidle' });
    await page.getByLabel('What kind of business').selectOption({ label: 'Something else…' });
    await page.getByLabel('The group it’s closest to').selectOption({ label: 'Beauty & Hair' });

    // The same as one BUKU lists: said as it's typed, and offered instead of a copy.
    await page.getByLabel('What kind of business it is').fill('Barber shops');
    await expect(page.getByRole('status').filter({ hasText: 'already on BUKU as Barbershop' })).toBeVisible();

    // Something that would deface the list is refused on the field.
    await page.getByLabel('What kind of business it is').fill('Kebab / Grill');
    await page.getByRole('button', { name: 'Put my business on BUKU' }).click();
    await expect(page.getByText("Letters, numbers, spaces and & ' - only.")).toBeVisible();

    // A new kind: added (pending review) and the business is registered under it.
    const kind = `Henna studio ${Array.from({ length: 6 }, () => String.fromCharCode(97 + randomInt(26))).join('')}`;
    await page.getByLabel('What kind of business it is').fill(kind);
    const name = `Setup Test Studio ${randomUUID().slice(0, 6)}`;
    await page.getByLabel('Business name').fill(name);
    await page.getByLabel('Street address').fill('12 Main Boulevard, Gulberg');
    await page.getByLabel('City').fill('Lahore');
    await page.getByLabel('Or paste it from a map').fill('31.5204, 74.3587');
    await page.getByRole('checkbox', { name: /business terms/ }).click();
    await page.getByRole('button', { name: 'Put my business on BUKU' }).click();
    await expect(page).toHaveURL(/\/business\/[0-9a-f-]{36}\/setup$/, { timeout: 20_000 });
    made.push(/\/business\/([0-9a-f-]{36})\//.exec(page.url())![1]!);
    await page.goto(page.url().replace(/\/setup$/, ''));
    await expect(page.getByText(`${kind} · Lahore`)).toBeVisible();
    expect(problems).toEqual([]);
  });
});
