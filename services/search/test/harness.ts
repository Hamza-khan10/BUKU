import { randomUUID } from 'node:crypto';
import { createLogger, generateConfirmationCode, publicId, Readiness } from '@buku/common';
import { createDirectoryClient, DataPlane, type DirectoryClient } from '@buku/database';
import { MediaLinks, type ObjectStorage } from '@buku/media';
import type { Express } from 'express';
import { afterAll, beforeAll } from 'vitest';
import { SERVICES_DIRECTORY, servicesWorld } from '../../../packages/database/test/services-world.js';
import { buildSearchApp } from '../src/app.js';
import { CatalogSync } from '../src/catalog/catalog-sync.js';
import type { SearchAnalytics } from '../src/routes.js';
import type { SearchService } from '../src/search-service.js';

/**
 * Shared setup for search-service integration tests on database v2 (D3h): the real app as
 * search-service's own role on the services' test world, whose catalog it searches
 * (packages/database/test/services-world.ts). Fixtures are written where they live — businesses on
 * their shard as buku_app, categories on the directory as its owner (they reach the catalog by
 * replication) — and a business reaches the catalog the way its events bring it: `refresh`.
 *
 * Every business here is in a city made up for the run (and far from every other test's), so
 * other tests' data never shows up. Times are fixed: Wednesday 10:00 UTC (Reykjavik keeps UTC all
 * year); the harness's catalog sync takes that day as today.
 */

export const NOW = new Date('2026-10-07T10:00:00Z'); // a Wednesday
export const HOME = { lat: 64.1466, lng: -21.9426 }; // far from every other test's businesses
export const DAY = 86_400_000;

/** A made-up word no other business uses (and unlike every other one, so typo matching can't link them). */
export const word = () =>
  Array.from({ length: 9 }, () => 'bcdfghjklmnpqrstvwxz'[Math.floor(Math.random() * 20)]).join('');

export interface PlaceOpts {
  name: string;
  category?: CategoryKey;
  km?: number; // north of HOME
  description?: string;
  /** Prices in cents (EUR). */
  services?: { name: string; price: number; active?: boolean }[];
  hours?: { day: number; open: string; close: string }[];
  verified?: boolean;
  status?: 'pending' | 'verified' | 'suspended' | 'rejected';
  rating?: [number, number];
  photo?: boolean;
  queue?: 'none' | 'set_up' | 'open';
  waiting?: number;
  deleted?: boolean;
  /** Left out of the catalog: as if no event had brought it yet. */
  unlisted?: boolean;
}

export type CategoryKey = 'root' | 'barber' | 'clinic' | 'hidden' | 'henna';
export interface Place {
  id: bigint;
  publicId: string;
  slug: string;
}

export interface Harness {
  app: Express;
  search: SearchService;
  /** search-service's own data plane (with the catalog). */
  plane: DataPlane;
  /** Fixtures and checks on the shards, as buku_app (row-level security still applies). */
  world: DataPlane;
  /** Keeps the catalog, with today fixed at NOW. */
  sync: CatalogSync;
  /** What the app reported searching. */
  events: Parameters<SearchAnalytics['searched']>[0][];
  run: string;
  city: string;
  cats: Record<CategoryKey, { id: bigint; slug: string }>;
  customer: bigint;
  /** A business in the run's city, on its shard and then in the catalog. */
  place(o: PlaceOpts): Promise<Place>;
  /**
   * A visit to `p`, `daysAgo` days before now (negative: still to come), booked the day before it
   * (or yesterday, for one still to come). Real time: the stats look back from now.
   */
  appointment(
    p: Place,
    o: { status: 'confirmed' | 'completed' | 'cancelled'; daysAgo: number; cancel?: 'business' | 'declined' },
  ): Promise<void>;
}

export function useSearchHarness(): Harness {
  const h = { events: [] } as unknown as Harness & { directory: DirectoryClient };
  h.run = randomUUID().slice(0, 8);
  h.city = `Testpur ${h.run}`;

  beforeAll(async () => {
    h.plane = await DataPlane.start({
      service: 'search',
      databaseUrl: servicesWorld.urlFor('search'),
      directoryUrl: servicesWorld.urlFor('search', SERVICES_DIRECTORY),
      catalogUrl: servicesWorld.urlFor('search', servicesWorld.catalog),
      useCatalog: true,
      env: servicesWorld.env,
      instance: `search-int-test:${process.pid}`,
    });
    h.world = await DataPlane.start({
      service: 'business',
      databaseUrl: servicesWorld.appUrl(),
      directoryUrl: servicesWorld.appUrl(SERVICES_DIRECTORY),
      env: servicesWorld.env,
      instance: `search-int-fixtures:${process.pid}`,
    });
    h.directory = createDirectoryClient({ url: servicesWorld.ownerUrl(), applicationName: 'search-test' });
    const links = new MediaLinks({} as ObjectStorage, {
      mediaBucket: 'media',
      privateBucket: 'private',
      publicBaseUrl: 'https://cdn.test',
    });
    ({ app: h.app, search: h.search } = buildSearchApp({
      plane: h.plane,
      links,
      analytics: { searched: (e) => h.events.push(e) },
      http: {
        service: 'search-test',
        logger: createLogger({ service: 'search-test', level: process.env.TEST_LOG_LEVEL ?? 'silent' }),
        readiness: new Readiness(),
        trustProxyHops: 1,
      },
    }));
    h.sync = new CatalogSync(h.plane, () => NOW);
    h.customer = h.world.id();
    await makeCategories(h);
  });

  afterAll(async () => {
    await h.plane?.close();
    await h.world?.close();
    await h.directory?.$disconnect();
  });

  h.place = (o) => place(h, o);
  h.appointment = async (p, o) => {
    const startAt = new Date(Date.now() - o.daysAgo * DAY);
    const endAt = new Date(startAt.getTime() + 1_800_000);
    await h.world.inBusiness(p.id, async (tx) => {
      const service = await tx.service.findFirstOrThrow({ where: { businessId: p.id } });
      await tx.appointment.create({
        data: {
          id: h.world.id(),
          businessId: p.id,
          serviceId: service.id,
          userId: h.customer,
          status: o.status,
          startAt,
          endAt,
          blockedUntil: endAt,
          priceMinor: 300_000n,
          currency: 'EUR',
          code: generateConfirmationCode(),
          publicId: publicId(),
          createdAt: new Date(Math.min(startAt.getTime(), Date.now()) - DAY),
          ...(o.status === 'cancelled' && {
            cancelledAt: startAt,
            cancelledBy: 'business',
            cancelReasonCode: o.cancel === 'declined' ? 'declined' : 'business_unavailable',
          }),
        },
      });
    });
  };
  return h;
}

/** The run's kinds of business, made on the directory as BUKU curates them; waits for the catalog's copy. */
async function makeCategories(h: Harness & { directory: DirectoryClient }) {
  const make = async (key: CategoryKey, data: Record<string, unknown> & { name: string; slug: string }) => {
    const id = h.world.id();
    await h.directory.category.create({ data: { id, ...data } as never });
    h.cats[key] = { id, slug: data.slug };
    return id;
  };
  h.cats = {} as Harness['cats'];
  const run = h.run;
  const root = await make('root', { name: `Grooming ${run}`, slug: `grooming-${run}`, sortOrder: 0 });
  await make('barber', { name: `Barbershop ${run}`, slug: `barbershop-${run}`, parentId: root, depth: 1 });
  await make('clinic', { name: `Clinic ${run}`, slug: `clinic-${run}` });
  await make('hidden', { name: `Hidden ${run}`, slug: `hidden-${run}`, isActive: false });
  // A kind an owner added, not reviewed yet (D-098).
  await make('henna', {
    name: `Henna ${run}`,
    slug: `henna-${run}`,
    parentId: root,
    depth: 1,
    pending: true,
    suggestedById: h.world.id(),
  });

  const ids = Object.values(h.cats).map((c) => c.id);
  const deadline = Date.now() + 15_000;
  while ((await h.plane.catalog!.category.count({ where: { id: { in: ids } } })) < ids.length) {
    if (Date.now() > deadline) throw new Error("the run's categories didn't reach the catalog");
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** A business in the run's city, `km` north of HOME, as business-service registers it. */
async function place(h: Harness, o: PlaceOpts): Promise<Place> {
  const { world } = h;
  const id = world.id();
  const pid = publicId();
  const slug = `${o.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}-${randomUUID().slice(0, 6)}`;
  const status = o.status ?? (o.verified ? 'verified' : 'pending');
  await world.placeBusiness(id);
  await world.handles.claim('business.slug', Buffer.from(slug, 'utf8'), id);
  await world.handles.claim('business.public_id', Buffer.from(pid, 'ascii'), id);
  await world.inBusiness(id, async (tx) => {
    await tx.business.create({
      data: {
        id,
        publicId: pid,
        ownerUserId: world.id(),
        categoryId: h.cats[o.category ?? 'barber'].id,
        name: o.name,
        slug,
        description: o.description ?? null,
        city: h.city,
        country: 'IS',
        lat: HOME.lat + (o.km ?? 0) / 111.2,
        lng: HOME.lng,
        timezone: 'Atlantic/Reykjavik',
        currency: 'EUR',
        status,
        ...(status === 'verified' && { verifiedAt: new Date() }),
        avgRating: o.rating?.[0] ?? 0,
        reviewCount: o.rating?.[1] ?? 0,
        ...(o.deleted && { deletedAt: new Date() }),
      },
    });
    for (const s of o.services ?? [{ name: 'Haircut', price: 300_000 }])
      await tx.service.create({
        data: {
          id: world.id(),
          businessId: id,
          name: s.name,
          durationMinutes: 30,
          priceMinor: BigInt(s.price),
          currency: 'EUR',
          isActive: s.active ?? true,
        },
      });
    for (const hr of o.hours ?? [])
      await tx.businessHours.create({
        data: { id: world.id(), businessId: id, dayOfWeek: hr.day, openTime: hr.open, closeTime: hr.close },
      });
    if (o.photo)
      await tx.businessPhoto.create({
        data: {
          id: world.id(),
          businessId: id,
          storageKey: `businesses/${pid}/cover-${randomUUID()}.webp`,
          contentType: 'image/webp',
          sizeBytes: 1000,
          isPrimary: true,
          uploadedAt: new Date(),
        },
      });
    if (o.queue === 'set_up' || o.queue === 'open')
      await tx.queueSettings.create({ data: { businessId: id } });
    if (o.queue === 'open') {
      const sessionDate = new Date('2026-10-07T00:00:00Z');
      const session = await tx.queueSession.create({
        data: { id: world.id(), businessId: id, sessionDate, status: 'open' },
      });
      for (let i = 0; i < (o.waiting ?? 0); i++)
        await tx.queueTicket.create({
          data: {
            id: world.id(),
            sessionId: session.id,
            sessionDate,
            businessId: id,
            ticketNumber: i + 1,
            walkInName: `Walk-in ${i + 1}`,
          },
        });
    }
  });
  if (!o.unlisted) await h.sync.refresh(id);
  return { id, publicId: pid, slug };
}
