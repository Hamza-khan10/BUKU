import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { bookable, bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** The inbox and notification settings — against the development stack (booking → notification-service). */

async function signInFresh(page: Page, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`inbox.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

const ours = { 'x-buku-csrf': '1' };

test.describe('Notifications', () => {
  let place: Bookable;
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    place = await bookable();
  });

  test('a booking’s confirmation arrives; opening it marks it read and goes to the booking', async ({
    page,
    baseURL,
  }) => {
    await signInFresh(page, 'Nadia Inbox');
    const times = (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 48 * 3_600_000);
    const booked = await bookThroughSite(page.request, baseURL!, place, times[5]!);

    // The notification service picks the booking up from the event stream.
    await expect
      .poll(
        async () =>
          (
            (await (
              await page.request.get('/api/v1/notifications/unread-count', { headers: ours })
            ).json()) as {
              data: { unread: number };
            }
          ).data.unread,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await page.goto('/account/notifications');
    await expect(
      page.getByRole('button', { name: /^Account: Nadia Inbox, \d+ unread notification/ }),
    ).toBeVisible();
    const message = page.getByRole('link', { name: /Booking confirmed/ });
    await expect(message).toContainText(booked.code);
    await expect(message).toContainText('(unread)');
    await expectAccessible(page);

    await message.click();
    await expect(page).toHaveURL((url) => url.pathname === `/appointments/${booked.id}`);
    await page.goto('/account/notifications');
    await expect(page.getByText('All read.')).toBeVisible();
    await expect(page.getByRole('link', { name: /Booking confirmed/ })).not.toContainText('(unread)');

    await page.getByRole('button', { name: 'Remove “Booking confirmed” from your inbox' }).click();
    await expect(page.getByText('Nothing here yet')).toBeVisible();
  });

  test('settings save as you switch them; turning suggestions off stops emailed ones too', async ({
    page,
  }) => {
    await signInFresh(page, 'Omar Settings');
    await page.goto('/account/notifications/settings');
    await expect(page.getByRole('region', { name: 'Email' })).toContainText('Sent to');
    await expectAccessible(page);

    await page.getByRole('switch', { name: 'Reminders' }).click();
    await expect(page.getByText('Reminder emails: off.')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('switch', { name: 'Reminders' })).not.toBeChecked();

    const suggestions = page.getByRole('switch', { name: 'Suggest times that suit me' });
    const byEmail = page.getByRole('switch', { name: 'Also by email' });
    await expect(suggestions).not.toBeChecked();
    await expect(byEmail).toBeDisabled();
    await suggestions.click();
    await expect(byEmail).toBeEnabled();
    await byEmail.click();
    await expect(page.getByText('Suggestions by email: on.')).toBeVisible();

    await suggestions.click();
    await expect(page.getByText('Suggestions: off.')).toBeVisible();
    await expect(byEmail).not.toBeChecked();
    const prefs = (await (
      await page.request.get('/api/v1/users/me/notification-prefs', { headers: ours })
    ).json()) as {
      data: { suggestions: boolean; marketingEmails: boolean; emailReminders: boolean };
    };
    expect(prefs.data).toMatchObject({ suggestions: false, marketingEmails: false, emailReminders: false });
  });
});
