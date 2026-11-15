import { randomUUID } from 'node:crypto';
import { canSimulateTime, closeBusiness } from './db';
import { customerBooks, openBusiness, signIn, TZ } from './business-world';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * The calendar (3.5h): a week of the business's appointments by its own clock, everyone's or one
 * person's; each visit opens where the desk acts on it. Against the development stack.
 */

const made: string[] = [];

const localDate = (iso: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));

test.describe('The calendar', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    test.skip(!canSimulateTime(), 'the development database is not reachable');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('a week of visits by the business’s clock; each opens on the appointments page', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(90_000);
    await signIn(page, `calendar.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Calendar Test');
    const booked = await customerBooks(browser, baseURL!, place);
    await booked.close();

    await page.goto(`/business/${place.id}/calendar?date=${localDate(booked.startAt)}`);
    await expect(page.getByRole('heading', { name: 'Calendar', level: 1 })).toBeVisible();
    const visit = page.getByRole('link', { name: /Haircut/ }).filter({ visible: true });
    await expect(visit).toHaveCount(1);
    await expect(visit).toContainText('Mahnoor Ali');
    await expectAccessible(page);

    // One person's week: Ali's, still there.
    await page.getByLabel('Whose').selectOption({ label: 'Ali' });
    await expect(page).toHaveURL(/staffId=/);
    await expect(page.getByRole('link', { name: /Haircut/ }).filter({ visible: true })).toHaveCount(1);

    // The next week has nothing; back again.
    await page.getByRole('button', { name: 'Next week' }).click();
    await expect(page.getByText('Nothing booked this week')).toBeVisible();
    await page.getByRole('button', { name: 'Previous week' }).click();
    await page
      .getByRole('link', { name: /Haircut/ })
      .filter({ visible: true })
      .click();
    await expect(page).toHaveURL(
      (url) =>
        url.pathname === `/business/${place.id}/appointments` && url.searchParams.get('q') === booked.code,
    );
    await expect(page.getByText(booked.code).first()).toBeVisible();
  });
});
