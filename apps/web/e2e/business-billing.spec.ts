import { randomUUID } from 'node:crypto';
import { goToPage, openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * The business's plan (3.5k), as the development stack has it: BUKU isn't charging businesses,
 * so everything is included and there's nothing to buy; the owner can still ask BUKU for a plan,
 * and withdraw the request. (Paying, switching and the trial are the unit tests' and billing's own
 * integration tests': switching billing on here would change it for every other test.)
 */

const made: string[] = [];

test.describe('The plan', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('everything included, the plans for later, and asking BUKU for one', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, `plan.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Plan Test');

    await page.goto(`/business/${place.id}`);
    await goToPage(page, place.name, 'Plan');
    await expect(page).toHaveURL((url) => url.pathname === `/business/${place.id}/billing`);
    await expect(page.getByRole('heading', { name: 'Plan', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Everything is included' })).toBeVisible();

    // What it uses: counted, with no limit while everything is included.
    const limits = page.getByRole('list', { name: 'Limits' });
    await expect(limits.getByRole('listitem')).not.toHaveCount(0);
    await expect(limits).toContainText('no limit');
    await expect(limits.getByText('At the limit')).toHaveCount(0);

    // The plans, for when BUKU starts charging: nothing to buy yet.
    const plans = page.getByRole('region', { name: 'Plans' });
    await expect(plans.getByRole('heading', { name: 'Enterprise' })).toBeVisible();
    // The launch prices, a month each (D-137); Network on sale; Enterprise priced for each chain.
    await expect(plans.getByRole('heading', { name: 'Network' })).toBeVisible();
    await expect(plans.getByText('$15', { exact: true })).toBeVisible();
    await expect(plans.getByText('Priced for your chain')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Choose / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Switch to / })).toHaveCount(0);
    await expectAccessible(page);

    // Ask BUKU for a plan: too short is caught here; then sent, waiting, and withdrawn.
    await page.getByLabel('Which plan').selectOption({ label: 'Enterprise' });
    const about = page.getByLabel('Tell BUKU about the business');
    await about.fill('Big');
    await page.getByRole('button', { name: 'Send the request' }).click();
    await expect(page.getByText('Tell BUKU a little more: at least 10 characters.')).toBeVisible();
    await expect(about).toHaveAttribute('aria-invalid', 'true');
    await about.fill('A clinic group with 14 branches and 300 staff.');
    await page.getByRole('button', { name: 'Send the request' }).click();
    await expect(page.getByText('Waiting for BUKU')).toBeVisible();
    await expect(page.getByText('A clinic group with 14 branches and 300 staff.')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Withdraw the request' }).click();
    const earlier = page.getByRole('list', { name: 'Earlier requests' });
    await expect(earlier).toContainText('Enterprise');
    await expect(earlier).toContainText('Withdrawn');
    await expect(page.getByRole('button', { name: 'Send the request' })).toBeVisible();
  });

  /**
   * The step past the cap (3.7k, D-146). An account holds five businesses and creating them is
   * limited to five an hour, so a test can't reach the cap through the API; the API's refusal at
   * the cap is business-service's integration tests'. Here the app is given that refusal as the
   * API sends it, and everything after it is real: the request reaches billing.
   */
  const atTheCap = async (page: Page, fromNetwork: boolean) => {
    await page.route('**/api/v1/businesses', (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({
            status: 409,
            contentType: 'application/json',
            body: JSON.stringify({
              success: false,
              error: {
                code: 'PLAN_LIMIT_REACHED',
                message: 'An account holds up to 5 businesses; more is Enterprise',
                details: {
                  limit: 'businesses',
                  max: 5,
                  used: 5,
                  upgrade: 'business_enterprise',
                  fromNetwork,
                },
                requestId: randomUUID(),
              },
            }),
          })
        : route.continue(),
    );
  };
  const addTheSixth = async (page: Page) => {
    await page.goto('/business/new', { waitUntil: 'networkidle' });
    await page.getByLabel('Business name').fill('Chain Cuts Johar Town');
    await page.getByLabel('What kind of business').selectOption({ label: 'Barbershop' });
    await page.getByLabel('Street address').fill('6 Main Boulevard, Johar Town');
    await page.getByLabel('City').fill('Lahore');
    await page.getByLabel('Or paste it from a map').fill('31.4697, 74.2728');
    await page.getByRole('checkbox', { name: /business terms/ }).click();
    await page.getByRole('button', { name: 'Put my business on BUKU' }).click();
  };

  test('a Network chain adding its sixth branch is celebrated and asks for Enterprise', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, `chain.owner.${randomUUID()}@example.com`, 'Bilal Ahmed', true);
    const first = await openBusiness(page, made, 'Chain Cuts');
    await atTheCap(page, true);
    await addTheSixth(page);

    const step = page.getByRole('region', { name: 'Your sixth branch' });
    await expect(step).toBeVisible();
    await expect(step).toBeFocused();
    await expect(step).toContainText('first ad free');
    await expectAccessible(page);
    await expect(page.getByLabel('Business name')).toHaveValue('Chain Cuts Johar Town'); // nothing lost

    await step.getByRole('button', { name: 'Request Enterprise' }).click();
    await expect(page.getByRole('heading', { name: 'Request sent' })).toBeVisible();
    // The request is real: on their plan page, waiting for BUKU.
    await page.goto(`/business/${first.id}/billing`);
    await expect(
      page.getByText('Moving up from Network: adding our sixth branch, Chain Cuts Johar Town in Lahore.'),
    ).toBeVisible();
  });

  test('anyone else at the cap is shown the plain way to Enterprise, without the gift', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page, `full.owner.${randomUUID()}@example.com`, 'Sara Khan', true);
    await openBusiness(page, made, 'Full Account');
    await atTheCap(page, false);
    await addTheSixth(page);
    const step = page.getByRole('region', { name: 'More than 5 businesses is Enterprise' });
    await expect(step).toBeVisible();
    await expect(step).not.toContainText('first ad free');
    await expect(step.getByRole('button', { name: 'Request Enterprise' })).toBeEnabled();
  });
});
