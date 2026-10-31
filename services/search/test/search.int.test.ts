import { createEvent, TOPICS } from '@buku/kafka';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { refreshSearchStats } from '../src/catalog/catalog-stats.js';
import { searchEventHandler } from '../src/events/handlers.js';
import { HOME, NOW, useSearchHarness, word } from './harness.js';

/**
 * Search against the real catalog (DB-041), kept from the business shard as its events would keep
 * it (D3h). Every business here is in a city made up for this run; times are fixed: Wednesday
 * 10:00 UTC (see harness.ts).
 */

const h = useSearchHarness();
const WORD = word();

const find = (q: Record<string, string | number | boolean>) =>
  request(h.app)
    .get('/v1/businesses/search')
    .query({ city: h.city, ...q });
const names = (res: { body: { data: { name: string }[] } }) => res.body.data.map((b) => b.name);

describe('Who appears', () => {
  it('live businesses with something to offer; unverified ones labelled; never suspended, rejected, deleted or empty', async () => {
    await h.place({ name: `${WORD} Verified Cuts`, verified: true });
    const fresh = await h.place({ name: `${WORD} New Cuts` });
    await h.place({ name: `${WORD} Suspended Cuts`, status: 'suspended' });
    await h.place({ name: `${WORD} Rejected Cuts`, status: 'rejected' });
    await h.place({ name: `${WORD} Deleted Cuts`, deleted: true });
    await h.place({ name: `${WORD} Empty Shop`, services: [{ name: 'Old', price: 100, active: false }] });
    await h.place({ name: `${WORD} Queue Only`, services: [], queue: 'set_up' });

    const res = await find({ q: WORD, limit: 50 }).expect(200);
    expect(names(res).sort()).toEqual([`${WORD} New Cuts`, `${WORD} Queue Only`, `${WORD} Verified Cuts`]);
    const shown = res.body.data.find((b: { name: string }) => b.name.endsWith('New Cuts'));
    // Named by its public ID (DB-042); the price in the currency's decimals.
    expect(shown).toMatchObject({
      id: fresh.publicId,
      verified: false,
      isPromoted: false,
      priceFrom: { amount: '3000.00', currency: 'EUR' },
    });
    // Nothing private: no owner, contact details, settings or status internals.
    expect(Object.keys(shown).sort()).toEqual(
      [
        'address',
        'category',
        'city',
        'coverPhotoUrl',
        'distanceKm',
        'id',
        'isPromoted',
        'location',
        'logoUrl',
        'name',
        'openNow',
        'priceFrom',
        'queue',
        'rating',
        'reliability',
        'slug',
        'verified',
      ].sort(),
    );
  });
});

describe('Text', () => {
  it('finds by service, category, partial words and typos — and treats input as text only', async () => {
    const tag = word();
    await h.place({ name: `${tag} Studio`, services: [{ name: 'Beard Trim', price: 200_000 }] });
    await h.place({
      name: `Smile ${tag}`,
      category: 'clinic',
      services: [{ name: 'Teeth Whitening', price: 900_000 }],
    });

    expect(names(await find({ q: `${tag} beard` }))).toEqual([`${tag} Studio`]);
    expect(names(await find({ q: `${tag} whiten` }))).toEqual([`Smile ${tag}`]); // prefix of a service word
    expect(names(await find({ q: `${tag} clinic` }))).toEqual([`Smile ${tag}`]); // category name
    expect(names(await find({ q: `${tag.slice(0, 4)}${tag.slice(5)}` }))).toEqual([
      `${tag} Studio`,
      `Smile ${tag}`,
    ]); // a letter missing
    for (const nasty of ["'; DROP TABLE businesses; --", '%', '_', '\\', ':* | !', '(((']) {
      await find({ q: nasty }).expect(200);
    }
    expect((await find({ q: '%' })).body.data).toEqual([]);
  });
});

describe('Kept current by events', () => {
  it('a service added, renamed or switched off changes what finds the business once its event is handled', async () => {
    const handler = searchEventHandler({ sync: h.sync });
    const ctx = { topic: TOPICS.LISTINGS_CHANGED, partition: 0, offset: '0', key: null, attempt: 1 };
    const tag = word();
    const svc = word();
    const b = await h.place({ name: `${tag} Place`, services: [{ name: 'Basic', price: 10_000 }] });
    // What booking-service announces after every change to a menu.
    const menuChanged = () =>
      handler(
        createEvent({
          type: TOPICS.LISTINGS_CHANGED,
          source: 'booking-service',
          subject: b.id.toString(),
          data: { businessId: b.id.toString(), part: 'menu' },
        }),
        ctx,
      );
    expect(names(await find({ q: svc }))).toEqual([]);
    const serviceId = h.world.id();
    await h.world.inBusiness(b.id, (tx) =>
      tx.service.create({
        data: {
          id: serviceId,
          businessId: b.id,
          name: `${svc} Massage`,
          durationMinutes: 30,
          priceMinor: 50_000n,
          currency: 'EUR',
        },
      }),
    );
    await menuChanged();
    expect(names(await find({ q: svc }))).toEqual([`${tag} Place`]);
    const renamed = word();
    await h.world.inBusiness(b.id, (tx) =>
      tx.service.update({ where: { id: serviceId }, data: { name: `${renamed} Massage` } }),
    );
    await menuChanged();
    expect(names(await find({ q: svc }))).toEqual([]);
    expect(names(await find({ q: renamed }))).toEqual([`${tag} Place`]);
    await h.world.inBusiness(b.id, (tx) =>
      tx.service.update({ where: { id: serviceId }, data: { isActive: false } }),
    );
    await menuChanged();
    expect(names(await find({ q: renamed }))).toEqual([]);
  });
});

describe('Location', () => {
  it('within the radius, nearest first, with the distance', async () => {
    const tag = word();
    await h.place({ name: `${tag} Far`, km: 30 });
    await h.place({ name: `${tag} Near`, km: 1 });
    await h.place({ name: `${tag} Middle`, km: 4 });
    const res = await request(h.app)
      .get('/v1/businesses/nearby')
      .query({ lat: HOME.lat, lng: HOME.lng, radiusKm: 10, q: tag })
      .expect(200);
    expect(names(res)).toEqual([`${tag} Near`, `${tag} Middle`]);
    expect(res.body.data[0].distanceKm).toBe(1);
    expect(res.body.meta.sort).toBe('distance');
  });

  it('needs both coordinates; distance sorting needs a point; strict parameters and limits', async () => {
    await find({ lat: 1 }).expect(400);
    await find({ sort: 'distance' }).expect(400);
    await find({ limit: 51 }).expect(400);
    await find({ radius_km: 5 }).expect(400); // unknown parameter
    await request(h.app).get('/v1/businesses/nearby').expect(400);
  });
});

describe('Filters', () => {
  it('open now — including hours past midnight and business-wide closures', async () => {
    const tag = word();
    const wed = 3;
    await h.place({ name: `${tag} Day`, hours: [{ day: wed, open: '09:00', close: '17:00' }] });
    await h.place({ name: `${tag} Evening`, hours: [{ day: wed, open: '18:00', close: '23:00' }] });
    await h.place({
      name: `${tag} Late`,
      hours: [
        { day: 2, open: '22:00', close: '23:59' },
        { day: wed, open: '00:00', close: '11:00' }, // Tuesday night into Wednesday morning
      ],
    });
    const closed = await h.place({
      name: `${tag} Holiday`,
      hours: [{ day: wed, open: '09:00', close: '17:00' }],
    });
    await h.world.inBusiness(closed.id, (tx) =>
      tx.availabilityException.create({
        data: {
          id: h.world.id(),
          businessId: closed.id,
          exceptionDate: new Date('2026-10-07T00:00:00Z'),
          type: 'holiday',
        },
      }),
    );
    await h.sync.refresh(closed.id);
    const r = await h.search.search({ q: tag, city: h.city, openNow: true, page: 1, limit: 20 }, NOW);
    expect(r.items.map((b) => b.name).sort()).toEqual([`${tag} Day`, `${tag} Late`]);
    const all = await h.search.search({ q: tag, city: h.city, page: 1, limit: 20 }, NOW);
    expect(all.items.find((b) => b.name.endsWith('Evening'))!.openNow).toBe(false);

    const thursday = await h.search.search(
      { q: tag, city: h.city, availableDate: '2026-10-08', page: 1, limit: 20 },
      NOW,
    );
    expect(thursday.items).toEqual([]); // nobody has Thursday hours
  });

  it('an open queue (with how many are waiting), rating, verified, and a category includes its sub-categories', async () => {
    const tag = word();
    await h.place({ name: `${tag} Queue`, queue: 'open', waiting: 3, rating: [4.6, 40], verified: true });
    await h.place({ name: `${tag} Closed Queue`, queue: 'set_up', rating: [3.1, 12] });
    await h.place({ name: `${tag} Clinic`, category: 'clinic', rating: [4.9, 10] });

    const queued = await h.search.search({ q: tag, city: h.city, hasQueue: true, page: 1, limit: 20 }, NOW);
    expect(queued.items.map((b) => [b.name, b.queue])).toEqual([
      [`${tag} Queue`, { open: true, waiting: 3 }],
    ]);
    expect(names(await find({ q: tag, minRating: 4.5 })).sort()).toEqual([`${tag} Clinic`, `${tag} Queue`]);
    expect(names(await find({ q: tag, verifiedOnly: true }))).toEqual([`${tag} Queue`]);
    expect(names(await find({ q: tag, category: h.cats.root.slug })).sort()).toEqual([
      `${tag} Closed Queue`,
      `${tag} Queue`,
    ]);
    await find({ category: 'no-such-category' }).expect(404);
  });
});

describe('Ranking', () => {
  it('a 5.0 from 2 reviews does not beat a 4.8 from 200', async () => {
    const tag = word();
    await h.place({ name: `${tag} Lucky`, rating: [5, 2] });
    await h.place({ name: `${tag} Proven`, rating: [4.8, 200] });
    expect(names(await find({ q: tag, sort: 'rating' }))).toEqual([`${tag} Proven`, `${tag} Lucky`]);
  });

  it('reliability: a business that cancels on customers ranks lower and shows it; declines don’t count', async () => {
    const tag = word();
    const keeps = await h.place({ name: `${tag} Keeps` });
    const cancels = await h.place({ name: `${tag} Cancels` });
    let n = 0;
    const visits = async (
      p: typeof keeps,
      count: number,
      status: 'completed' | 'cancelled',
      cancel?: 'business' | 'declined',
    ) => {
      for (let i = 0; i < count; i++) await h.appointment(p, { status, daysAgo: ++n + 1, cancel });
    };
    await visits(keeps, 10, 'completed');
    await visits(keeps, 5, 'cancelled', 'declined');
    await visits(cancels, 6, 'completed');
    await visits(cancels, 6, 'cancelled', 'business');

    await refreshSearchStats(h.plane);
    const res = await find({ q: tag }).expect(200);
    expect(names(res)).toEqual([`${tag} Keeps`, `${tag} Cancels`]);
    expect(res.body.data.map((b: { reliability: unknown }) => b.reliability)).toEqual([
      { keptPercent: 100, basedOn: 10 },
      { keptPercent: 50, basedOn: 12 },
    ]);
  });
});

describe('Trending, featured, autocomplete', () => {
  it('trending: busiest this week (at least 3); featured: verified with a photo, two per category at most', async () => {
    const tag = word();
    const busy = await h.place({ name: `${tag} Busy` });
    await h.place({ name: `${tag} Quiet` });
    for (let i = 1; i <= 4; i++) await h.appointment(busy, { status: 'confirmed', daysAgo: -i });
    await refreshSearchStats(h.plane);
    const trending = (await h.search.trending({ city: h.city, limit: 24 }, NOW)).map((b) => b.name);
    expect(trending).toContain(`${tag} Busy`);
    expect(trending).not.toContain(`${tag} Quiet`);
    await request(h.app).get('/v1/businesses/trending').expect(400); // needs a city or a point

    for (const i of [1, 2, 3])
      await h.place({ name: `${tag} Pick ${i}`, verified: true, photo: true, rating: [4 + i / 10, 50] });
    await h.place({ name: `${tag} No Photo`, verified: true, rating: [5, 500] });
    await h.place({
      name: `${tag} Clinic Pick`,
      category: 'clinic',
      verified: true,
      photo: true,
      rating: [4, 10],
    });
    const featured = await request(h.app).get('/v1/businesses/featured').query({ city: h.city }).expect(200);
    expect(names(featured).filter((x: string) => x.startsWith(tag))).toEqual([
      `${tag} Pick 3`,
      `${tag} Pick 2`,
      `${tag} Clinic Pick`,
    ]);
    expect(featured.body.data[0].coverPhotoUrl).toMatch(/^https:\/\/cdn\.test\/businesses\//);
  });

  it('autocomplete: businesses, categories and services as you type; nothing under 2 characters', async () => {
    const tag = word();
    const lounge = await h.place({
      name: `${tag} Barber Lounge`,
      services: [{ name: `${tag}wax special`, price: 100_000 }],
    });
    const res = await request(h.app).get('/v1/businesses/autocomplete').query({ q: tag }).expect(200);
    expect(res.body.data.businesses).toEqual([
      expect.objectContaining({ id: lounge.publicId, name: `${tag} Barber Lounge` }),
    ]);
    expect(res.body.data.services).toEqual([`${tag}wax special`]);
    const cat = await request(h.app)
      .get('/v1/businesses/autocomplete')
      .query({ q: `Barbershop ${h.run}` });
    expect(cat.body.data.categories).toEqual([
      { slug: h.cats.barber.slug, name: `Barbershop ${h.run}`, icon: null },
    ]);
    const short = await request(h.app).get('/v1/businesses/autocomplete').query({ q: 'b' }).expect(200);
    expect(short.body.data).toEqual({ businesses: [], categories: [], services: [] });
  });
});

describe('Cities', () => {
  it('lists cities with businesses on BUKU and how many — never ones with only hidden or empty businesses', async () => {
    const empty = `Emptyville ${h.run}`;
    await h.place({ name: `${WORD} Cities Shop`, verified: true });
    await h.place({ name: `${WORD} Cities Pending` });
    const hiddenOnly = await h.place({ name: `${WORD} Cities Suspended`, status: 'suspended' });
    await h.world.inBusiness(hiddenOnly.id, (tx) =>
      tx.business.update({ where: { id: hiddenOnly.id }, data: { city: empty } }),
    );
    await h.sync.refresh(hiddenOnly.id);

    const res = await request(h.app).get('/v1/cities');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=300');
    const cities = res.body.data as { city: string; country: string; businesses: number }[];
    const mine = cities.find((c) => c.city === h.city);
    expect(mine?.country).toBe('IS');
    expect(mine?.businesses).toBeGreaterThanOrEqual(2);
    expect(cities.some((c) => c.city === empty)).toBe(false);
  });
});

describe('Categories', () => {
  it('a tree of active ones; a category with its parent; 404 for unknown or switched off', async () => {
    const tree = await request(h.app).get('/v1/categories').expect(200);
    const root = tree.body.data.find((c: { slug: string }) => c.slug === h.cats.root.slug);
    expect(root.children.map((c: { slug: string }) => c.slug)).toEqual([h.cats.barber.slug]);
    // Each carries its id (a decimal string): registering a business names its category by id.
    expect(root.children[0].id).toBe(h.cats.barber.id.toString());
    expect(tree.body.data.some((c: { slug: string }) => c.slug === h.cats.hidden.slug)).toBe(false);

    const one = await request(h.app).get(`/v1/categories/${h.cats.barber.slug}`).expect(200);
    expect(one.body.data.parent).toEqual({ slug: h.cats.root.slug, name: `Grooming ${h.run}` });
    await request(h.app).get(`/v1/categories/${h.cats.hidden.slug}`).expect(404);
    await request(h.app).get('/v1/categories/NOT_A_SLUG').expect(400);

    await h.place({ name: `${WORD} Clinic Listed`, category: 'clinic' });
    const list = await request(h.app)
      .get(`/v1/categories/${h.cats.clinic.slug}/businesses`)
      .query({ city: h.city, limit: 50 })
      .expect(200);
    expect(
      list.body.data.every((b: { category: { slug: string } }) => b.category.slug === h.cats.clinic.slug),
    ).toBe(true);
    expect(list.body.data.length).toBeGreaterThan(0);
  });
});

describe('Search analytics', () => {
  it('record what was searched, never contact details, users or coordinates', async () => {
    h.events.length = 0;
    await find({ q: '0300 1234567' }).expect(200);
    await request(h.app).get('/v1/businesses/nearby').query({ lat: HOME.lat, lng: HOME.lng, openNow: true });
    expect(h.events[0]).toMatchObject({ query: '[redacted]', city: h.city, nearby: false });
    expect(h.events[1]).toMatchObject({ nearby: true, filters: ['openNow'], sort: 'distance' });
    expect(JSON.stringify(h.events)).not.toContain(String(HOME.lat));
  });
});

describe('Kinds owners added, not reviewed yet (D-098)', () => {
  it('stay out of the list and the suggestions, but their businesses are found under the group', async () => {
    const shop = await h.place({ name: `Henna Corner ${h.run}`, category: 'henna' });
    const tree = await request(h.app).get('/v1/categories').expect(200);
    const root = tree.body.data.find((c: { slug: string }) => c.slug === h.cats.root.slug);
    expect(root.children.map((c: { slug: string }) => c.slug)).not.toContain(h.cats.henna.slug);
    const typed = await request(h.app)
      .get('/v1/businesses/autocomplete')
      .query({ q: `Henna ${h.run}` })
      .expect(200);
    expect(typed.body.data.categories).toEqual([]);

    await request(h.app).get(`/v1/categories/${h.cats.henna.slug}`).expect(200);
    const group = await request(h.app)
      .get(`/v1/categories/${h.cats.root.slug}/businesses`)
      .query({ city: h.city, q: 'Henna Corner', limit: 50 })
      .expect(200);
    expect(group.body.data.map((b: { id: string }) => b.id)).toContain(shop.publicId);
  });
});
