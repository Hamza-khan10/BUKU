import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { bookable, bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** My visits: the account page, the list, add to calendar, cancel and move (against the dev stack). */

const HOUR = 3_600_000;

async function signInFresh(page: Page, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`visits.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** A free time far enough ahead that it can still be moved (outside any notice period). */
async function laterTime(place: Bookable, skip = 0): Promise<string> {
  const times = (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 48 * HOUR);
  return times[skip]!;
}

test.describe('My visits', () => {
  let place: Bookable;
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    place = await bookable();
  });

  test('a booking shows on the account and in the list; it goes in the calendar; cancelling asks why', async ({
    page,
    baseURL,
  }) => {
    await signInFresh(page, 'Sana Visitor');
    const booked = await bookThroughSite(page.request, baseURL!, place, await laterTime(place, 1));

    await page.goto('/account');
    await expect(page.getByRole('heading', { name: 'Hi, Sana' })).toBeVisible();
    const next = page.getByRole('region', { name: 'Your next visit' });
    await expect(next.getByText(booked.code)).toBeVisible();
    await expect(page.getByRole('region', { name: 'How reliably you keep bookings' })).toContainText(
      'New customer',
    );
    await expectAccessible(page);

    await page.goto('/account/appointments');
    await page
      .getByRole('link', { name: new RegExp(place.service.name) })
      .first()
      .click();
    await expect(page).toHaveURL((url) => url.pathname === `/appointments/${booked.id}`);

    // Add to calendar: an .ics file, made in the browser.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Add to calendar' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(new RegExp(`^buku-${place.slug}-\\d{4}-\\d{2}-\\d{2}\\.ics$`));
    const ics = await readFile(await file.path(), 'utf8');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain(`SUMMARY:${place.service.name} at`);
    expect(ics.replace(/\r\n /g, '')).toContain(booked.code);

    // Cancel: a reason is needed; keeping the visit is as easy as cancelling it.
    await page.getByRole('button', { name: 'Cancel visit' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this visit?' });
    await expect(dialog.getByRole('button', { name: 'Keep my visit' })).toBeVisible();
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(dialog.getByText('Choose the reason that fits best.')).toBeVisible();
    await dialog.getByRole('radio', { name: 'Something else came up' }).click();
    await dialog.getByRole('checkbox', { name: /Remind me in 3 days/ }).click();
    await dialog.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(page.getByText('Visit cancelled. We’ll remind you in 3 days to book again.')).toBeVisible();
    await expect(page.getByText('Cancelled by you')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Book this again' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add to calendar' })).toHaveCount(0);

    await page.goto('/account/appointments?scope=past');
    await expect(
      page.getByRole('link', { name: new RegExp(`${place.service.name}.*Cancelled`) }),
    ).toBeVisible();
  });

  test('moving a visit gives it a new code; the old booking says it moved', async ({ page, baseURL }) => {
    await signInFresh(page, 'Bilal Mover');
    const booked = await bookThroughSite(page.request, baseURL!, place, await laterTime(place, 2));

    await page.goto(`/appointments/${booked.id}`);
    await page.getByRole('link', { name: 'Move to another time' }).click();
    await expect(page.getByRole('heading', { name: 'Move your visit' })).toBeVisible();
    await page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').last().click();
    await page.getByRole('button', { name: 'Move to this time' }).click();

    await expect(page.getByRole('heading', { name: 'Moved to the new time' })).toBeVisible();
    await expect(page.getByText('It has a new booking code: the old one no longer works.')).toBeVisible();
    await expect(page).toHaveURL(
      (url) => url.searchParams.get('moved') === '1' && !url.pathname.endsWith(booked.id),
    );
    await expect(page.getByText(booked.code)).toHaveCount(0);

    await page.goto(`/appointments/${booked.id}`);
    await expect(page.getByText('Moved to a new time')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move to another time' })).toHaveCount(0);
  });

  test('a visit inside the notice period says cancelling is late, and can’t be moved', async ({
    page,
    baseURL,
  }) => {
    const soon = (await freeTimes(place)).find((t) => Date.parse(t) - Date.now() < 11 * HOUR);
    test.skip(!soon, 'no free time inside the next 11 hours right now');
    await signInFresh(page, 'Hina Late');
    const booked = await bookThroughSite(page.request, baseURL!, place, soon!);

    await page.goto(`/appointments/${booked.id}`);
    await expect(page.getByText(/cancelling now counts as late/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move to another time' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel visit' }).click();
    await expect(page.getByRole('dialog').getByText('This counts as a late cancellation')).toBeVisible();
  });
});
