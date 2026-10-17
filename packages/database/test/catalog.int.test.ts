import { IdGenerator, publicId } from '@buku/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createCatalogClient,
  createDatabaseClient,
  createDirectoryClient,
  type CatalogClient,
  type Database,
  type DirectoryClient,
} from '../src/index.js';
import { CATALOG_ACCESS } from '../src/access.js';
import { databaseAccessStatements } from '../src/access-sql.js';
import { applyStatements } from '../src/apply-access.js';
import { ensureReferenceCopy, waitForReferenceCopy } from '../src/provision.js';
import { asService, ensureServiceRoles, passwords } from './service-roles.js';
import { testEnv } from './int-env.js';

/**
 * The catalog (docs/DATABASE.md DB-041): every business as discovery sees it, with v1's search
 * document (name, kind, services, description, city) and map point kept by triggers, and a copy of
 * the reference data from the directory (DB-015) whose changes reach the documents too.
 */

const ids = new IdGenerator(6);
let directory: DirectoryClient; // the directory's owner: where reference data is changed
let catalog: CatalogClient; // a service-like role
let owner: Database; // the catalog's owner (admin): to look at derived columns
let kindId: bigint;

beforeAll(async () => {
  directory = createDirectoryClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'catalog-int-test',
  });
  catalog = createCatalogClient({ url: testEnv.catalogAppUrl, applicationName: 'catalog-int-test' });
  owner = createDatabaseClient({
    url: testEnv.adminUrl('buku_catalog_test'),
    applicationName: 'catalog-int-test',
  });
  await ensureReferenceCopy(owner, 'buku_catalog_test', {
    conninfo: testEnv.referenceSource,
    replicator: testEnv.replicator,
    publisherUrl: testEnv.adminUrl('buku_directory_test'),
  });
  await waitForReferenceCopy(owner, 'buku_catalog_test');
  // A kind of business of its own, under "Beauty & Hair" (group 1), arriving by replication.
  kindId = ids.next();
  await directory.$executeRaw`INSERT INTO reference.categories (id, parent_id, depth, sort_order, slug, name)
    VALUES (${kindId}, 1, 1, 99, ${`catalog-test-${kindId}`}, 'Barber lounge')`;
  for (let i = 0; (await catalog.category.count({ where: { id: kindId } })) === 0; i++) {
    if (i > 100) throw new Error('the new kind never reached the catalog');
    await new Promise((r) => setTimeout(r, 200));
  }
});

afterAll(async () => {
  await catalog?.$disconnect();
  await owner?.$disconnect();
  await directory?.$disconnect();
});

/** A listed business in the test kind, in Lahore. */
async function listed(name: string, extra: Record<string, unknown> = {}) {
  const businessId = ids.next();
  await catalog.catalogBusiness.create({
    data: {
      businessId,
      categoryId: kindId,
      version: 1n,
      createdAt: new Date(),
      publicId: publicId(),
      slug: `${name.toLowerCase().replaceAll(' ', '-')}-${businessId}`,
      name,
      status: 'verified',
      country: 'PK',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      city: 'Lahore',
      ...extra,
    },
  });
  return businessId;
}

/** Does the business's search document match these words? */
const matches = async (businessId: bigint, words: string) => {
  const rows = await owner.$queryRaw<{ hit: boolean }[]>`
    SELECT search_vector @@ plainto_tsquery('english', ${words}) AS hit FROM catalog.businesses WHERE business_id = ${businessId}`;
  return rows[0]!.hit;
};

describe('the catalog (DB-041)', () => {
  it('has the whole reference copy, read-only', async () => {
    expect(await catalog.category.count()).toBe(await directory.category.count());
    expect(await catalog.plan.count()).toBe(8);
    await expect(
      catalog.$executeRawUnsafe(`DELETE FROM reference.currencies WHERE code = 'PKR'`),
    ).rejects.toThrow(/permission denied/);
  });

  it('keeps v1’s search document: name, kind and its group, services, description, city', async () => {
    const b = await listed('Fade Studio', {
      description: 'Classic cuts and hot towel shaves',
      lat: 31.5204,
      lng: 74.3587,
    });
    expect(await matches(b, 'fade')).toBe(true);
    expect(await matches(b, 'barber lounge')).toBe(true); // its kind
    expect(await matches(b, 'beauty')).toBe(true); // its kind's group
    expect(await matches(b, 'towel')).toBe(true);
    expect(await matches(b, 'lahore')).toBe(true);
    expect(await matches(b, 'manicure')).toBe(false);
    // A service added: "manicure" now finds it; removed: no more.
    const serviceId = ids.next();
    await catalog.catalogService.create({
      data: { serviceId, businessId: b, version: 1n, priceMinor: 120000n, currency: 'PKR', name: 'Manicure' },
    });
    expect(await matches(b, 'manicure')).toBe(true);
    await catalog.catalogService.delete({ where: { serviceId } });
    expect(await matches(b, 'manicure')).toBe(false);
    // Its place on the map, from lat/lng.
    const place = await owner.$queryRaw<{ wkt: string }[]>`
      SELECT extensions.ST_AsText(location::extensions.geometry) AS wkt FROM catalog.businesses WHERE business_id = ${b}`;
    expect(place[0]!.wkt).toBe('POINT(74.3587 31.5204)');
  });

  it('a kind renamed on the directory reaches every document in it, by replication', async () => {
    const b = await listed('Sharp Line');
    expect(await matches(b, 'grooming')).toBe(false);
    await directory.$executeRaw`UPDATE reference.categories SET name = 'Grooming parlour' WHERE id = ${kindId}`;
    await expect.poll(() => matches(b, 'grooming'), { timeout: 20_000 }).toBe(true);
  });

  it('typo-tolerant name matching and distance work as in v1', async () => {
    const near = await listed('Barbershop Royale', { lat: 31.52, lng: 74.35 });
    const rows = await owner.$queryRaw<{ id: bigint }[]>`
      SELECT business_id AS id FROM catalog.businesses
      WHERE extensions.word_similarity('barbrshop', name) >= 0.5
        AND extensions.ST_DWithin(location, extensions.ST_SetSRID(extensions.ST_MakePoint(74.3587, 31.5204), 4326)::extensions.geography, 10000)`;
    expect(rows.map((r) => r.id)).toContain(near);
  });

  it('refuses rows that would mislead search', async () => {
    await expect(listed('Bad Status', { status: 'open' })).rejects.toThrow();
    await expect(listed('Half Place', { lat: 31.5 })).rejects.toThrow();
    await expect(listed('No Version', { version: 0n })).rejects.toThrow();
  });
});

describe('each service’s rights on the catalog (D2d)', () => {
  beforeAll(async () => {
    await ensureServiceRoles();
    await applyStatements(
      testEnv.adminUrl('buku_catalog_test'),
      databaseAccessStatements('buku_catalog_test', CATALOG_ACCESS, passwords, {
        schemas: ['catalog', 'reference'],
      }),
    );
  });

  it('search keeps it, ads reads which ads may run, nobody else gets in', async () => {
    const search = asService('search', 'buku_catalog_test');
    const ads = asService('ads', 'buku_catalog_test');
    const booking = asService('booking', 'buku_catalog_test');
    try {
      const b = await listed('Rights Check');
      await search.$executeRawUnsafe(
        `UPDATE catalog.businesses SET review_count = 3 WHERE business_id = ${b}`,
      );
      await ads.$queryRawUnsafe('SELECT count(*) FROM catalog.ads');
      await expect(ads.$executeRawUnsafe(`DELETE FROM catalog.ads`)).rejects.toThrow(/permission denied/);
      await expect(search.$executeRawUnsafe(`DELETE FROM reference.plans`)).rejects.toThrow(
        /permission denied/,
      );
      await expect(booking.$queryRawUnsafe('SELECT 1')).rejects.toThrow(/CONNECT|permission denied/);
    } finally {
      await Promise.all([search.$disconnect(), ads.$disconnect(), booking.$disconnect()]);
    }
  });
});
