import { randomUUID } from 'node:crypto';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';
import { teamBusiness, type Team } from './team';

/**
 * The walk-in queue from a customer's phone: join from nearby, follow the
 * live ticket until it's their turn, leave. Runs against the dev stack, on the
 * test business (in Lahore), whose owner opens the queue and calls tickets.
 */

const NEARBY = { latitude: 31.5206, longitude: 74.359 }; // a few hundred metres from the business
const KARACHI = { latitude: 24.8607, longitude: 67.0011 }; // ~1,000 km away

async function signIn(page: Page, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`queue.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

async function at(context: BrowserContext, where: { latitude: number; longitude: number }) {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation(where);
}

test.describe('Walk-in queue', () => {
  // One after another: they share the test business's queue.
  test.describe.configure({ mode: 'default' });
  let team: Team;

  test.beforeAll(async ({ baseURL }) => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    team = await teamBusiness(baseURL!);
    // Open today's queue (already open from an earlier run is fine).
    const opened = await team.owner.post(`/api/v1/businesses/${team.business.id}/queue/open`);
    expect([200, 201, 409]).toContain(opened.status());
  });

  test.afterAll(async () => {
    await team?.owner.post(`/api/v1/businesses/${team.business.id}/queue/close`);
  });

  test('join from nearby, follow the ticket live until it’s your turn', async ({ page, context }) => {
    await at(context, NEARBY);
    await signIn(page, 'Sara Waiting');
    await page.goto(`/b/${team.business.slug}`);
    const card = page.getByRole('region', { name: 'Walk-in queue' });
    await expect(card.getByText('Joining checks once that you’re within')).toBeVisible();
    await card.getByRole('button', { name: 'Join the queue' }).click();

    await expect(page).toHaveURL(/\/queue\/[0-9a-f-]{36}\?joined=1$/);
    await expect(page.getByRole('heading', { name: 'You’re in the queue' })).toBeVisible();
    await expect(page.getByText('This page updates by itself. Keep it open.')).toBeVisible();
    const entryId = new URL(page.url()).pathname.split('/').pop()!;
    const code = (await page
      .getByText(/^[A-Z]{1,3}-\d{3}$/)
      .first()
      .textContent())!;
    await expectAccessible(page);

    // The business page now shows the ticket instead of a second "Join".
    const business = await page.context().newPage();
    await business.goto(`/b/${team.business.slug}`);
    await expect(business.getByRole('region', { name: 'Walk-in queue' }).getByText(code)).toBeVisible();
    await business.close();

    // The front desk calls this ticket: the open page changes by itself.
    const called = await team.owner.post(
      `/api/v1/businesses/${team.business.id}/queue/entries/${entryId}/call`,
    );
    expect(called.ok()).toBe(true);
    await expect(page.getByText('It’s your turn', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Go to the counter')).toBeVisible();
    await expect(page.getByText(/^Please be there by /)).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`It’s your turn: ${code}`));
  });

  test('too far away: says how far, and where joining works', async ({ page, context }) => {
    await at(context, KARACHI);
    await signIn(page, 'Far Away');
    await page.goto(`/b/${team.business.slug}`);
    await page
      .getByRole('region', { name: 'Walk-in queue' })
      .getByRole('button', { name: 'Join the queue' })
      .click();
    await expect(page.getByText(/^You’re [\d,.]+ km away\.$/)).toBeVisible();
    await expect(page.getByText(/You can join from within .+, or at the counter\./)).toBeVisible();
  });

  test('location turned off: explains, instead of failing', async ({ page }) => {
    await signIn(page, 'No Location');
    await page.goto(`/b/${team.business.slug}`);
    await page
      .getByRole('region', { name: 'Walk-in queue' })
      .getByRole('button', { name: 'Join the queue' })
      .click();
    await expect(page.getByText(/Location is turned off for this site/)).toBeVisible();
  });

  test('leaving gives the place to the next person; the account page shows the ticket meanwhile', async ({
    page,
    context,
  }) => {
    await at(context, NEARBY);
    await signIn(page, 'Leaving Early');
    await page.goto(`/b/${team.business.slug}`);
    await page
      .getByRole('region', { name: 'Walk-in queue' })
      .getByRole('button', { name: 'Join the queue' })
      .click();
    await expect(page.getByRole('heading', { name: 'You’re in the queue' })).toBeVisible();
    const ticketUrl = page.url();

    await page.goto('/account');
    const place = page.getByRole('region', { name: 'Your place in a queue' });
    await expect(place).toContainText('Team Sign-in Test Studio');
    await place.getByRole('link').click();
    await expect(page).toHaveURL(new URL(ticketUrl).pathname);

    await page.getByRole('button', { name: 'Leave the queue' }).click();
    const dialog = page.getByRole('dialog', { name: 'Leave the queue?' });
    await expect(dialog.getByText('You can join again, but at the back of the line.')).toBeVisible();
    await dialog.getByRole('button', { name: 'Leave the queue' }).click();
    await expect(page.getByText('You left the queue').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Leave the queue' })).toHaveCount(0);
  });
});
