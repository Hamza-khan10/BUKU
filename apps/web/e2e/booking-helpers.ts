import type { APIRequestContext } from '@playwright/test';

/** Booking data from the development stack's seed (straight from the API, as anyone may read it). */

const API = process.env.E2E_API_URL ?? 'http://localhost:8000';

export interface Bookable {
  id: string;
  slug: string;
  name: string;
  service: { id: string; name: string; staffIds: string[] };
}

/** A seeded business with a service someone takes bookings for. */
export async function bookable(): Promise<Bookable> {
  const search = (await (await fetch(`${API}/v1/businesses/search?limit=20`)).json()) as {
    data: { id: string; slug: string; name: string }[];
  };
  for (const b of search.data) {
    const menu = (await (await fetch(`${API}/v1/businesses/${b.slug}/services`)).json()) as {
      data: { categories: { services: Bookable['service'][] }[] };
    };
    const service = menu.data.categories.flatMap((c) => c.services).find((s) => s.staffIds.length > 0);
    if (service) return { id: b.id, slug: b.slug, name: b.name, service };
  }
  throw new Error('no bookable business in the development data');
}

/** Free start times over the next two weeks, soonest first. */
export async function freeTimes(place: Bookable, staffId?: string): Promise<string[]> {
  const today = new Date().toISOString().slice(0, 10);
  const q = new URLSearchParams({ serviceId: place.service.id, date: today, days: '14' });
  if (staffId) q.set('staffId', staffId);
  const res = (await (await fetch(`${API}/v1/businesses/${place.slug}/availability?${q}`)).json()) as {
    data: { days: { slots: { startAt: string }[] }[] };
  };
  return res.data.days.flatMap((d) => d.slots.map((s) => s.startAt));
}

/** Book through the website, as the signed-in page would (the request carries the page's cookies). */
export async function bookThroughSite(
  request: APIRequestContext,
  baseURL: string,
  place: Bookable,
  startAt: string,
  staffId?: string,
): Promise<{ id: string; code: string }> {
  const res = await request.post('/api/v1/appointments', {
    headers: { 'x-buku-csrf': '1', origin: baseURL },
    data: { businessId: place.id, serviceId: place.service.id, startAt, ...(staffId && { staffId }) },
  });
  if (res.status() !== 201) throw new Error(`booking failed: ${res.status()} ${await res.text()}`);
  return ((await res.json()) as { data: { id: string; code: string } }).data;
}
