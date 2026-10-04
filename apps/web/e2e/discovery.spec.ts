import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** Finding places: home, search with suggestions, filters, near me, categories (against the dev stack). */

test.describe('Discovery', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('the home page shows real places in a city people can switch', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Know exactly when.');
    const cities = page.getByRole('navigation', { name: 'Choose a city' });
    await expect(cities).toBeVisible();
    const second = cities.getByRole('link').nth(1);
    const name = (await second.textContent())!.trim();
    await second.click();
    await expect(page.getByRole('heading', { name: `Places in ${name}` })).toBeVisible();
    await expect(cities.getByRole('link', { name })).toHaveAttribute('aria-current', 'true');
    await expectAccessible(page);
  });

  test('suggestions as you type; arrows and Enter open one', async ({ page, isMobile }) => {
    test.skip(isMobile, 'keyboard');
    await page.goto('/explore');
    const box = page.getByRole('combobox', { name: /Search for/ });
    await box.fill('hai');
    const list = page.getByRole('listbox', { name: 'Suggestions' });
    await expect(list.getByRole('option').first()).toBeVisible();
    await box.press('ArrowDown');
    await expect(box).toHaveAttribute('aria-activedescendant', /opt-0$/);
    await box.press('Escape');
    await expect(list).toBeHidden();
    await box.press('ArrowDown');
    await box.press('Enter');
    await expect(page).not.toHaveURL(/\/explore$/);
  });

  test('searching words lands on results; filters are links that change the address', async ({ page }) => {
    await page.goto('/');
    const box = page.getByRole('combobox', { name: /Search for/ });
    await box.fill('haircut');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/explore\?q=haircut/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Results for “haircut”');
    await page.getByRole('link', { name: /^Verified/ }).click();
    await expect(page).toHaveURL(/verifiedOnly=1/);
    await expect(page.getByRole('link', { name: /^Verified.*\(on/ })).toBeVisible();
  });

  test('nothing found: says so and offers a fresh start; a page past the end says that', async ({ page }) => {
    await page.goto('/explore?q=zzqqxxyy');
    await expect(page.getByRole('heading', { name: 'No places match all of that' })).toBeVisible();
    await page.goto('/explore?page=40');
    await expect(page.getByRole('heading', { name: 'There’s no page 40 for this search' })).toBeVisible();
  });

  test('near me: asks for the location and lists the nearest places', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: 31.5204, longitude: 74.3587 }); // Lahore (seed data)
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Near me' }).click();
    await expect(page.getByRole('heading', { name: /within 10 km/ })).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Places near you' }).getByRole('listitem').first(),
    ).toContainText(/ m|km/);
  });

  test('near me, with location refused: a clear way forward', async ({ page, context }) => {
    await context.clearPermissions();
    await page.goto('/explore');
    await page.getByRole('button', { name: 'Near me' }).click();
    await expect(page.getByText(/Location is turned off for BUKU|couldn’t find where you are/)).toBeVisible();
  });

  test('categories lead to their places; unknown ones are a 404', async ({ page, request }) => {
    await page.goto('/categories');
    await expectAccessible(page);
    await page.getByRole('link', { name: 'Barbershop' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Barbershop');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expectAccessible(page);
    expect((await request.get('/c/no-such-category')).status()).toBe(404);
  });
});
