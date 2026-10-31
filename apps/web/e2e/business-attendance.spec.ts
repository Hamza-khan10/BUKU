import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { closeBusiness } from './db';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * Attendance (3.5g), against the development stack: the owner of a new business clocks someone
 * in, corrects the shift (an earlier start, a clock-out), clocks them in and out again, and looks
 * at the day before. The business is removed afterwards.
 */

const made: string[] = [];

/** "YYYY-MM-DDTHH:mm" on the clock in Karachi (the business's time zone), minutes ago. */
function karachiWall(minutesAgo: number): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Karachi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(Date.now() - minutesAgo * 60_000))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

async function ownerWithBusiness(page: Page): Promise<{ id: string; name: string }> {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(`attendance.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill('Hina Qureshi');
  await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
  const headers = { 'x-buku-csrf': '1', origin: new URL(page.url()).origin };
  const categories = (await (await page.request.get('/api/v1/categories', { headers })).json()) as {
    data: { children: { id: string; name: string }[] }[];
  };
  const category = categories.data.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const name = `Attendance Test ${randomUUID().slice(0, 6)}`;
  const res = await page.request.post('/api/v1/businesses', {
    headers,
    data: {
      name,
      categoryId: category.id,
      address: '12 Main Boulevard',
      city: 'Lahore',
      country: 'PK',
      lat: 31.5204,
      lng: 74.3587,
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      acceptedBusinessTermsVersion: '1.0',
    },
  });
  expect(res.ok(), `create business: ${res.status()} ${await res.text()}`).toBe(true);
  const business = ((await res.json()) as { data: { id: string } }).data;
  made.push(business.id);
  const staff = await page.request.post(`/api/v1/businesses/${business.id}/staff`, {
    headers,
    data: { displayName: 'Ali Raza' },
  });
  expect(staff.ok(), `add staff: ${staff.status()} ${await staff.text()}`).toBe(true);
  return { id: business.id, name };
}

test.describe('Attendance', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
  });

  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('clock in, correct the shift, clock in and out again, look at the day before', async ({ page }) => {
    // Corrections are made on today's date: not in the first half hour after midnight in Karachi.
    test.skip(karachiWall(30).slice(0, 10) !== karachiWall(0).slice(0, 10), 'too close to midnight');
    const business = await ownerWithBusiness(page);
    await page.goto(`/business/${business.id}/attendance`);
    await expect(page.getByRole('heading', { name: 'Attendance', exact: true })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: business.name }).getByRole('link', { name: 'Attendance' }),
    ).toHaveAttribute('aria-current', 'page');

    const team = page.getByRole('list', { name: 'The team' });
    const ali = team.getByRole('listitem', { name: 'Ali Raza' });
    await expect(ali).toContainText('Out');
    const shifts = page.getByRole('region', { name: 'Shifts' });
    await expect(shifts.getByText('No shifts this day')).toBeVisible();

    await ali.getByRole('button', { name: /^Clock in/ }).click();
    await expect(ali).toContainText('In');
    await expect(ali).toContainText('since');
    const list = shifts.getByRole('list', { name: /^Shifts, Today/ });
    await expect(list.getByRole('listitem')).toHaveCount(1);
    await expect(list.getByRole('listitem').first()).toContainText('still in');
    await expectAccessible(page);

    // Forgot to clock in on time, and has left: corrected by the owner.
    await list.getByRole('button', { name: /^Correct/ }).click();
    const fix = page.getByRole('dialog', { name: 'Correct Ali Raza’s shift' });
    const start = karachiWall(25);
    const end = karachiWall(5);
    await fix.getByLabel('Clocked in').fill(start);
    await fix.getByLabel(/^Clocked out/).fill(end);
    await fix.getByRole('button', { name: 'Save the correction' }).click();
    await expect(fix).toBeHidden();
    await expect(list.getByRole('listitem').first()).toContainText(`${start.slice(11)} – ${end.slice(11)}`);
    await expect(list.getByRole('listitem').first()).toContainText('20 min');
    await expect(ali).toContainText('Out');

    // A clock-out can't come before the clock-in.
    await list.getByRole('button', { name: /^Correct/ }).click();
    await fix.getByLabel(/^Clocked out/).fill(karachiWall(40));
    await fix.getByRole('button', { name: 'Save the correction' }).click();
    await expect(fix.getByText('Clocking out must be after clocking in.')).toBeVisible();
    await fix.getByRole('button', { name: 'Keep it' }).click();

    // Back for the afternoon, then gone.
    await ali.getByRole('button', { name: /^Clock in/ }).click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await ali.getByRole('button', { name: /^Clock out/ }).click();
    await expect(ali).toContainText('Out');
    await expect(list.getByRole('listitem').nth(1)).not.toContainText('still in');

    // The day before has nothing; there's no going past today.
    await expect(shifts.getByRole('button', { name: 'The day after' })).toBeDisabled();
    await shifts.getByRole('button', { name: 'The day before' }).click();
    await expect(shifts.getByText('No shifts this day')).toBeVisible();
    await expect(shifts.getByRole('button', { name: 'The day after' })).toBeEnabled();
  });
});
