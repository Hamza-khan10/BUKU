import { expect, test } from './fixtures';
import { expectAccessible, useTheme } from './helpers';

/** The public information and legal pages (WEB_PLAN §3.1). */

const PAGES = [
  '/how-it-works',
  '/about',
  '/contact',
  '/help',
  '/security',
  '/legal',
  '/legal/privacy',
  '/legal/terms',
  '/legal/business-terms',
  '/legal/cookies',
  '/legal/acceptable-use',
  '/legal/refunds',
  '/legal/sub-processors',
];

test.describe('Information pages', () => {
  for (const path of PAGES) {
    test(`${path}: loads with one main heading and passes WCAG 2.2 AA`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
      await expect(page).toHaveTitle(/BUKU/);
      await expectAccessible(page);
    });
  }

  test('legal and trust pages pass WCAG 2.2 AA in dark too', async ({ page, context, baseURL }) => {
    await useTheme(context, 'dark', baseURL!);
    for (const path of ['/legal/privacy', '/help', '/security', '/how-it-works']) {
      await page.goto(path);
      await expectAccessible(page);
    }
  });

  test('no link on the site leads to a missing page', async ({ page, request }) => {
    // Visits every page and follows every link: slow on a busy development server.
    test.slow();
    const seen = new Set<string>();
    for (const path of ['/', ...PAGES]) {
      await page.goto(path);
      const hrefs = await page
        .locator('a[href^="/"]')
        .evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).getAttribute('href')!));
      for (const href of hrefs) seen.add(href.split('#')[0]!);
    }
    for (const href of seen) {
      if (!href) continue;
      const res = await request.get(href, { maxRedirects: 0 });
      expect([href, res.status()]).toEqual([href, 200]);
    }
  });

  test('legal documents: draft label, version, summary first, working contents links', async ({
    page,
    isMobile,
  }) => {
    await page.goto('/legal/privacy');
    await expect(page.getByText('Draft — not yet in effect')).toBeVisible();
    await expect(page.getByText('This is a draft')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'In short' })).toBeVisible();
    if (!isMobile) {
      const contents = page.getByRole('navigation', { name: 'On this page' });
      for (const link of await contents.getByRole('link').all()) {
        const id = (await link.getAttribute('href'))!.slice(1);
        await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
      }
    }
    expect((await page.goto('/legal/not-a-document'))?.status()).toBe(404);
  });

  test('contact details are never invented: unset ones say they’re published before launch', async ({
    page,
    request,
  }) => {
    await page.goto('/contact');
    const mailto = await page.locator('a[href^="mailto:"]').count();
    const pending = await page.getByText('published here before launch').count();
    expect(mailto + pending).toBeGreaterThanOrEqual(4);
    // security.txt exists only with a real address.
    const txt = await request.get('/.well-known/security.txt');
    if (txt.status() === 200) expect(await txt.text()).toMatch(/^Contact: mailto:.+@.+/m);
    else expect(txt.status()).toBe(404);
  });

  test('help answers open with the keyboard', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard');
    await page.goto('/help');
    const question = page.getByRole('button', { name: 'Do I pay through BUKU?' });
    await question.focus();
    await page.keyboard.press('Enter');
    await expect(question).toHaveAttribute('aria-expanded', 'true');
    await expect(
      page.getByText('Appointments are paid at the business, as you normally would.'),
    ).toBeVisible();
  });

  test('the phone menu opens, takes you to a page, and closes', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'phone layout');
    await page.goto('/');
    await page.getByRole('button', { name: 'Open menu' }).click();
    const menu = page.getByRole('dialog', { name: 'Menu' });
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await page.getByRole('button', { name: 'Open menu' }).click();
    await menu.getByRole('link', { name: 'Help' }).click();
    await expect(page).toHaveURL('/help');
    await expect(menu).toBeHidden();
  });
});
