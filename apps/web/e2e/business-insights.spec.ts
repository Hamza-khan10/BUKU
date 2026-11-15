import { randomUUID } from 'node:crypto';
import { bookThroughSite, freeTimes } from './booking-helpers';
import { customerBooks, openBusiness, signIn } from './business-world';
import { canSimulateTime, closeBusiness, moveVisit, visitHappened } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * Insights (3.5j): cancellations and no-shows for the owner, counted by the day each visit was
 * for. A customer's visit happened and another was cancelled (both days ago, by simulated time);
 * the figures, the reason, the week, the service and the period all say so. Against the development stack.
 */

const made: string[] = [];
const DAY = 24 * 60;

test.describe('Insights', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    test.skip(!canSimulateTime(), 'the development database is not reachable');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('a visit that happened and one cancelled: the figures, why, which week and service', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    await signIn(page, `insights.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Insights Test');

    // One customer books twice and cancels the second (unwell); then both days pass.
    const kept = await customerBooks(browser, baseURL!, place);
    const later = (await freeTimes(place)).find(
      (t) => Date.parse(t) - Date.parse(kept.startAt) > 2 * 3_600_000,
    )!;
    const cancelled = await bookThroughSite(kept.page.request, baseURL!, place, later);
    const res = await kept.page.request.post(`/api/v1/appointments/${cancelled.id}/cancel`, {
      headers: { 'x-buku-csrf': '1', origin: baseURL! },
      data: { reasonCode: 'illness' },
    });
    expect(res.status()).toBe(200);
    await kept.close();
    expect(visitHappened(place.id, kept.id, 5)).toBe(true);
    expect(moveVisit(place.id, cancelled.id, -3 * DAY, -3 * DAY + 30)).toBe(true);

    await page.goto(`/business/${place.id}`);
    await page.getByRole('link', { name: 'Insights' }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/business/${place.id}/insights`);
    await expect(page.getByRole('heading', { name: 'Insights', level: 1 })).toBeVisible();

    const tile = (label: string) =>
      page.locator('dl > div').filter({ has: page.getByText(label, { exact: true }) });
    await expect(tile('Bookings')).toContainText('2');
    await expect(tile('Bookings')).toContainText('1 came');
    await expect(tile('Cancelled by customers')).toContainText('50%');
    await expect(tile('Didn’t come')).toContainText('0%');

    await expect(page.getByRole('list', { name: 'Why customers cancelled' })).toContainText('Unwell: 1');
    const weeks = page.getByRole('group', { name: 'Week by week' });
    await expect(weeks.getByRole('button', { name: /1 came/ })).toHaveCount(1);
    await expect(weeks.getByRole('button', { name: /1 cancelled/ })).toHaveCount(1);
    await expect(page.getByRole('row', { name: /Haircut/ })).toContainText('50%');
    await expectAccessible(page);

    // A week's numbers on focus, as on hover; the arrow keys walk the weeks.
    await weeks.getByRole('button', { name: /1 came/ }).focus();
    await expect(page.getByText(/^Week of \d{1,2} \w{3} \d{4}$/)).toBeVisible();
    await page.keyboard.press('Home');
    await expect(weeks.getByRole('button').first()).toBeFocused();

    // Twelve months still hold both; the address remembers the choice.
    await page.getByRole('button', { name: '12 months' }).click();
    await expect(page).toHaveURL(/days=365/);
    await expect(page.getByRole('button', { name: '12 months' })).toHaveAttribute('aria-pressed', 'true');
    await expect(tile('Bookings')).toContainText('2');
  });
});
