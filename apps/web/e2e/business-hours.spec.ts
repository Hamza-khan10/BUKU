import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * A business's hours (3.5e), against the development stack: the owner of a new business sets the
 * usual week, opens on Sundays too, then adds closed days — three for Eid (shown, and removed, as
 * one stretch) and an afternoon — and removes the stretch. The business is removed afterwards.
 */

const made: string[] = [];

/** "YYYY-MM-DD", days from today in Karachi (the business's time zone). */
function karachiDate(daysAhead: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

async function ownerWithBusiness(page: Page): Promise<{ id: string; name: string }> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`hours.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill('Hina Qureshi');
  await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  const headers = { 'x-buku-csrf': '1', origin: new URL(page.url()).origin };
  const categories = (await (await page.request.get('/api/v1/categories', { headers })).json()) as {
    data: { children: { id: string; name: string }[] }[];
  };
  const category = categories.data.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const name = `Hours Test ${randomUUID().slice(0, 6)}`;
  const res = await page.request.post('/api/v1/businesses', {
    headers,
    data: {
      name,
      categoryId: category.id,
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
  expect(res.ok(), `create business: ${res.status()} ${await res.text()}`).toBe(true);
  const business = ((await res.json()) as { data: { id: string } }).data;
  made.push(business.id);
  return { id: business.id, name };
}

test.describe('Business hours', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('set the week, open on Sundays, add closed days and remove a stretch', async ({ page }) => {
    const business = await ownerWithBusiness(page);
    await page.goto(`/business/${business.id}/hours`);
    await expect(page.getByRole('heading', { name: 'Hours', exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: business.name }).getByRole('link', { name: 'Hours' }),
    ).toHaveAttribute('aria-current', 'page');

    // The usual week, then Sundays too.
    const hours = page.getByRole('region', { name: 'Opening hours' });
    await hours.getByRole('button', { name: 'Change' }).click();
    await expect(hours.getByRole('switch', { name: 'Sunday' })).not.toBeChecked();
    await hours.getByRole('switch', { name: 'Sunday' }).click();
    await hours.getByRole('button', { name: 'Save opening hours' }).click();
    await expect(hours.getByRole('button', { name: 'Change' })).toBeVisible();
    await expect(hours.getByRole('listitem').filter({ hasText: 'Sun' })).not.toContainText('Closed');

    // Closed for Eid: three days, one stretch.
    const closed = page.getByRole('region', { name: 'Closed days' });
    await expect(closed.getByText('No closed days coming up')).toBeVisible();
    const form = closed.getByRole('form', { name: 'Add closed days' });
    await form.getByLabel('First day').fill(karachiDate(10));
    await form.getByLabel(/^Last day/).fill(karachiDate(12));
    await form.getByLabel(/^Why/).fill('Eid holidays');
    await form.getByRole('button', { name: 'Add closed days' }).click();
    const list = closed.getByRole('list', { name: 'Coming closed days' });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('listitem').first()).toContainText('3 days');
    await expect(list.getByRole('listitem').first()).toContainText('Eid holidays');

    // An afternoon.
    await form.getByLabel('First day').fill(karachiDate(5));
    await form.getByRole('checkbox', { name: 'Only part of the day' }).click();
    await form.getByLabel('Closed from').fill('14:00');
    await form.getByLabel('Until').fill('18:00');
    await form.getByRole('button', { name: 'Add closed days' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list.getByRole('listitem').first()).toContainText('14:00–18:00');
    await expectAccessible(page);

    // A day in the past is refused before anything is sent (the form starts afresh after adding).
    await expect(form.getByRole('checkbox', { name: 'Only part of the day' })).not.toBeChecked();
    await form.getByLabel('First day').fill(karachiDate(-1));
    await form.getByRole('button', { name: 'Add closed days' }).click();
    await expect(form.getByText('Choose today or a later day.')).toBeVisible();

    // The Eid stretch goes in one go.
    await list
      .getByRole('listitem')
      .nth(1)
      .getByRole('button', { name: /^Remove/ })
      .click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list).not.toContainText('Eid holidays');
  });
});
