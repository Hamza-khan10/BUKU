import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { sql } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, watchForProblems } from './helpers';
import { png } from './pictures';

/**
 * A business's menu and team (3.5d), as its owner keeps them: more services in groups, changed
 * and archived; the people customers can book, with their own hours and a photo they agreed to;
 * and a login for someone who works there, its temporary password shown once. The business is
 * removed again afterwards (soft-deleted, as the app removes things).
 */

const made: string[] = [];

/** A fresh owner with a business that has opening hours and one service, made like the site would. */
async function ownerWithBusiness(page: Page): Promise<{ id: string; name: string }> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`team.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill('Sana Malik');
  await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();

  // Like the site's own calls: our header, and from our own address (the pass-through checks both).
  const headers = { 'x-buku-csrf': '1', origin: new URL(page.url()).origin };
  const categories = (await (await page.request.get('/api/v1/categories', { headers })).json()) as {
    data: { children: { id: string; name: string }[] }[];
  };
  const barbershop = categories.data.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const name = `Team Test Studio ${randomUUID().slice(0, 6)}`;
  const created = await page.request.post('/api/v1/businesses', {
    headers,
    data: {
      name,
      categoryId: barbershop.id,
      address: '12 Main Boulevard',
      city: 'Lahore',
      country: 'PK',
      lat: 31.5204,
      lng: 74.3587,
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      acceptedBusinessTermsVersion: '1.0',
    },
  });
  expect(created.status()).toBe(201);
  const { id } = ((await created.json()) as { data: { id: string } }).data;
  made.push(id);
  const week = [1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, openTime: '09:00', closeTime: '18:00' }));
  expect(
    (await page.request.put(`/api/v1/businesses/${id}/hours`, { headers, data: { hours: week } })).ok(),
  ).toBe(true);
  return { id, name };
}

// Each of these tests is its own visitor, so the API's limits count them one by one.
test.describe('A business’s menu and team', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made)
      sql(`UPDATE businesses SET deleted_at = now() WHERE id = '${id}' AND deleted_at IS NULL`);
  });

  test('services in groups: add, change, archive and bring back', async ({ page }) => {
    const problems = await watchForProblems(page);
    const { id } = await ownerWithBusiness(page);
    await page.goto(`/business/${id}/services`);
    await expect(page.getByRole('heading', { level: 1, name: 'Services' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'No services yet' })).toBeVisible();

    for (const [service, price, group] of [
      ['Haircut', '800', 'Hair'],
      ['Beard trim', '400', 'Beard'],
    ] as const) {
      await page.getByRole('button', { name: 'Add a service' }).click();
      await page.getByLabel('Service', { exact: true }).fill(service);
      const groups = page.getByLabel('Group on your menu');
      if ((await groups.locator('option', { hasText: group }).count()) > 0)
        await groups.selectOption({ label: group });
      else {
        await groups.selectOption({ label: 'A new group…' });
        await page.getByLabel('New group’s name').fill(group);
      }
      await page.getByLabel(/^Price/).fill(price);
      await page.getByRole('button', { name: 'Add this service' }).click();
      await expect(page.getByText(`${service} is on your menu.`)).toBeVisible();
    }
    await expect(page.getByRole('region', { name: 'Hair' })).toContainText('Haircut');
    await expect(page.getByRole('region', { name: 'Beard' })).toContainText('Nobody does it yet');
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Change Beard trim' }).click();
    await page.getByLabel(/^Price/).fill('450');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('region', { name: 'Beard' })).toContainText('450');

    await page.getByRole('button', { name: 'Archive Beard trim' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive it' }).click();
    await expect(page.getByText('Beard trim is off your menu.')).toBeVisible();
    await page.getByText('Archived (1)').click();
    await page.getByRole('button', { name: 'Bring it back (Beard trim)' }).click();
    await expect(page.getByText('Beard trim is back on your menu.')).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('a login for someone who works there, its temporary password shown once', async ({ page }) => {
    const problems = await watchForProblems(page);
    const { id } = await ownerWithBusiness(page);
    await page.goto(`/business/${id}/team`);
    // A login, its temporary password shown once.
    await page.getByRole('button', { name: 'Add a login' }).click();
    await page.getByLabel('Their name').fill('Hina Front');
    await page.getByLabel('Username').fill(`hina.${randomUUID().slice(0, 6)}`);
    await page.getByRole('radio', { name: /Front desk/ }).click();
    await page.getByRole('button', { name: 'Make the login' }).click();
    await expect(page.getByRole('heading', { name: 'Hina Front’s login is ready' })).toBeVisible();
    await expect(page.getByText('Temporary password', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'I’ve handed it over' }).click();
    await expect(page.getByText('Temporary password', { exact: true })).toHaveCount(0);
    const row = page
      .getByRole('region', { name: 'Logins' })
      .getByRole('listitem')
      .filter({ hasText: 'Hina Front' });
    await expect(row).toContainText('Still on the temporary password');

    await row.getByRole('button', { name: 'Turn off' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Turn it off' }).click();
    await expect(row).toContainText('Turned off');
    await row.getByRole('button', { name: 'Turn it back on' }).click();
    await expect(row).not.toContainText('Turned off');
    expect(problems).toEqual([]);
  });
});

test.describe('A business’s team: people and photos', () => {
  // The page sends photos straight to storage, which allows only the headers it expects.
  test.use({ ownAddress: false });

  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made)
      sql(`UPDATE businesses SET deleted_at = now() WHERE id = '${id}' AND deleted_at IS NULL`);
  });

  test('a person customers can book, with their own hours and a photo they agreed to', async ({ page }) => {
    const problems = await watchForProblems(page);
    const { id } = await ownerWithBusiness(page);
    await page.request.post(`/api/v1/businesses/${id}/services`, {
      headers: { 'x-buku-csrf': '1', origin: new URL(page.url()).origin },
      data: { name: 'Haircut', durationMinutes: 30, price: 800 },
    });

    await page.goto(`/business/${id}/team`);
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
    await page.getByRole('button', { name: 'Add a person' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Ali Raza');
    await page.getByRole('checkbox', { name: 'Haircut' }).click();
    await page.getByRole('radio', { name: /Their own hours/ }).click();
    await page.getByRole('switch', { name: 'Saturday' }).click();
    await page.getByRole('button', { name: 'Add them' }).click();
    await expect(page.getByText('Ali Raza can be booked now.')).toBeVisible();

    // Their photo: only once the box says they agreed.
    const choose = page.getByRole('button', { name: 'Choose a photo' });
    await expect(choose).toBeDisabled();
    await page.getByRole('checkbox', { name: /Ali Raza agreed/ }).click();
    await expect(choose).toBeEnabled();
    await page.getByLabel('Ali Raza’s photo file').setInputFiles({
      name: 'ali.png',
      mimeType: 'image/png',
      buffer: png(400, 400, [13, 42, 32]),
    });
    await expect(page.getByText('Ali Raza’s photo is saved.')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('main').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page
        .getByRole('region', { name: 'People customers can book' })
        .getByRole('listitem')
        .filter({ hasText: 'Ali Raza' }),
    ).toContainText('Mon to Fri, 09:00 to 18:00');
    await expectAccessible(page);
    expect(problems).toEqual([]);
  });
});
