import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { apiAvailable, expectAccessible } from './helpers';
import { visitor } from './team';

/** Booking a visit, start to finish, against the development stack's seed data. */

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';
const onPage = (path: string | RegExp) => (url: URL) =>
  typeof path === 'string' ? url.pathname === path : path.test(url.pathname);

interface Bookable {
  slug: string;
  name: string;
  service: { id: string; name: string; staffIds: string[] };
}

/** A seeded business with a service someone takes bookings for. */
async function bookable(): Promise<Bookable> {
  const search = (await (await fetch(`${API}/v1/businesses/search?limit=20`)).json()) as {
    data: { slug: string; name: string }[];
  };
  for (const b of search.data) {
    const menu = (await (await fetch(`${API}/v1/businesses/${b.slug}/services`)).json()) as {
      data: { categories: { services: Bookable['service'][] }[] };
    };
    const service = menu.data.categories.flatMap((c) => c.services).find((s) => s.staffIds.length > 0);
    if (service) return { slug: b.slug, name: b.name, service };
  }
  throw new Error('no bookable business in the development data');
}

async function devSignIn(page: Page, name: string) {
  await page.getByLabel('Email').fill(`booker.${randomUUID()}@example.com`);
  await page.getByLabel(/^Name/).fill(name);
  await page.getByRole('main').getByRole('button', { name: 'Sign in', exact: true }).click();
}

test.describe('Booking', () => {
  let place: Bookable;
  test.beforeAll(async () => {
    test.skip(!(await apiAvailable()), 'the API stack is not running');
    place = await bookable();
  });

  test('find a time without an account, sign in, come back to it, book, get the receipt', async ({
    page,
  }) => {
    await page.goto(`/b/${place.slug}`);
    await page
      .getByRole('region', { name: 'Book a visit' })
      .getByRole('link', { name: 'Book a visit' })
      .click();
    await expect(page).toHaveURL(onPage(`/b/${place.slug}/book`));
    await expect(page.getByRole('heading', { name: `Book at ${place.name}`, level: 1 })).toBeVisible();

    await page
      .getByRole('radio', { name: new RegExp(place.service.name) })
      .first()
      .click();
    await expect(page.getByRole('radio', { name: 'Anyone available' })).toBeChecked();
    // The first day with free times is open; its times are grouped by part of the day.
    const firstTime = page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first();
    await firstTime.click();
    await expect(page).toHaveURL((url) => url.searchParams.has('service') && url.searchParams.has('time'));
    await expectAccessible(page);

    // Signed out: the last step signs in, then comes back to exactly this choice.
    await page.getByRole('link', { name: 'Sign in to book' }).click();
    await devSignIn(page, 'Zara Booker');
    await expect(page).toHaveURL(onPage('/welcome'));
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await expect(page).toHaveURL(onPage(`/b/${place.slug}/book`));
    await expect(
      page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio', { checked: true }),
    ).toHaveCount(1);

    await page.getByLabel('Note for the business').fill('First visit, please be patient with me.');
    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(page).toHaveURL(onPage(/^\/appointments\/[0-9a-f-]{36}$/));
    await expect(page.getByRole('heading', { name: 'You’re booked' })).toBeVisible();
    await expect(page.getByText(/^BK-[A-Z0-9]{6}$/)).toBeVisible();
    await expect(page.getByRole('img', { name: /^QR code for BK-[A-Z0-9]{6}$/ })).toBeVisible();
    await expect(page.getByText('paid at the venue')).toBeVisible();
    await expect(page.getByText('First visit, please be patient with me.')).toBeVisible();
    await expectAccessible(page);
  });

  test('a time taken in the meantime is said so, and the other choices are kept', async ({
    page,
    baseURL,
  }) => {
    // Someone signed in picks a person and a time…
    await page.goto('/signin');
    await devSignIn(page, 'Omar Slow');
    await page.getByRole('link', { name: 'Skip for now' }).click();
    const staffId = place.service.staffIds[0]!;
    await page.goto(`/b/${place.slug}/book?service=${place.service.id}&staff=${staffId}`);
    const time = page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio').first();
    await time.click();
    const chosen = new URL(page.url()).searchParams.get('time')!;

    // …and someone else books exactly that before they press Book.
    const other = await visitor(baseURL!);
    await other.post('/api/v1/auth/dev/login', { data: { email: `quick.${randomUUID()}@example.com` } });
    const menu = (await (await fetch(`${API}/v1/businesses/${place.slug}`)).json()) as {
      data: { id: string };
    };
    const taken = await other.post('/api/v1/appointments', {
      data: { businessId: menu.data.id, serviceId: place.service.id, staffId, startAt: chosen },
    });
    expect(taken.status()).toBe(201);
    await other.dispose();

    await page.getByRole('button', { name: 'Book', exact: true }).click();
    await expect(page.getByText('That time was just taken.')).toBeVisible();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('service') === place.service.id &&
        url.searchParams.get('staff') === staffId &&
        !url.searchParams.has('time'),
    );
    await expect(
      page.getByRole('radiogroup', { name: 'Time' }).getByRole('radio', { checked: true }),
    ).toHaveCount(0);
  });

  test('a receipt is shown only to the person who booked', async ({ page, baseURL }) => {
    const owner = await visitor(baseURL!);
    await owner.post('/api/v1/auth/dev/login', { data: { email: `owner.${randomUUID()}@example.com` } });
    const business = (await (await fetch(`${API}/v1/businesses/${place.slug}`)).json()) as {
      data: { id: string };
    };
    const today = new Date().toISOString().slice(0, 10);
    const times = (await (
      await fetch(
        `${API}/v1/businesses/${place.slug}/availability?serviceId=${place.service.id}&date=${today}&days=14`,
      )
    ).json()) as { data: { days: { slots: { startAt: string }[] }[] } };
    const startAt = times.data.days.flatMap((d) => d.slots).at(-1)!.startAt;
    const made = (await (
      await owner.post('/api/v1/appointments', {
        data: { businessId: business.data.id, serviceId: place.service.id, startAt },
      })
    ).json()) as { data: { id: string } };
    await owner.dispose();

    await page.goto('/signin');
    await devSignIn(page, 'Nosy Neighbour');
    await page.getByRole('link', { name: 'Skip for now' }).click();
    await page.goto(`/appointments/${made.data.id}`);
    await expect(page.getByRole('heading', { name: 'We couldn’t find this booking' })).toBeVisible();
  });

  test('each bookable service on the business page leads straight to booking it', async ({ page }) => {
    await page.goto(`/b/${place.slug}`);
    const link = page.getByRole('link', { name: `Book ${place.service.name}` }).first();
    await expect(link).toHaveAttribute('href', `/b/${place.slug}/book?service=${place.service.id}`);
    await link.click();
    // Already chosen: the service step is folded to its summary, with a way to change it.
    const step = page.getByRole('region', { name: 'Service' });
    await expect(step).toContainText(place.service.name);
    await expect(step.getByRole('button', { name: 'Change service' })).toBeVisible();
  });
});
