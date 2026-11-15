import { randomUUID } from 'node:crypto';
import { openBusiness, signIn } from './business-world';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * Settings (3.5l): the business's details, how bookings work and how the queue works. Each part
 * catches a wrong value on its field, saves only what changed, and keeps it after a reload.
 * Against the development stack.
 */

const made: string[] = [];

test.describe('Settings', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });
  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('the details, bookings and the queue: checked, saved, still there after a reload', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await signIn(page, `settings.owner.${randomUUID()}@example.com`, 'Hina Qureshi', true);
    const place = await openBusiness(page, made, 'Settings Test');

    await page.goto(`/business/${place.id}`);
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === `/business/${place.id}/settings`);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expectAccessible(page);

    // The details: a needed field left empty is caught; then a new description is saved.
    const details = page.getByRole('region', { name: 'The business' });
    const city = details.getByLabel('City');
    const was = await city.inputValue();
    await city.fill('');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(city).toHaveAttribute('aria-invalid', 'true');
    await expect(city).toBeFocused();
    await city.fill(was);
    await details.getByLabel('About').fill('Classic cuts and hot-towel shaves, since 1998.');
    await details.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved.', { exact: true })).toBeVisible();

    // Bookings: out of range is caught on the field; 24 hours is saved.
    const bookings = page.getByRole('region', { name: 'Bookings' });
    const window = bookings.getByLabel('Free cancellation until');
    await window.fill('500');
    await bookings.getByRole('button', { name: 'Save booking settings' }).click();
    await expect(bookings.getByText('Enter a whole number from 0 to 168.')).toBeVisible();
    await window.fill('24');
    await bookings.getByLabel('Start times every').selectOption('30');
    await bookings.getByRole('button', { name: 'Save booking settings' }).click();
    await expect(page.getByText('Booking settings saved.')).toBeVisible();

    // The queue: ticket letters are letters; VIP is saved.
    const queue = page.getByRole('region', { name: 'Queue' });
    const letters = queue.getByLabel('Ticket letters');
    await letters.fill('A1');
    await queue.getByRole('button', { name: 'Save queue settings' }).click();
    await expect(queue.getByText('1 to 3 letters, like A or VIP.')).toBeVisible();
    await letters.fill('vip');
    await queue.getByRole('button', { name: 'Save queue settings' }).click();
    await expect(page.getByText('Queue settings saved.')).toBeVisible();
    await expectAccessible(page);

    // Everything is still there after a reload.
    await page.reload();
    await expect(page.getByRole('region', { name: 'The business' }).getByLabel('About')).toHaveValue(
      'Classic cuts and hot-towel shaves, since 1998.',
    );
    await expect(
      page.getByRole('region', { name: 'Bookings' }).getByLabel('Free cancellation until'),
    ).toHaveValue('24');
    await expect(page.getByRole('region', { name: 'Bookings' }).getByLabel('Start times every')).toHaveValue(
      '30',
    );
    await expect(page.getByRole('region', { name: 'Queue' }).getByLabel('Ticket letters')).toHaveValue('VIP');

    // Nothing changed: nothing is sent.
    await page
      .getByRole('region', { name: 'Queue' })
      .getByRole('button', { name: 'Save queue settings' })
      .click();
    await expect(page.getByText('Nothing has changed.')).toBeVisible();
  });
});
