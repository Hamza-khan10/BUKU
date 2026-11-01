import { execFileSync } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { API } from './helpers';

/**
 * What the admin's tests need to exist first, made the way people make it: a customer books and
 * reviews through the API, and a step of booking's development tool does what can't be waited for
 * (the visit happening, the business reporting the review). Null when the stack or the
 * development database isn't there; the test then skips.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));

function devWorld(command: string, ...args: string[]): unknown {
  try {
    const out = execFileSync(
      `${ROOT}node_modules/.bin/tsx`,
      [`${ROOT}services/booking/scripts/dev-world.ts`, command, ...args],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, LOG_LEVEL: 'warn' } },
    );
    return JSON.parse(out.trim().split('\n').at(-1)!) as unknown;
  } catch {
    return null;
  }
}

export const canSimulate = () => devWorld('ping') === true;

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`${res.url}: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { data: T }).data;
};

/** A seeded business that confirms bookings at once, with a service someone takes bookings for. */
async function bookable() {
  const search = await json<{ id: string; slug: string; name: string }[]>(
    await fetch(`${API}/v1/businesses/search?limit=20`),
  );
  for (const b of search) {
    const menu = await json<{
      categories: { services: { id: string; staffIds: string[] }[] }[];
      booking: { confirmationMode: string };
    }>(await fetch(`${API}/v1/businesses/${b.slug}/services`));
    if (menu.booking.confirmationMode !== 'automatic') continue;
    const service = menu.categories.flatMap((c) => c.services).find((s) => s.staffIds.length > 0);
    if (service) return { ...b, serviceId: service.id };
  }
  throw new Error('no bookable business in the development data');
}

/**
 * A customer's one-star review, reported by the business as fake. Returns the business and the
 * review's words (unique, so the test can find it).
 */
export async function reportedReview(): Promise<{
  business: { id: string; slug: string; name: string };
  comment: string;
} | null> {
  if (!canSimulate()) return null;
  const login = await json<{ accessToken: string }>(
    await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: `reviewer.${randomUUID()}@example.com`, name: 'Bilal Reviewer' }),
    }),
  );
  const auth = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };
  const place = await bookable();
  const today = new Date().toISOString().slice(0, 10);
  const days = await json<{ days: { slots: { startAt: string }[] }[] }>(
    await fetch(
      `${API}/v1/businesses/${place.slug}/availability?${new URLSearchParams({ serviceId: place.serviceId, date: today, days: '14' })}`,
    ),
  );
  // Two days out or more, picked at random so parallel runs don't reach for the same slot.
  const times = days.days
    .flatMap((d) => d.slots.map((s) => s.startAt))
    .filter((t) => Date.parse(t) - Date.now() > 48 * 3_600_000);
  if (times.length === 0) throw new Error('no free time to book');
  const booked = await json<{ id: string }>(
    await fetch(`${API}/v1/appointments`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        businessId: place.id,
        serviceId: place.serviceId,
        startAt: times[randomInt(times.length)],
      }),
    }),
  );
  if (devWorld('visit-happened', place.id, booked.id) !== true)
    throw new Error('the visit couldn’t be moved into the past');
  const comment = `Never went there, never will (${randomUUID().slice(0, 8)})`;
  const review = await json<{ id: string }>(
    await fetch(`${API}/v1/appointments/${booked.id}/review`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ overall: 1, comment }),
    }),
  );
  if (devWorld('review-reported', place.id, review.id, 'fake: No booking at that time') !== true)
    throw new Error('the review couldn’t be reported');
  return { business: { id: place.id, slug: place.slug, name: place.name }, comment };
}

/**
 * A new business whose owner asked for a plan (Enterprise, for a clinic group): made through the
 * API as an owner would. Returns the business and the request's words.
 */
export async function businessAskingForPlan(): Promise<{ id: string; name: string; message: string }> {
  const login = await json<{ accessToken: string }>(
    await fetch(`${API}/v1/auth/dev/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `owner.${randomUUID()}@example.com`,
        name: 'Saima Owner',
        role: 'business_owner',
      }),
    }),
  );
  const auth = { authorization: `Bearer ${login.accessToken}`, 'content-type': 'application/json' };
  const categories = await json<{ children: { id: string; name: string }[] }[]>(
    await fetch(`${API}/v1/categories`),
  );
  const category = categories.flatMap((c) => c.children).find((c) => c.name === 'Barbershop')!;
  const name = `Plan Request Clinic ${randomUUID().slice(0, 6)}`;
  const business = await json<{ id: string }>(
    await fetch(`${API}/v1/businesses`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
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
      }),
    }),
  );
  const message = `Clinic group, 14 branches (${randomUUID().slice(0, 6)})`;
  await json(
    await fetch(`${API}/v1/businesses/${business.id}/billing/plan-requests`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ planCode: 'business_enterprise', message }),
    }),
  );
  return { id: business.id, name, message };
}
