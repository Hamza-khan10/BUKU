import { randomUUID } from 'node:crypto';
import { openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
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
    await page.getByRole('link', { name: 'Plan', exact: true }).click();
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
});
