import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** Finding places: home, search with suggestions, filters, near me, categories (against the dev stack). */

test.describe('Discovery', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('the home page shows real places in a city people can switch', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Book the time. Skip the wait.');
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

  test('nothing found: says so and offers a fresh start; an old link to a later page starts at the top', async ({
    page,
  }) => {
    await page.goto('/explore?q=zzqqxxyy');
    await expect(page.getByRole('heading', { name: 'No places match all of that' })).toBeVisible();
    await page.getByRole('button', { name: 'Start a fresh search' }).click();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByRole('heading', { name: /^\d+ places?/ })).toBeVisible();
    await page.goto('/explore?page=40');
    await expect(page.getByRole('list', { name: 'Places' }).getByRole('listitem').first()).toBeVisible();
  });

  test('explore changes in place, shows its shape while loading, keeps going as you scroll, and Back works', async ({
    page,
  }) => {
    // It scrolls through every place there is: more than the usual half minute on a phone.
    test.slow();
    await page.goto('/explore');
    const places = page.getByRole('list', { name: 'Places' });
    await expect(places.getByRole('listitem').first()).toBeVisible();
    const total = Number(
      (await page.getByRole('heading', { name: /^\d+ places?/ }).textContent())!.match(/\d+/)![0],
    );
    // A marker on the page: a reload would wipe it.
    await page.evaluate(() => ((window as unknown as { kept: boolean }).kept = true));
    const kept = () => page.evaluate(() => (window as unknown as { kept?: boolean }).kept === true);

    // While the next results are on their way, the page shows their shape.
    await page.route('**/api/v1/businesses/search**', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await page.getByRole('link', { name: /^Open now/ }).click();
    await expect(page.getByRole('status', { name: 'Loading places' })).toBeVisible();
    await expect(page).toHaveURL(/openNow=1/);
    await expect(page.getByRole('link', { name: /^Open now.*\(on/ })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading places' })).toBeHidden();
    await page.unroute('**/api/v1/businesses/search**');
    expect(await kept()).toBe(true);

    await page.goBack();
    await expect(page).toHaveURL(/\/explore$/);
    await expect(page.getByRole('heading', { name: new RegExp(`^${total} places?`) })).toBeVisible();

    // A kind of place, one tap.
    await page
      .getByRole('navigation', { name: 'Kinds of place' })
      .getByRole('button', { name: /Beauty & Hair/ })
      .click();
    await expect(page).toHaveURL(/category=beauty-hair/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Beauty & Hair');
    await page
      .getByRole('navigation', { name: 'Kinds of place' })
      .getByRole('button', { name: 'Everything' })
      .click();
    await expect(page).toHaveURL(/\/explore$/);
    expect(await kept()).toBe(true);

    // More places as you scroll, until the end says so.
    if (total > 12) {
      // (Only what is on show: an earlier view's end stays in the page, hidden.)
      const atEnd = page.getByText(/^That’s all \d+ places/).filter({ visible: true });
      // The category's own end goes once every place is back on show (more than one page of them).
      await expect(atEnd).toHaveCount(0);
      for (let i = 0; i < 12 && (await atEnd.count()) === 0; i++) {
        // Straight to the bottom (a wheel would start the page's smooth scrolling, which keeps
        // going after the test has moved on).
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
        await page.waitForTimeout(400);
        const more = page.getByRole('button', { name: 'Show more places' });
        // Places keep loading by themselves at first, so the button may move or be gone a moment later.
        if ((await more.count()) > 0) await more.click({ timeout: 3000 }).catch(() => undefined);
      }
      // The end counts exactly what is listed. (Tests running alongside may add a place while this
      // one scrolls, so the count is the end's own, not the one read at the start.)
      const end = page.getByText(/^That’s all \d+ places for this search\.$/).filter({ visible: true });
      await expect(end).toBeVisible();
      const listed = Number((await end.textContent())!.match(/\d+/)![0]);
      await expect(places.locator(':scope > li.reveal')).toHaveCount(listed);
      // While the end of the list is on screen it steps aside (the list's own buttons are there);
      // higher up, one tap takes you back to the search.
      await end.scrollIntoViewIfNeeded();
      await expect(page.getByRole('button', { name: 'Back to the search' })).toBeHidden();
      await page.evaluate(() => window.scrollTo(0, 2000));
      await page.getByRole('button', { name: 'Back to the search' }).click();
      await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    }
    await expectAccessible(page);
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

  test('categories: find a kind by typing part of its name, or jump straight to a group', async ({
    page,
  }) => {
    await page.goto('/categories');
    // The group cards are evenly spaced, the last one too (stacked or not). Entrance animations are
    // switched off for the measurement, so it sees where each card really sits.
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; }' });
    // On a wide screen the cards stack once the page has measured them; measure after that.
    if (test.info().project.name === 'desktop')
      await expect(page.locator('[data-stacked]').first()).toBeAttached();
    const gaps = await page.evaluate(() => {
      window.scrollTo(0, 0);
      const cards = [...document.querySelectorAll('section[aria-labelledby^="group-"]')].map((c) =>
        c.getBoundingClientRect(),
      );
      return cards.slice(1).map((c, i) => Math.round(c.top - cards[i]!.bottom));
    });
    expect(gaps.length).toBeGreaterThan(5);
    // Whole pixels round fractional sizes, so neighbours may differ by a pixel or two.
    expect(Math.max(...gaps) - Math.min(...gaps), gaps.join(', ')).toBeLessThanOrEqual(2);
    const find = page.getByLabel('Find a kind of place');
    await find.fill('lash and brow');
    await expect(page.getByText('1 kind matches.')).toBeVisible();
    await find.fill('zzqx');
    await expect(page.getByText('No kind of place called “zzqx” yet.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search every place for “zzqx”' })).toHaveAttribute(
      'href',
      '/explore?q=zzqx',
    );
    await find.fill('padel');
    await page
      .getByRole('link', { name: /^Padel Court/ })
      .first()
      .click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Padel Court');

    await page.goBack();
    await page
      .getByRole('navigation', { name: 'Groups' })
      .getByRole('button', { name: /Finance & Banking/ })
      .click();
    const heading = page.getByRole('heading', { name: 'Finance & Banking', level: 2 });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expectAccessible(page);
  });
});
