import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { bookable, bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { canSimulateTime, visitHappened } from './db';
import { expect, test } from './fixtures';
import { possessive } from '../src/lib/format';
import { apiAvailable, expectAccessible } from './helpers';

/** Reviewing a visit: write, see, change, delete — against the development stack. */

async function signInFresh(page: Page, name: string) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`reviews.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

const laterTime = async (place: Bookable, skip: number) =>
  (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 48 * 3_600_000)[skip]!;

test.describe('Reviews', () => {
  let place: Bookable;
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    place = await bookable();
  });

  test('after a visit: asked how it went, review it, change it, delete it', async ({ page, baseURL }) => {
    test.skip(!canSimulateTime(), 'the development database isn’t reachable for simulated time');
    await signInFresh(page, 'Sana Reviewer');
    const booked = await bookThroughSite(page.request, baseURL!, place, await laterTime(place, 3));
    expect(visitHappened(booked.id)).toBe(true);

    // The account page asks, and the receipt offers it as the next thing to do.
    await page.goto('/account');
    await page.getByRole('region', { name: 'How did it go?' }).getByRole('link').first().click();
    await expect(page).toHaveURL((url) => url.pathname === `/appointments/${booked.id}/review`);
    await expect(page.getByRole('heading', { name: `How was your visit to ${place.name}?` })).toBeVisible();
    await expect(page.getByText('“Sana R.”')).toBeVisible();
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Post review' }).click();
    await expect(page.getByText('Choose how many stars for the visit overall.')).toBeVisible();
    await page
      .getByRole('radiogroup', { name: 'Overall' })
      .getByRole('radio', { name: '4 stars, Very good' })
      .click();
    await page
      .getByRole('radiogroup', { name: 'Staff' })
      .getByRole('radio', { name: '5 stars, Excellent' })
      .click();
    await page.getByLabel(/^Your words/).fill('Friendly and on time. Call me on 03001234567 any time.');
    await page.getByRole('button', { name: 'Post review' }).click();

    await expect(page).toHaveURL((url) => url.pathname === '/account/reviews');
    await expect(
      page.getByText(`Thank you. Your review is on ${possessive(place.name)} page.`),
    ).toBeVisible();
    const item = page.getByRole('article').filter({ hasText: place.name });
    // Contact details never reach the page.
    await expect(item).toContainText('[contact removed]');
    await expect(item).not.toContainText('03001234567');

    // Change it (within 7 days).
    await item.getByRole('link', { name: 'Change or delete' }).click();
    await expect(page.getByRole('heading', { name: 'Your review' })).toBeVisible();
    await expect(
      page.getByRole('radiogroup', { name: 'Overall' }).getByRole('radio', { name: '4 stars, Very good' }),
    ).toBeChecked();
    await page
      .getByRole('radiogroup', { name: 'Overall' })
      .getByRole('radio', { name: '5 stars, Excellent' })
      .click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Your review is updated.')).toBeVisible();

    // Delete it (any time).
    await page
      .getByRole('article')
      .filter({ hasText: place.name })
      .getByRole('link', { name: 'Change or delete' })
      .click();
    await page.getByRole('button', { name: 'Delete review' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete your review?' });
    await dialog.getByRole('button', { name: 'Delete review' }).click();
    await expect(page.getByText('Your review is deleted.')).toBeVisible();
    await expect(page.getByText('No reviews yet')).toBeVisible();
  });

  test('a visit that hasn’t happened can’t be reviewed yet', async ({ page, baseURL }) => {
    await signInFresh(page, 'Early Bird');
    const booked = await bookThroughSite(page.request, baseURL!, place, await laterTime(place, 4));
    await page.goto(`/appointments/${booked.id}/review`);
    await expect(page.getByText('This visit can’t be reviewed')).toBeVisible();
    await page.goto(`/appointments/${booked.id}`);
    await expect(page.getByRole('link', { name: 'Review this visit' })).toHaveCount(0);
  });
});
