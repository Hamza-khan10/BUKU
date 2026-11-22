import { expect, test } from './fixtures';

/**
 * The site's interactions (3.7i, D-143): the board that gives the visitor a number, the owner's
 * page as they type it, the header that floats once the page moves, the theme that spreads from
 * its switch, and the search hint that types itself.
 */

test.describe('Interactions', () => {
  test('the board gives the visitor a number and calls them in, with the way in at their turn', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await page.goto('/');
    const take = page.getByRole('button', { name: 'Take a number' });
    await take.click();
    // A new ticket: the countdown is read out as it moves.
    const line = page.locator('figure p[aria-live="polite"]');
    await expect(line).toContainText('ahead of you');
    await expect(line).toHaveText('It’s your turn.', { timeout: 15_000 });
    // The way in appears beside the button, which stays where it was (focus never drops).
    await expect(page.getByRole('link', { name: /Get early access|Find a place/ }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take another number' })).toBeVisible();
  });

  test('an owner sees their page as they type, and the form arrives filled in', async ({ page }) => {
    await page.goto('/for-business');
    const section = page.getByRole('region', { name: 'See your place on BUKU' });
    await section.getByLabel('Business name').fill('Shifa Family Clinic');
    await section.getByLabel('What you do').selectOption('Clinic');
    await expect(section.getByText('Shifa Family Clinic', { exact: true })).toBeVisible();
    await expect(section.getByText('Consultation')).toBeVisible();
    await expect(section.getByText('onbuku.com/b/shifa-family-clinic')).toBeVisible();

    await page.goto('/early-access?as=business&name=Shifa%20Family%20Clinic&type=Clinic');
    await expect(page.getByLabel(/Business name/)).toHaveValue('Shifa Family Clinic');
    await expect(page.getByLabel(/What kind of business/)).toHaveValue('Clinic');
  });

  test('Enterprise: easy to find, and its way in arrives with Enterprise and 6 to 9 branches chosen', async ({
    page,
  }) => {
    await page.goto('/pricing');
    const band = page.getByRole('complementary', { name: /6 branches or more/ });
    await expect(band).toBeVisible();
    const href = await band.getByRole('link', { name: 'Talk to us' }).getAttribute('href');
    // Before launch it's the business list; after, the contact page.
    if (href?.startsWith('/early-access')) {
      await page.goto(href);
      await expect(page.getByLabel(/Which plan/)).toHaveValue('enterprise');
      await expect(page.getByLabel(/How many branches|branches/i).first()).toHaveValue('6-9');
    } else expect(href).toBe('/contact');
  });

  test('a link carrying anything the form wouldn’t take fills in nothing', async ({ page }) => {
    await page.goto(
      '/early-access?as=business&name=%3Cscript%3Ealert(1)%3C%2Fscript%3E%F0%9F%98%80%E2%80%8B&type=Hacker',
    );
    await expect(page.getByLabel(/Business name/)).toHaveValue('');
    await expect(page.getByLabel(/What kind of business/)).toHaveValue('');
  });

  test('the header floats once the page moves, without moving the logo', async ({ page }) => {
    await page.goto('/');
    const header = page.locator('header.site-glass');
    const logo = page.getByRole('link', { name: 'BUKU home' });
    await expect(header).not.toHaveAttribute('data-condensed', /.*/);
    const before = await logo.boundingBox();
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect(header).toHaveAttribute('data-condensed', '');
    const after = await logo.boundingBox();
    expect(after?.x).toBe(before?.x);
  });

  test('choosing a theme applies it and remembers it', async ({ page, isMobile }) => {
    test.skip(isMobile, 'on a phone the theme is in the menu');
    await page.goto('/');
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the finder’s hint types two real searches, then rests; still for less motion', async ({
    browser,
  }) => {
    for (const reducedMotion of ['no-preference', 'reduce'] as const) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      await page.goto('/categories');
      const box = page.getByLabel('Find a kind of place');
      await box.scrollIntoViewIfNeeded();
      const seen = new Set<string>();
      for (let i = 0; i < 20; i++) {
        seen.add((await box.getAttribute('placeholder')) ?? '');
        await page.waitForTimeout(200);
      }
      if (reducedMotion === 'reduce') expect([...seen]).toEqual(['Try dental, padel or passport']);
      else expect([...seen]).toEqual(expect.arrayContaining(['dental', 'passport']));
      await expect(box).toHaveAttribute('placeholder', 'Try dental, padel or passport');
      await context.close();
    }
  });
});
