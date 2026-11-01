import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { canSimulateTime, closeBusiness } from './db';
import { expect, test, visitorAddress } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';

/**
 * The calendar (3.5h): a week of the business's appointments by its own clock, everyone's or one
 * person's; each visit opens where the desk acts on it. Against the development stack.
 */

const TZ = 'Asia/Karachi';
const made: string[] = [];

async function signIn(page: Page, email: string, name: string, owner: boolean) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  if (owner) await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** A business open all day, every day, with one 30-minute service and one person who does it. */
async function openBusiness(page: Page): Promise<Bookable> {
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
  const name = `Calendar Test ${randomUUID().slice(0, 6)}`;
  const business = await call('post', 'businesses', {
    name,
    categoryId: category.id,
    address: '12 Main Boulevard',
    city: 'Lahore',
    country: 'PK',
    lat: 31.5204,
    lng: 74.3587,
    timezone: TZ,
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
    service: { id: service.id, name: 'Haircut', staffIds: [person.id] },
  };
}

async function customerBooks(browser: Browser, baseURL: string, place: Bookable) {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-real-ip': visitorAddress() } });
  const page = await context.newPage();
  await signIn(page, `calendar.${randomUUID()}@example.com`, 'Mahnoor Ali', false);
  const startAt = (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 24 * 3_600_000)[0]!;
  const booked = await bookThroughSite(page.request, baseURL, place, startAt);
  await context.close();
  return { ...booked, startAt };
}

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
    const place = await openBusiness(page);
    const booked = await customerBooks(browser, baseURL!, place);

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
