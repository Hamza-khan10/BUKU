import { randomUUID } from 'node:crypto';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * Your plan — against the development stack, where paid plans are switched
 * off (the other states, trial and paid, are unit-tested in test/plan.test.ts:
 * switching billing on would change every other test running alongside).
 */

test.describe('Your plan', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('while paid plans are off: everything is free, nothing to buy or try', async ({ page }) => {
    await page.goto('/signin');
    await page.getByLabel('Email').fill(`plan.${randomUUID()}@example.com`);
    await page.getByLabel(/^Name/).fill('Zainab Plan');
    await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('link', { name: 'Skip for now' }).click();

    await page.goto('/account');
    await page.getByRole('navigation', { name: 'Your account' }).getByRole('link', { name: 'Plan' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/account/plan');
    const plan = page.getByRole('region', { name: 'Your plan' });
    await expect(plan.getByRole('heading', { name: 'Everything is free right now' })).toBeVisible();
    await expect(plan).toContainText('no limits on bookings or queues');
    await expect(page.getByRole('region', { name: 'Free trial' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Stop renewing|Payment details/ })).toHaveCount(0);
    await expectAccessible(page);

    await page.getByRole('link', { name: 'See every plan and what it includes' }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/pricing');
  });
});
