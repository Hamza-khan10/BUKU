import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { bookable, bookThroughSite, freeTimes } from './booking-helpers';
import { appointmentStatus, canSimulateTime, deletionRequested, signedInAgo } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/** Your data: a copy to take away, and deleting the account — against the development stack. */

const ours = { 'x-buku-csrf': '1' };

async function signInFresh(page: Page, name: string): Promise<{ id: string; email: string }> {
  const email = `data.${randomUUID()}@example.com`;
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  const me = (await (await page.request.get('/api/v1/auth/me', { headers: ours })).json()) as {
    data: { id: string };
  };
  return { id: me.data.id, email };
}

test.describe('Your data', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test('download a copy: a file with everything about the account', async ({ page }) => {
    const me = await signInFresh(page, 'Rabia Export');
    await page.goto('/account/settings');
    const section = page.getByRole('region', { name: 'Your data' });
    const download = page.waitForEvent('download');
    await section.getByRole('button', { name: 'Download your data' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^buku-data-export-\d{4}-\d{2}-\d{2}\.json$/);
    const data = JSON.parse(await readFile(await file.path(), 'utf8')) as {
      format: string;
      account: { id: string; email: string };
    };
    expect(data).toMatchObject({ format: 'buku-data-export/1', account: { id: me.id, email: me.email } });
  });

  test('delete the account: said plainly first, the word typed, then visits cancelled and goodbye', async ({
    page,
    baseURL,
  }) => {
    test.skip(!canSimulateTime(), 'the development database isn’t reachable');
    await signInFresh(page, 'Usman Leaving');
    const place = await bookable();
    const times = (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 48 * 3_600_000);
    const visit = await bookThroughSite(page.request, baseURL!, place, times[7]!);

    await page.goto('/account/settings');
    await page
      .getByRole('region', { name: 'Your data' })
      .getByRole('link', { name: 'Delete your account…' })
      .click();
    await expect(page).toHaveURL((url) => url.pathname === '/account/settings/delete');
    await expect(page.getByRole('region', { name: 'What happens' })).toContainText('For 30 days');
    await expectAccessible(page);

    await page.getByRole('button', { name: 'Delete my account' }).click();
    await expect(page.getByText('Type DELETE to confirm.')).toBeVisible();
    await page.getByLabel(/^Why are you leaving/).fill('Moving abroad');
    await page.getByLabel(/^Type DELETE to confirm/).fill('delete');
    await page.getByRole('button', { name: 'Delete my account' }).click();

    // Asked once more, with exactly what would be cancelled.
    const dialog = page.getByRole('dialog', { name: 'These will be cancelled' });
    await expect(dialog.getByRole('list', { name: 'Cancelled if you delete' })).toContainText(
      `${place.service.name} at ${place.name}`,
    );
    await expectAccessible(page);
    await dialog.getByRole('button', { name: 'Keep my account' }).click();
    await expect(dialog).toBeHidden();
    expect(appointmentStatus(visit.id)).toBe('confirmed');

    await page.getByRole('button', { name: 'Delete my account' }).click();
    await page
      .getByRole('dialog', { name: 'These will be cancelled' })
      .getByRole('button', { name: 'Cancel them and delete' })
      .click();

    await expect(page).toHaveURL((url) => url.pathname === '/goodbye');
    const until = new URL(page.url()).searchParams.get('until')!;
    expect(Math.round((Date.parse(until) - Date.now()) / 86_400_000)).toBeGreaterThanOrEqual(29);
    await expect(page.getByRole('heading', { name: 'Your account is deleted' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
    await expectAccessible(page);
    // Signed out at the API too, and the business no longer expects them.
    expect((await page.request.get('/api/v1/auth/me', { headers: ours })).status()).toBe(401);
    await expect.poll(() => appointmentStatus(visit.id), { timeout: 30_000 }).toBe('cancelled');
  });

  test('a sign-in from long ago is asked to sign in again first', async ({ page }) => {
    test.skip(!canSimulateTime(), 'the development database isn’t reachable');
    const me = await signInFresh(page, 'Ahmed Earlier');
    expect(signedInAgo(me.id, 20)).toBe(true);
    await page.goto('/account/settings/delete');
    await page.getByLabel(/^Type DELETE to confirm/).fill('DELETE');
    await page.getByRole('button', { name: 'Delete my account' }).click();
    const alert = page.getByRole('status').filter({ hasText: 'For your safety, sign in again first' });
    await expect(alert).toContainText('the last 10 minutes');
    await alert.getByRole('button', { name: 'Sign in again' }).click();
    await expect(page).toHaveURL(
      (url) => url.pathname === '/signin' && url.searchParams.get('next') === '/account/settings/delete',
    );
    // Nothing was deleted.
    expect(deletionRequested(me.id)).toBe(false);
  });
});
