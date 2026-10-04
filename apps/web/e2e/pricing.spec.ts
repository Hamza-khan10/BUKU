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

  test('shows the catalog’s own plans and prices, and says when paid plans are off', async ({ page }) => {
    const [user, business] = await Promise.all([catalog('user'), catalog('business')]);
    await page.goto('/pricing');
    for (const p of [...user.plans, ...business.plans]) {
      await expect(page.getByRole('heading', { name: p.name, exact: true }).first()).toBeVisible();
      if (!p.free) await expect(page.getByText(`$${p.prices[0]!.amount}`).first()).toBeVisible();
    }
    if (!business.billingEnabled) {
      await expect(
        page.getByText('Right now, everything is included for businesses — at no cost'),
      ).toBeVisible();
    }
    // The iPhone price is the App Store's, and the page says so with the real number.
    const ios = await catalog('user', 'ios');
    const iosPlus = ios.plans.find((p) => !p.free)?.prices[0]?.amount;
    if (iosPlus) await expect(page.getByText(new RegExp(`iPhone app it’s \\$${iosPlus}`))).toBeVisible();
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
