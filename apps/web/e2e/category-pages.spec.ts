import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { expectAccessible } from './helpers';

/**
 * A page for every category (D-139): before launch (or without the API) its guide; after launch
 * the places, with the same guide after them. Either way the guide, its questions and its place in
 * the site are there for people and for search engines.
 */

const structured = async (page: Page) =>
  (await page.locator('script[type="application/ld+json"]').allTextContents()).map(
    (t) =>
      JSON.parse(t) as {
        '@type': string;
        mainEntity?: { name: string }[];
        itemListElement?: { name: string }[];
      },
  );

test.describe('Category pages', () => {
  test('a queue kind leads with the queue, its questions are the ones engines read', async ({ page }) => {
    await page.goto('/c/passport-office');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Passport Office');
    await expect(page).toHaveTitle('Passport Office queue online: skip the wait · BUKU');
    await expect(page.getByText('New passports, renewals and corrections')).toBeVisible();
    const data = await structured(page);
    const faq = data.find((d) => d['@type'] === 'FAQPage')!;
    expect(faq.mainEntity![0]!.name).toBe('Can I join the passport office queue from home?');
    const crumbs = data.find((d) => d['@type'] === 'BreadcrumbList')!;
    expect(crumbs.itemListElement!.map((i) => i.name)).toEqual([
      'Home',
      'Categories',
      'Government & Public',
      'Passport Office',
    ]);
    const section = page.getByRole('region', { name: 'Questions people ask.' });
    for (const { name } of faq.mainEntity!) await expect(section.getByRole('button', { name })).toBeVisible();
  });

  test('a group lists its kinds, each leading to its own page', async ({ page }) => {
    await page.goto('/c/health-medical');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Health & Medical');
    await page.getByRole('link', { name: 'ENT Specialist' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ENT Specialist');
    await expect(page.getByText('Run an ENT specialist?')).toBeVisible();
  });

  test('the categories page and the footer lead to them; an unknown one is a 404', async ({
    page,
    request,
  }) => {
    await page.goto('/categories');
    await page.getByRole('link', { name: 'Barbershop' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Barbershop');
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Dental clinics' })).toHaveAttribute(
      'href',
      '/c/dental-clinic',
    );
    expect((await request.get('/c/no-such-category')).status()).toBe(404);
  });

  test('passes WCAG 2.2 AA', async ({ page }) => {
    await page.goto('/c/barbershop');
    await expectAccessible(page);
  });
});
