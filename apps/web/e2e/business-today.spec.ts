import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { canSimulateTime, closeBusiness, moveVisit } from './db';
import { expect, test, visitorAddress } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * The front desk's day (3.5b), against the development stack: a business takes three bookings
 * from a customer; two are moved to "now" in the database (simulated time, as the acceptance
 * tests do); then the owner checks one in by its code, marks it done, records the other as not
 * having come, finds the third by its code and cancels it with a reason. The business is
 * removed afterwards. It's set in a time zone where it's daytime when the test runs, so "today"
 * holds whatever the hour here.
 */

const made: string[] = [];

/** A time zone where it's between 09:00 and 19:00 now, so visits an hour either side stay "today". */
function daytimeZone(): string {
  const zones = [
    'Asia/Karachi',
    'Europe/London',
    'America/New_York',
    'America/Los_Angeles',
    'Asia/Tokyo',
    'Pacific/Auckland',
    'Asia/Dubai',
    'America/Sao_Paulo',
  ];
  return (
    zones.find((tz) => {
      const hour = Number(
        new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date()),
      );
      return hour >= 9 && hour < 19;
    }) ?? 'Asia/Karachi'
  );
}

async function signIn(page: Page, email: string, name: string, owner: boolean) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  if (owner) await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** A business open all day, every day, with one 30-minute service and one person who does it. */
async function openBusiness(page: Page): Promise<Bookable & { timezone: string }> {
  const headers = { 'x-buku-csrf': '1', origin: new URL(page.url()).origin };
  const call = async (method: 'post' | 'put', path: string, data: unknown) => {
    const res = await page.request[method](`/api/v1/${path}`, { headers, data });
    expect(res.ok(), `${method} ${path}: ${res.status()} ${await res.text()}`).toBe(true);
    return ((await res.json()) as { data: { id: string; slug?: string } }).data;
  };
  const categories = (await (await page.request.get('/api/v1/categories', { headers })).json()) as {
    data: { children: { id: string; name: string }[] }[];
  };
  const category = categories.data.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const timezone = daytimeZone();
  const name = `Front Desk Test ${randomUUID().slice(0, 6)}`;
  const business = await call('post', 'businesses', {
    name,
    categoryId: category.id,
    address: '12 Main Boulevard',
    city: 'Lahore',
    country: 'PK',
    lat: 31.5204,
    lng: 74.3587,
    timezone,
    currency: 'PKR',
    acceptedBusinessTermsVersion: '1.0',
  });
  made.push(business.id);
  const allWeek = [0, 1, 2, 3, 4, 5, 6];
  await call('put', `businesses/${business.id}/hours`, {
    hours: allWeek.map((d) => ({ dayOfWeek: d, openTime: '00:00', closeTime: '23:59' })),
  });
  const service = await call('post', `businesses/${business.id}/services`, {
    name: 'Haircut',
    durationMinutes: 30,
    price: 800,
    bufferMinutes: 0,
  });
  const person = await call('post', `businesses/${business.id}/staff`, {
    displayName: 'Ali',
    serviceIds: [service.id],
  });
  await call('put', `businesses/${business.id}/staff/${person.id}/hours`, {
    days: allWeek.map((d) => ({ dayOfWeek: d, ranges: [{ start: '00:00', end: '23:59' }] })),
  });
  return {
    id: business.id,
    slug: business.slug!,
    name,
    timezone,
    service: { id: service.id, name: 'Haircut', staffIds: [person.id] },
  };
}

/** A customer, in their own browser, books three times: two today, one on a later day. */
async function customerBooks(browser: Browser, baseURL: string, place: Bookable) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-real-ip': visitorAddress() } });
  const page = await context.newPage();
  await signIn(page, `desk.${randomUUID()}@example.com`, 'Zara Khan', false);
  const times = await freeTimes(place);
  const bookings = [];
  for (const startAt of [times[0]!, times[4]!, times.at(-1)!]) {
    bookings.push(await bookThroughSite(page.request, baseURL, place, startAt));
  }
  await context.close();
  return bookings;
}

test.describe('The front desk’s day', () => {
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    test.skip(!canSimulateTime(), 'the development database is not reachable');
  });

  test.afterAll(() => {
    for (const id of made) closeBusiness(id);
  });

  test('check in by code, mark done, record a no-show, find and cancel a booking', async ({
    page,
    browser,
    baseURL,
  }) => {
    // Two sign-ins, a business set up, three bookings: more than the usual half minute.
    test.setTimeout(120_000);
    await signIn(page, `desk.owner.${randomUUID()}@example.com`, 'Sana Malik', true);
    const place = await openBusiness(page);
    const [arriving, missed, later] = await customerBooks(browser, baseURL!, place);
    // Simulated time: one visit started 5 minutes ago, one 50 minutes ago (and ended); the time each
    // holds its person for moves with it.
    expect(moveVisit(place.id, arriving!.id, -5, 25)).toBe(true);
    expect(moveVisit(place.id, missed!.id, -50, -20)).toBe(true);

    await page.goto(`/business/${place.id}`);
    const today = page.getByRole('region', { name: 'Today' });
    await expect(
      today
        .getByRole('list', { name: 'Today’s visits' })
        .getByRole('listitem')
        .filter({ hasText: 'Zara Khan' }),
    ).toHaveCount(2);
    await expect(today.getByText('Now', { exact: false }).first()).toBeVisible();
    await expectAccessible(page);

    // The code as someone might read it out: lower case, no dash.
    await today.getByLabel('Booking code').fill(arriving!.code.toLowerCase().replace('-', ''));
    await today.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(today.getByRole('status').filter({ hasText: 'Zara Khan is checked in' })).toBeVisible();
    const row = today.getByRole('listitem').filter({ hasText: arriving!.code });
    await expect(row.getByText('Here', { exact: true })).toBeVisible();

    await row.getByRole('button', { name: /^Mark done/ }).click();
    await expect(row.getByText('Done', { exact: true })).toBeVisible();

    const gone = today.getByRole('listitem').filter({ hasText: missed!.code });
    await gone.getByRole('button', { name: /^Details/ }).click();
    const details = page.getByRole('dialog', { name: 'Zara Khan' });
    await details.getByRole('button', { name: 'Didn’t come' }).click();
    await expect(details).toBeHidden();
    await expect(gone.getByText('Didn’t come', { exact: true })).toBeVisible();

    // A code that isn't a code, and one from nowhere.
    await today.getByLabel('Booking code').fill('<b>hi</b>');
    await today.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(today.getByRole('alert').filter({ hasText: 'That isn’t a booking code' })).toBeVisible();
    await today.getByLabel('Booking code').fill('BK-ZZZZZZ');
    await today.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(today.getByRole('alert').filter({ hasText: 'No booking BK-ZZZZZZ here' })).toBeVisible();

    // The third booking, found by its code, cancelled with a reason the customer will see.
    await page
      .getByRole('navigation', { name: place.name })
      .getByRole('link', { name: 'Appointments' })
      .click();
    await page.getByLabel('Find a booking by code or customer name').fill(later!.code);
    await page.getByRole('button', { name: 'Find', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`q=${later!.code}`));
    const found = page.getByRole('listitem').filter({ hasText: later!.code });
    await expect(found).toHaveCount(1);
    await expectAccessible(page);
    await found.getByRole('button', { name: /^Details/ }).click();
    const sheet = page.getByRole('dialog', { name: 'Zara Khan' });
    await sheet.getByRole('button', { name: 'Cancel booking' }).click();
    await sheet.getByRole('button', { name: 'Cancel the booking' }).click();
    await expect(sheet.getByText('Say why, in a few words: the customer is told.')).toBeVisible();
    await sheet.getByLabel(/Why are you cancelling/).fill('Ali is unwell today, sorry.');
    await sheet.getByRole('button', { name: 'Cancel the booking' }).click();
    await expect(sheet).toBeHidden();
    await expect(found.getByText('Cancelled', { exact: true })).toBeVisible();

    // Opened straight from the address (the whole page loads before the business does).
    await page.goto(`/business/${place.id}/appointments`);
    await expect(page.getByRole('heading', { name: /^Today, / })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: arriving!.code })).toBeVisible();

    // Check-in: the camera is allowed on this page only, and only for this site.
    await page.getByRole('navigation', { name: place.name }).getByRole('link', { name: 'Check-in' }).click();
    await expect(page.getByRole('heading', { name: 'Check someone in', level: 1 })).toBeVisible();
    await expectAccessible(page);
    const policy = async (path: string) => (await page.request.get(path)).headers()['permissions-policy'];
    expect(await policy(`/business/${place.id}/check-in`)).toContain('camera=(self)');
    expect(await policy(`/business/${place.id}`)).toContain('camera=()');
  });
});
