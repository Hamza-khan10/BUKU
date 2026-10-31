import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * The front desk's queue (3.5c), against the development stack: the owner opens a new business's
 * queue for the day, adds two walk-ins (one in the priority lane), calls the next person, serves
 * and finishes them, and closes the queue with someone still waiting. The waiting-room screen —
 * open without signing in — follows every step live. The business is removed afterwards.
 */

const made: string[] = [];
const TICKET = /[A-Z]{1,3}-\d{3}/;

async function ownerWithBusiness(page: Page): Promise<{ id: string; slug: string; name: string }> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`desk.queue.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill('Nadia Rauf');
  await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  const headers = { 'x-buku-csrf': '1', origin: new URL(page.url()).origin };
  const categories = (await (await page.request.get('/api/v1/categories', { headers })).json()) as {
    data: { children: { id: string; name: string }[] }[];
  };
  const category = categories.data.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const name = `Queue Desk Test ${randomUUID().slice(0, 6)}`;
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
  const business = ((await res.json()) as { data: { id: string; slug: string } }).data;
  made.push(business.id);
  return { ...business, name };
}

test.describe('Front desk queue', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('open, add walk-ins, call, serve, finish and close — the waiting-room screen follows', async ({
    page,
    browser,
    baseURL,
  }) => {
    const business = await ownerWithBusiness(page);
    await page.goto(`/business/${business.id}/queue`);
    await expect(page.getByRole('heading', { name: 'Queue', exact: true })).toBeVisible();
    const today = page.getByRole('region', { name: 'Today’s queue' });
    await expect(today.getByText('Not opened today')).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: business.name }).getByRole('link', { name: 'Queue' }),
    ).toHaveAttribute('aria-current', 'page');

    // The waiting-room screen: no sign-in (its own browser, no cookies).
    const tv = await browser.newContext({ baseURL });
    const screen = await tv.newPage();
    await screen.goto(`/b/${business.slug}/screen`);
    await expect(screen.getByRole('heading', { name: business.name })).toBeVisible();
    await expect(screen.getByText('The queue is closed for today.')).toBeVisible();

    await today.getByRole('button', { name: 'Open the queue' }).click();
    await expect(today.getByText('Open', { exact: true })).toBeVisible();
    await expect(screen.getByRole('region', { name: 'Next' }).getByText('Nobody is waiting.')).toBeVisible({
      timeout: 15_000,
    });

    // Two walk-ins: one with a name in the priority lane, one who'd rather not give a name.
    const walkIn = page.getByRole('region', { name: 'Add a walk-in' });
    await walkIn.getByLabel(/^Their name/).fill('Bilal Ahmed');
    await walkIn.getByRole('checkbox', { name: 'Priority lane' }).click();
    const added = walkIn.getByRole('status').filter({ hasText: 'Their ticket is' });
    await walkIn.getByRole('button', { name: 'Add to the queue' }).click();
    await expect(added).toContainText(TICKET);
    const first = (await added.textContent())!.match(TICKET)![0];
    await walkIn.getByRole('button', { name: 'Add to the queue' }).click();
    await expect(added).not.toContainText(first);
    const second = (await added.textContent())!.match(TICKET)![0];

    const waiting = page.getByRole('region', { name: 'Waiting' });
    await expect(waiting.getByRole('listitem')).toHaveCount(2);
    await expect(waiting.getByRole('listitem').first()).toHaveAccessibleName(`${first}, Bilal Ahmed`);
    await expect(waiting.getByRole('listitem').first().getByText('Priority')).toBeVisible();
    await expect(screen.getByRole('region', { name: 'Next' })).toContainText(first, { timeout: 15_000 });
    await expectAccessible(page);

    // Call next: the priority lane first. The screen shows it at the counter.
    await page.getByRole('button', { name: 'Call next' }).click();
    const called = page.getByRole('region', { name: 'Called' });
    await expect(called.getByRole('listitem', { name: `${first}, Bilal Ahmed` })).toBeVisible();
    await expect(screen.getByRole('region', { name: 'Please come to the counter' })).toContainText(first, {
      timeout: 15_000,
    });
    await expectAccessible(screen);

    // They came up: serve, then done.
    await called.getByRole('button', { name: 'They’re here' }).click();
    const serving = page.getByRole('region', { name: 'Being served' });
    await expect(serving.getByRole('listitem', { name: `${first}, Bilal Ahmed` })).toBeVisible();
    await serving.getByRole('button', { name: 'Done' }).click();
    await expect(serving.getByText('Nobody is being served right now.')).toBeVisible();
    await expect(today.getByText(/1 served today/)).toBeVisible();

    // Closing with someone still waiting asks first, and says what happens to them.
    await today.getByRole('button', { name: 'Close for today' }).click();
    const confirm = page.getByRole('dialog', { name: 'Close the queue for today?' });
    await expect(confirm).toContainText('1 person is still in line');
    await confirm.getByRole('button', { name: 'Close for today' }).click();
    await expect(today.getByText('Closed for today')).toBeVisible();
    await expect(waiting.getByRole('listitem')).toHaveCount(0);
    await expect(screen.getByText('The queue is closed for today.')).toBeVisible({ timeout: 15_000 });
    expect(second).not.toBe(first);
    await tv.close();
  });
});
