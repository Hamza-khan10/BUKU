import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible, useTheme } from './helpers';

/** Pricing and categories (D-137): the plans at launch and every kind of place, standing without the API. */

const api = process.env.E2E_API_URL ?? 'http://localhost:8000';

test.describe('Pricing (D-137)', () => {
  const essential = (page: Page) => page.getByRole('article', { name: 'Essential' });

  test('rupees for a visitor in Pakistan, dollars elsewhere, and either is a click away', async ({
    page,
    browser,
  }) => {
    await page.setExtraHTTPHeaders({ 'cf-ipcountry': 'PK' });
    await page.goto('/pricing');
    await expect(essential(page)).toContainText('Rs 2,499');
    // As a person does: on the pill's label (the radio inside is for screen readers).
    await page.locator('label').filter({ hasText: /^USD$/ }).click();
    await expect(page.getByRole('radio', { name: 'USD' })).toBeChecked();
    await expect(essential(page)).toContainText('$15');
    await expect(essential(page)).not.toContainText('Rs');

    const elsewhere = await browser.newPage({ extraHTTPHeaders: { 'cf-ipcountry': 'GB' } });
    await elsewhere.goto('/pricing');
    await expect(essential(elsewhere)).toContainText('$15');
    await elsewhere.close();
  });

  test('yearly: twelve months for the price of ten', async ({ page }) => {
    await page.goto('/pricing?currency=usd');
    await page.locator('label').filter({ hasText: 'Yearly' }).click();
    await expect(page.getByRole('radio', { name: /Yearly/ })).toBeChecked();
    await expect(essential(page)).toContainText('$13');
    await expect(essential(page)).toContainText('$150 billed yearly');
    await expect(page.getByRole('article', { name: 'Network' })).toContainText(
      '$290 billed yearly, a branch',
    );
  });

  test('free to start, one plan to try, every plan side by side, free for people who book', async ({
    page,
  }) => {
    await page.goto('/pricing');
    await expect(page.getByRole('article', { name: 'Starter' })).toContainText('Free');
    await expect(page.getByRole('article', { name: 'Professional' })).toContainText(
      'Try it free for 30 days',
    );
    const table = page.getByRole('table', { name: 'What each plan includes' });
    for (const plan of ['Starter', 'Essential', 'Professional', 'Network', 'Enterprise'])
      await expect(table.getByRole('columnheader', { name: plan })).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'For people booking and queueing: free', level: 2 }),
    ).toBeVisible();
  });

  test('each plan leads on: early access before launch, adding a business after', async ({ page }) => {
    await page.goto('/pricing');
    const href = await essential(page).getByRole('link').getAttribute('href');
    expect(
      href === '/business/new' || href === '/early-access?as=business&plan=essential&source=pricing',
    ).toBe(true);
  });

  test('the answers engines read are the ones on the page', async ({ page }) => {
    await page.goto('/pricing');
    const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map(
      (t) => JSON.parse(t) as { '@type': string; mainEntity?: { name: string }[] },
    );
    const faq = data.find((d) => d['@type'] === 'FAQPage')!;
    const section = page.getByRole('region', { name: 'Questions about pricing.' });
    for (const { name } of faq.mainEntity!) await expect(section.getByRole('button', { name })).toBeVisible();
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
    await page.goto('/pricing');
    await expectAccessible(page);
    await page.goto('/for-business');
    await expectAccessible(page);
  });

  test('for businesses: leads to the business plans', async ({ page }) => {
    await page.goto('/for-business');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('A calm front desk');
    await page.getByRole('link', { name: 'See plans and prices' }).click();
    await expect(page).toHaveURL(/\/pricing#businesses$/);
    await expect(essential(page)).toBeVisible();
  });
});

test.describe('Categories without the API (D-137)', () => {
  test('every kind BUKU covers, findable by typing, accessible', async ({ page }) => {
    await page.goto('/categories');
    await expect(page.getByText(/\d+ kinds of place in 11 groups/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Beauty & Hair', level: 2 })).toBeVisible();
    await page.getByLabel('Find a kind of place').fill('passport');
    await expect(page.getByText('Passport Office').first()).toBeVisible();
    await expectAccessible(page);
  });
});

test.describe('The sitemap', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('the sitemap lists the public pages and every listed business', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    for (const path of ['/pricing', '/for-business', '/legal/privacy', '/categories'])
      expect(xml).toContain(`${path}</loc>`);
    // The sitemap is cached for an hour and other tests add and close businesses meanwhile, so it is
    // checked against the businesses that stay: the verified ones (tests only ever make new ones).
    const verified: string[] = [];
    for (let page = 1; ; page++) {
      const res = (await (await fetch(`${api}/v1/businesses/search?limit=50&page=${page}`)).json()) as {
        data: { slug: string; verified: boolean }[];
        meta: { totalPages: number };
      };
      verified.push(...res.data.filter((b) => b.verified).map((b) => b.slug));
      if (page >= res.meta.totalPages) break;
    }
    expect(verified.length).toBeGreaterThan(0);
    for (const slug of verified) expect(xml).toContain(`/b/${slug}</loc>`);
    // Only business pages by their own address, nothing else under /b/.
    for (const loc of xml.match(/\/b\/[^<]+<\/loc>/g) ?? []) expect(loc).toMatch(/^\/b\/[a-z0-9-]+<\/loc>$/);
  });
});
