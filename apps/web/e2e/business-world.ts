import { randomUUID } from 'node:crypto';
import type { Browser, Page } from '@playwright/test';
import { bookThroughSite, freeTimes, type Bookable } from './booking-helpers';
import { expect, visitorAddress } from './fixtures';

/**
 * A business of the test's own, set up through the site's API as an owner would, and customers
 * who book it (the calendar, reviews and other business-area tests start from here).
 */

export const TZ = 'Asia/Karachi';

export async function signIn(page: Page, email: string, name: string, owner: boolean) {
  await page.goto('/signin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel(/^Name/).fill(name);
  if (owner) await page.getByRole('radio', { name: /Business owner/ }).click();
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('link', { name: 'Skip for now' }).click();
}

/** A business open all day, every day, with one 30-minute service and one person who does it. */
export async function openBusiness(page: Page, made: string[], label = 'Test Business'): Promise<Bookable> {
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
  const name = `${label} ${randomUUID().slice(0, 6)}`;
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

export async function customerBooks(
  browser: Browser,
  baseURL: string,
  place: Bookable,
  name = 'Mahnoor Ali',
): Promise<{ id: string; code: string; startAt: string; page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { 'x-real-ip': visitorAddress() } });
  const page = await context.newPage();
  await signIn(page, `customer.${randomUUID()}@example.com`, name, false);
  const startAt = (await freeTimes(place)).filter((t) => Date.parse(t) - Date.now() > 24 * 3_600_000)[0]!;
  const booked = await bookThroughSite(page.request, baseURL, place, startAt);
  return { ...booked, startAt, page, close: () => context.close() };
}
