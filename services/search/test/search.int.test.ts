import { randomUUID } from 'node:crypto';
import { createLogger, generateConfirmationCode, Readiness } from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import { MediaLinks, type ObjectStorage } from '@buku/media';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildSearchApp } from '../src/app.js';
import type { SearchAnalytics } from '../src/routes.js';
import type { SearchService } from '../src/search-service.js';
import { refreshSearchStats } from '../src/stats.js';

/**
 * Search against the real database. Every business here is in a city made up
 * for this run (and far from the shared test fixtures), so other tests' data
 * never shows up. Times are fixed: Wednesday 10:00 UTC = 15:00 in Karachi.
 */

let db: Database;
let app: Express;
let search: SearchService;
const events: Parameters<SearchAnalytics['searched']>[0][] = [];
const RUN = randomUUID().slice(0, 8);
const CITY = `Testpur ${RUN}`;
/** A made-up word no other business uses (and unlike every other one, so typo matching can't link them). */
const word = () =>
  Array.from({ length: 9 }, () => 'bcdfghjklmnpqrstvwxz'[Math.floor(Math.random() * 20)]).join('');
const WORD = word();
const HOME = { lat: 64.1466, lng: -21.9426 }; // far from every other test's businesses
const NOW = new Date('2026-10-07T10:00:00Z'); // Wednesday
const DAY = 86_400_000;

let owner: string;
let customer: string;
const cats: Record<string, { id: string; slug: string }> = {};

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'search-int-test', maxConnections: 5 });
  const links = new MediaLinks({} as ObjectStorage, {
    mediaBucket: 'media',
    privateBucket: 'private',
    publicBaseUrl: 'https://cdn.test',
  });
  ({ app, search } = buildSearchApp({
    db,
    links,
    analytics: { searched: (e) => events.push(e) },
    http: {
      service: 'search-test',
      logger: createLogger({ service: 'search-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  }));
  const hash = () => randomUUID().replace(/-/g, '').padEnd(64, '0');
  owner = (await db.user.create({ data: { name: 'Owner', role: 'business_owner', emailHash: hash() } })).id;
  customer = (await db.user.create({ data: { name: 'Customer', emailHash: hash() } })).id;
  const root = await db.category.create({
    data: { name: `Grooming ${RUN}`, slug: `grooming-${RUN}`, sortOrder: 0 },
  });
  const barber = await db.category.create({
    data: { name: `Barbershop ${RUN}`, slug: `barbershop-${RUN}`, parentId: root.id, depth: 1 },
  });
  const clinic = await db.category.create({ data: { name: `Clinic ${RUN}`, slug: `clinic-${RUN}` } });
  const hidden = await db.category.create({
    data: { name: `Hidden ${RUN}`, slug: `hidden-${RUN}`, isActive: false },
  });
  Object.assign(cats, { root, barber, clinic, hidden });
});

afterAll(async () => {
  await db.$disconnect();
});

interface PlaceOpts {
  name: string;
  category?: keyof typeof cats;
  km?: number; // north of HOME
  description?: string;
  services?: { name: string; price: number; active?: boolean }[];
  hours?: { day: number; open: string; close: string }[];
  verified?: boolean;
  status?: 'pending' | 'verified' | 'suspended' | 'rejected';
  rating?: [number, number];
  photo?: boolean;
  queue?: 'none' | 'set_up' | 'open';
  waiting?: number;
  deleted?: boolean;
}

/** A business in this run's city, `km` north of HOME (Atlantic/Reykjavik: UTC all year). */
async function place(o: PlaceOpts) {
  const b = await db.business.create({
    data: {
      ownerId: owner,
      categoryId: cats[o.category ?? 'barber']!.id,
      name: o.name,
      slug: `${o.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID().slice(0, 6)}`,
      description: o.description ?? null,
      city: CITY,
      country: 'IS',
      lat: HOME.lat + (o.km ?? 0) / 111.2,
      lng: HOME.lng,
      timezone: 'Atlantic/Reykjavik',
      currency: 'ISK',
      status: o.status ?? (o.verified ? 'verified' : 'pending'),
      verified: o.verified ?? false,
      avgRating: o.rating?.[0] ?? 0,
      reviewCount: o.rating?.[1] ?? 0,
      ...(o.deleted && { deletedAt: new Date() }),
    },
  });
  for (const s of o.services ?? [{ name: 'Haircut', price: 3000 }])
    await db.service.create({
      data: {
        businessId: b.id,
        name: s.name,
        durationMinutes: 30,
        price: s.price,
        currency: 'ISK',
        isActive: s.active ?? true,
      },
    });
  for (const h of o.hours ?? [])
    await db.businessHours.create({
      data: { businessId: b.id, dayOfWeek: h.day, openTime: h.open, closeTime: h.close },
    });
  if (o.photo)
    await db.businessPhoto.create({
      data: {
        businessId: b.id,
        storageKey: `businesses/${b.id}/cover-${randomUUID()}.webp`,
        contentType: 'image/webp',
        sizeBytes: 1000,
        isPrimary: true,
        uploadedAt: new Date(),
      },
    });
  if (o.queue === 'set_up' || o.queue === 'open')
    await db.queueSettings.create({ data: { businessId: b.id } });
  if (o.queue === 'open') {
    const session = await db.queueSession.create({
      data: { businessId: b.id, sessionDate: new Date('2026-10-07T00:00:00Z'), status: 'open' },
    });
    for (let i = 0; i < (o.waiting ?? 0); i++)
      await db.queueEntry.create({ data: { sessionId: session.id, ticketNumber: i + 1, status: 'waiting' } });
  }
  return b;
}

const find = (q: Record<string, string | number | boolean>) =>
  request(app)
    .get('/v1/businesses/search')
    .query({ city: CITY, ...q });
const names = (res: { body: { data: { name: string }[] } }) => res.body.data.map((b) => b.name);

describe('Who appears', () => {
  it('live businesses with something to offer; unverified ones labelled; never suspended, rejected, deleted or empty', async () => {
    await place({ name: `${WORD} Verified Cuts`, verified: true });
    await place({ name: `${WORD} New Cuts` });
    await place({ name: `${WORD} Suspended Cuts`, status: 'suspended' });
    await place({ name: `${WORD} Rejected Cuts`, status: 'rejected' });
    await place({ name: `${WORD} Deleted Cuts`, deleted: true });
    await place({ name: `${WORD} Empty Shop`, services: [{ name: 'Old', price: 1, active: false }] });
    await place({ name: `${WORD} Queue Only`, services: [], queue: 'set_up' });

    const res = await find({ q: WORD, limit: 50 }).expect(200);
    expect(names(res).sort()).toEqual([`${WORD} New Cuts`, `${WORD} Queue Only`, `${WORD} Verified Cuts`]);
    const fresh = res.body.data.find((b: { name: string }) => b.name.endsWith('New Cuts'));
    expect(fresh).toMatchObject({
      verified: false,
      isPromoted: false,
      priceFrom: { amount: 3000, currency: 'ISK' },
    });
    // Nothing private: no owner, contact details, settings or status internals.
    expect(Object.keys(fresh).sort()).toEqual(
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
    await place({ name: `${tag} Studio`, services: [{ name: 'Beard Trim', price: 2000 }] });
    await place({
      name: `Smile ${tag}`,
      category: 'clinic',
      services: [{ name: 'Teeth Whitening', price: 9000 }],
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

describe('Always current', () => {
  it('a service added, renamed or switched off changes what finds the business — at once', async () => {
    const tag = word();
    const svc = word();
    const b = await place({ name: `${tag} Place`, services: [{ name: 'Basic', price: 100 }] });
    expect(names(await find({ q: svc }))).toEqual([]);
    const s = await db.service.create({
      data: { businessId: b.id, name: `${svc} Massage`, durationMinutes: 30, price: 500, currency: 'ISK' },
    });
    expect(names(await find({ q: svc }))).toEqual([`${tag} Place`]);
    const renamed = word();
    await db.service.update({ where: { id: s.id }, data: { name: `${renamed} Massage` } });
    expect(names(await find({ q: svc }))).toEqual([]);
    expect(names(await find({ q: renamed }))).toEqual([`${tag} Place`]);
    await db.service.update({ where: { id: s.id }, data: { isActive: false } });
    expect(names(await find({ q: renamed }))).toEqual([]);
  });
});

describe('Location', () => {
  it('within the radius, nearest first, with the distance', async () => {
    const tag = word();
    await place({ name: `${tag} Far`, km: 30 });
    await place({ name: `${tag} Near`, km: 1 });
    await place({ name: `${tag} Middle`, km: 4 });
    const res = await request(app)
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
    await request(app).get('/v1/businesses/nearby').expect(400);
  });
});

describe('Filters', () => {
  it('open now — including hours past midnight and business-wide closures', async () => {
    const tag = word();
    const wed = 3;
    await place({ name: `${tag} Day`, hours: [{ day: wed, open: '09:00', close: '17:00' }] });
    await place({ name: `${tag} Evening`, hours: [{ day: wed, open: '18:00', close: '23:00' }] });
    await place({
      name: `${tag} Late`,
      hours: [
        { day: 2, open: '22:00', close: '23:59' },
        { day: wed, open: '00:00', close: '11:00' }, // Tuesday night into Wednesday morning
      ],
    });
    const closed = await place({
      name: `${tag} Holiday`,
      hours: [{ day: wed, open: '09:00', close: '17:00' }],
    });
    await db.availabilityException.create({
      data: { businessId: closed.id, exceptionDate: new Date('2026-10-07T00:00:00Z'), type: 'holiday' },
    });
    const r = await search.search({ q: tag, city: CITY, openNow: true, page: 1, limit: 20 }, NOW);
    expect(r.items.map((b) => b.name).sort()).toEqual([`${tag} Day`, `${tag} Late`]);
    const all = await search.search({ q: tag, city: CITY, page: 1, limit: 20 }, NOW);
    expect(all.items.find((b) => b.name.endsWith('Evening'))!.openNow).toBe(false);

    const thursday = await search.search(
      { q: tag, city: CITY, availableDate: '2026-10-08', page: 1, limit: 20 },
      NOW,
    );
    expect(thursday.items).toEqual([]); // nobody has Thursday hours
  });

  it('an open queue (with how many are waiting), rating, verified, and a category includes its sub-categories', async () => {
    const tag = word();
    await place({ name: `${tag} Queue`, queue: 'open', waiting: 3, rating: [4.6, 40], verified: true });
    await place({ name: `${tag} Closed Queue`, queue: 'set_up', rating: [3.1, 12] });
    await place({ name: `${tag} Clinic`, category: 'clinic', rating: [4.9, 10] });

    const queued = await search.search({ q: tag, city: CITY, hasQueue: true, page: 1, limit: 20 }, NOW);
    expect(queued.items.map((b) => [b.name, b.queue])).toEqual([
      [`${tag} Queue`, { open: true, waiting: 3 }],
    ]);
    expect(names(await find({ q: tag, minRating: 4.5 })).sort()).toEqual([`${tag} Clinic`, `${tag} Queue`]);
    expect(names(await find({ q: tag, verifiedOnly: true }))).toEqual([`${tag} Queue`]);
    expect(names(await find({ q: tag, category: cats.root!.slug })).sort()).toEqual([
      `${tag} Closed Queue`,
      `${tag} Queue`,
    ]);
    await find({ category: 'no-such-category' }).expect(404);
  });
});

describe('Ranking', () => {
  it('a 5.0 from 2 reviews does not beat a 4.8 from 200', async () => {
    const tag = word();
    await place({ name: `${tag} Lucky`, rating: [5, 2] });
    await place({ name: `${tag} Proven`, rating: [4.8, 200] });
    expect(names(await find({ q: tag, sort: 'rating' }))).toEqual([`${tag} Proven`, `${tag} Lucky`]);
  });

  it('reliability: a business that cancels on customers ranks lower and shows it; declines don’t count', async () => {
    const tag = word();
    const keeps = await place({ name: `${tag} Keeps` });
    const cancels = await place({ name: `${tag} Cancels` });
    const svc = async (businessId: string) =>
      (await db.service.findFirstOrThrow({ where: { businessId } })).id;
    let n = 0;
    const appt = async (
      businessId: string,
      status: 'completed' | 'cancelled',
      cancel?: 'business' | 'declined',
    ) => {
      const startAt = new Date(NOW.getTime() - (++n + 1) * DAY);
      await db.appointment.create({
        data: {
          businessId,
          serviceId: await svc(businessId),
          userId: customer,
          status,
          startAt,
          endAt: new Date(startAt.getTime() + 1_800_000),
          blockedUntil: new Date(startAt.getTime() + 1_800_000),
          price: 3000,
          currency: 'ISK',
          confirmationCode: generateConfirmationCode(),
          ...(status === 'cancelled' && {
            cancelledAt: startAt,
            cancelledBy: 'business',
            cancelReasonCode: cancel === 'declined' ? 'declined' : 'business_unavailable',
          }),
        },
      });
    };
    for (let i = 0; i < 10; i++) await appt(keeps.id, 'completed');
    for (let i = 0; i < 5; i++) await appt(keeps.id, 'cancelled', 'declined');
    for (let i = 0; i < 6; i++) await appt(cancels.id, 'completed');
    for (let i = 0; i < 6; i++) await appt(cancels.id, 'cancelled', 'business');

    await refreshSearchStats(db, NOW);
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
    const busy = await place({ name: `${tag} Busy` });
    await place({ name: `${tag} Quiet` });
    const service = await db.service.findFirstOrThrow({ where: { businessId: busy.id } });
    for (let i = 0; i < 4; i++) {
      const startAt = new Date(NOW.getTime() + (i + 1) * DAY);
      await db.appointment.create({
        data: {
          businessId: busy.id,
          serviceId: service.id,
          userId: customer,
          status: 'confirmed',
          startAt,
          endAt: new Date(startAt.getTime() + 1_800_000),
          blockedUntil: new Date(startAt.getTime() + 1_800_000),
          price: 3000,
          currency: 'ISK',
          confirmationCode: generateConfirmationCode(),
          createdAt: new Date(NOW.getTime() - DAY),
        },
      });
    }
    await refreshSearchStats(db, NOW);
    const trending = (await search.trending({ city: CITY, limit: 24 }, NOW)).map((b) => b.name);
    expect(trending).toContain(`${tag} Busy`);
    expect(trending).not.toContain(`${tag} Quiet`);
    await request(app).get('/v1/businesses/trending').expect(400); // needs a city or a point

    for (const i of [1, 2, 3])
      await place({ name: `${tag} Pick ${i}`, verified: true, photo: true, rating: [4 + i / 10, 50] });
    await place({ name: `${tag} No Photo`, verified: true, rating: [5, 500] });
    await place({
      name: `${tag} Clinic Pick`,
      category: 'clinic',
      verified: true,
      photo: true,
      rating: [4, 10],
    });
    const featured = await request(app).get('/v1/businesses/featured').query({ city: CITY }).expect(200);
    expect(names(featured).filter((x: string) => x.startsWith(tag))).toEqual([
      `${tag} Pick 3`,
      `${tag} Pick 2`,
      `${tag} Clinic Pick`,
    ]);
    expect(featured.body.data[0].coverPhotoUrl).toMatch(/^https:\/\/cdn\.test\/businesses\//);
  });

  it('autocomplete: businesses, categories and services as you type; nothing under 2 characters', async () => {
    const tag = word();
    await place({ name: `${tag} Barber Lounge`, services: [{ name: `${tag}wax special`, price: 1000 }] });
    const res = await request(app).get('/v1/businesses/autocomplete').query({ q: tag }).expect(200);
    expect(res.body.data.businesses.map((b: { name: string }) => b.name)).toEqual([`${tag} Barber Lounge`]);
    expect(res.body.data.services).toEqual([`${tag}wax special`]);
    const cat = await request(app)
      .get('/v1/businesses/autocomplete')
      .query({ q: `Barbershop ${RUN}` });
    expect(cat.body.data.categories).toEqual([
      { slug: cats.barber!.slug, name: `Barbershop ${RUN}`, icon: null },
    ]);
    const short = await request(app).get('/v1/businesses/autocomplete').query({ q: 'b' }).expect(200);
    expect(short.body.data).toEqual({ businesses: [], categories: [], services: [] });
  });
});

describe('Cities', () => {
  it('lists cities with businesses on BUKU and how many — never ones with only hidden or empty businesses', async () => {
    const empty = `Emptyville ${RUN}`;
    await place({ name: `${WORD} Cities Shop`, verified: true });
    await place({ name: `${WORD} Cities Pending` });
    const hiddenOnly = await place({ name: `${WORD} Cities Suspended`, status: 'suspended' });
    await db.business.update({ where: { id: hiddenOnly.id }, data: { city: empty } });

    const res = await request(app).get('/v1/cities');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('max-age=300');
    const cities = res.body.data as { city: string; country: string; businesses: number }[];
    const mine = cities.find((c) => c.city === CITY);
    expect(mine?.country).toBe('IS');
    expect(mine?.businesses).toBeGreaterThanOrEqual(2);
    expect(cities.some((c) => c.city === empty)).toBe(false);
  });
});

describe('Categories', () => {
  it('a tree of active ones; a category with its parent; 404 for unknown or switched off', async () => {
    const tree = await request(app).get('/v1/categories').expect(200);
    const root = tree.body.data.find((c: { slug: string }) => c.slug === cats.root!.slug);
    expect(root.children.map((c: { slug: string }) => c.slug)).toEqual([cats.barber!.slug]);
    expect(tree.body.data.some((c: { slug: string }) => c.slug === cats.hidden!.slug)).toBe(false);

    const one = await request(app).get(`/v1/categories/${cats.barber!.slug}`).expect(200);
    expect(one.body.data.parent).toEqual({ slug: cats.root!.slug, name: `Grooming ${RUN}` });
    await request(app).get(`/v1/categories/${cats.hidden!.slug}`).expect(404);
    await request(app).get('/v1/categories/NOT_A_SLUG').expect(400);

    const list = await request(app)
      .get(`/v1/categories/${cats.clinic!.slug}/businesses`)
      .query({ city: CITY, limit: 50 })
      .expect(200);
    expect(
      list.body.data.every((b: { category: { slug: string } }) => b.category.slug === cats.clinic!.slug),
    ).toBe(true);
    expect(list.body.data.length).toBeGreaterThan(0);
  });
});

describe('Search analytics', () => {
  it('record what was searched, never contact details, users or coordinates', async () => {
    events.length = 0;
    await find({ q: '0300 1234567' }).expect(200);
    await request(app).get('/v1/businesses/nearby').query({ lat: HOME.lat, lng: HOME.lng, openNow: true });
    expect(events[0]).toMatchObject({ query: '[redacted]', city: CITY, nearby: false });
    expect(events[1]).toMatchObject({ nearby: true, filters: ['openNow'], sort: 'distance' });
    expect(JSON.stringify(events)).not.toContain(String(HOME.lat));
  });
});
