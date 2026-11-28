import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, sidewaysOverflow } from './helpers';

/**
 * Where people land after signing in with nowhere particular to go (/start): their own home, not
 * the page that explains BUKU to a first-time visitor; an owner straight into their business, or
 * a choice between their businesses. Against the development stack.
 */

const onPage = (path: string) => (url: URL) => url.pathname === path;
const newEmail = () => `landing.${randomUUID()}@example.com`;

/** A returning account signing in on another device: no welcome this time. */
async function signInAgain(browser: Browser, email: string, name: string): Promise<Page> {
  // Its own context: a separate device, with its own cookies.
  const page = await (await browser.newContext()).newPage();
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  return page;
}

test.describe('After signing in', () => {
  const made: string[] = [];

  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('someone with no business lands on their own home, not the guide for first-time visitors', async ({
    page,
  }) => {
    await signIn(page, newEmail(), 'Hina Akhtar', false);
    await expect(page).toHaveURL(onPage('/'));
    await expect(page.getByRole('heading', { level: 1, name: /, Hina$/ })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: /No one should wait/ })).toHaveCount(0);
    // Nothing booked yet: the board invites them to take a number.
    const now = page.getByRole('region', { name: 'Right now' });
    await expect(now.getByText(/^No number yet\./)).toBeVisible();
    await expect(now.getByRole('link', { name: 'Find a place' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Kinds of place' })).toBeVisible();
    // Not an owner: no businesses on their home.
    await expect(page.getByRole('heading', { name: /^Your business/ })).toHaveCount(0);
    await expectAccessible(page);
    expect(await sidewaysOverflow(page)).toBe(0);
  });

  test('an owner with one business goes straight into it; with two, chooses', async ({ page, browser }) => {
    test.slow();
    const email = newEmail();
    await signIn(page, email, 'Kamran Butt', true);
    const first = await openBusiness(page, made, 'Landing One');

    // Home shows the business, a tap from its workspace.
    await page.goto('/');
    const theirs = page.getByRole('region', { name: 'Your business' });
    await expect(theirs.getByRole('link', { name: new RegExp(first.name) })).toBeVisible();

    // Signing in again: straight into the workspace.
    const again = await signInAgain(browser, email, 'Kamran Butt');
    await expect(again).toHaveURL(onPage(`/business/${first.id}`));
    await again.context().close();

    // A second business: the next sign-in asks where to.
    const second = await openBusiness(page, made, 'Landing Two');
    const third = await signInAgain(browser, email, 'Kamran Butt');
    await expect(third).toHaveURL(onPage('/start'));
    await expect(third.getByRole('heading', { level: 1, name: 'Where to, Kamran?' })).toBeVisible();
    await expect(third.getByRole('link', { name: new RegExp(first.name) })).toBeVisible();
    await expect(third.getByRole('link', { name: /For yourself/ })).toBeVisible();
    await expectAccessible(third);
    await third.getByRole('link', { name: new RegExp(second.name) }).click();
    await expect(third).toHaveURL(onPage(`/business/${second.id}`));
    await third.context().close();
  });

  test('a page asked for before signing in is still where sign-in goes', async ({ page }) => {
    await page.goto('/signin?next=/help');
    await page.getByLabel('Email').fill(newEmail());
    await page.getByLabel(/^Name/).fill('Zara Iqbal');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(onPage('/help'));
  });
});
