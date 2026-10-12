import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { sql } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

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
    await expectAccessible(page);

    // Its own page: live, not verified, everything set up.
    await page.getByRole('link', { name: `Go to ${name}` }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Live, not verified yet')).toBeVisible();
    await expect(page.getByText('3 of 3 done')).toBeVisible();
    await expectAccessible(page);

    // The public page says "Not verified" and offers the service, done by the owner.
    await page.getByRole('link', { name: 'See your page' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await expect(page.getByText('Haircut').first()).toBeVisible();
    await expect(page.getByText('Not verified').first()).toBeVisible();

    // And the account lists it.
    await page.goto('/business');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  });
});
