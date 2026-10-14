import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, useTheme } from './helpers';

/** Pricing and "for businesses": every number from the plan catalog, nothing promised that isn't offered. */

const api = process.env.E2E_API_URL ?? 'http://localhost:8000';

interface Catalog {
  billingEnabled: boolean;
  plans: { name: string; free: boolean; prices: { amount: string }[] }[];
}

const catalog = async (audience: string, channel = 'web') =>
  (
    (await (await fetch(`${api}/v1/billing/plans?audience=${audience}&channel=${channel}`)).json()) as {
      data: Catalog;
    }
  ).data;

test.describe('Pricing', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('booking is free: no customer plans, only the catalog’s business plans and prices', async ({
    page,
  }) => {
    const [user, business] = await Promise.all([catalog('user'), catalog('business')]);
    await page.goto('/pricing');
    await expect(
      page.getByRole('heading', { name: 'For people booking and queueing: free', level: 2 }),
    ).toBeVisible();
    for (const p of business.plans) {
      await expect(page.getByRole('heading', { name: p.name, exact: true }).first()).toBeVisible();
      if (!p.free) await expect(page.getByText(`$${p.prices[0]!.amount}`).first()).toBeVisible();
    }
    if (!business.billingEnabled) {
      await expect(
        page.getByText('Right now, everything is included for businesses, at no cost'),
      ).toBeVisible();
    }
    // The customer plans stay in the catalog, unused (D-101): none of them is offered here.
    for (const p of user.plans.filter((plan) => !plan.free)) {
      await expect(page.getByRole('heading', { name: p.name, exact: true })).toHaveCount(0);
    }
  });

  test('the old “your plan” page leads to the account', async ({ request }) => {
    const res = await request.get('/account/plan', { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers().location).toBe('/account');
  });

  test('promises nothing BUKU doesn’t offer yet (no ads anywhere)', async ({ page }) => {
    await page.goto('/pricing');
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\bads?\b/i);
  });

  test('passes WCAG 2.2 AA, light and dark', async ({ page, context, baseURL }) => {
    await page.goto('/pricing');
    await expectAccessible(page);
    await useTheme(context, 'dark', baseURL!);
    await page.goto('/for-business');
    await expectAccessible(page);
  });

  test('for businesses: leads to the business plans', async ({ page }) => {
    await page.goto('/for-business');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A calm front desk');
    await page.getByRole('link', { name: 'See plans and prices' }).click();
    await expect(page).toHaveURL(/\/pricing#businesses$/);
    await expect(page.getByRole('heading', { name: 'For businesses', level: 2 })).toBeVisible();
  });

  test('the sitemap lists the public pages and every listed business', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    for (const path of ['/pricing', '/for-business', '/legal/privacy', '/categories'])
      expect(xml).toContain(`${path}</loc>`);
    const listed = (
      (await (await fetch(`${api}/v1/businesses/search?limit=1`)).json()) as { meta: { total: number } }
    ).meta.total;
    expect((xml.match(/\/b\/[a-z0-9-]+<\/loc>/g) ?? []).length).toBe(listed);
  });
});
