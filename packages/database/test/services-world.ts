/**
 * The services' database v2 world for integration tests (D3): a directory of its own,
 * buku_directory_services_test (made by `pnpm db:prepare`), with one user shard and one business
 * shard on the test cluster, the business shard's copy of the reference data (DB-015), and every
 * service's rights applied exactly as apply-access gives them in production. Rebuilt once per run
 * by the global setup; a service's tests sign in to it as that service's own role.
 *
 * It is kept apart from buku_directory_test, whose registry the database package's own tests
 * rebuild as they go.
 */
import type { ServiceName } from '../src/access.js';
import type { DataPlane } from '../src/data-plane.js';
import { directoryAccessStatements } from '../src/access-sql.js';
import { applyShardAccess, applyStatements } from '../src/apply-access.js';
import { createDirectoryClient } from '../src/directory.js';
import { createDatabaseClient } from '../src/index.js';
import { dropDatabase, migrate, provisionShards, waitForReferenceCopy } from '../src/provision.js';
import { testEnv } from './int-env.js';
import { ensureServiceRoles, passwords } from './service-roles.js';

export const SERVICES_DIRECTORY = 'buku_directory_services_test';
/** The setting the registry names for the test cluster's address (host and port only). */
const CLUSTER_SECRET = 'BUKU_DB_CLUSTER_SVCTEST';

const urlAs = (credentials: { user: string; password: string }, database: string) => {
  const u = new URL(testEnv.cluster);
  u.username = credentials.user;
  u.password = encodeURIComponent(credentials.password);
  u.pathname = `/${database}`;
  return u.toString();
};

export const servicesWorld = {
  directory: SERVICES_DIRECTORY,
  shards: { user: 'buku_svctest_user_pk_1', business: 'buku_svctest_business_pk_1' },
  /** Where cluster addresses are read from, as the services read them. */
  env: { ...process.env, [CLUSTER_SECRET]: testEnv.cluster } as NodeJS.ProcessEnv,
  /** A service's own role (D-092) on one database of the test cluster. */
  urlFor: (service: ServiceName, database = 'buku_test') =>
    urlAs({ user: `buku_svc_${service}`, password: passwords[service] }, database),
  /** buku_app, the tools' and tests' role: what fixtures are written as. */
  appUrl: (database = 'buku_test') => urlAs(testEnv.app, database),
  /** The schema owner, for fixtures no service may write (reference data BUKU curates). */
  ownerUrl: (database = SERVICES_DIRECTORY) => urlAs(testEnv.migrator, database),
};

/**
 * Billing switched on for an audience while `fn` runs: the directory's settings, changed as
 * billing-service (which owns them), and followed on every business shard by replication (DB-015).
 */
export async function withBilling<T>(
  world: DataPlane,
  audience: 'business' | 'user',
  fn: () => Promise<T>,
): Promise<T> {
  const billing = createDirectoryClient({
    url: servicesWorld.urlFor('billing', SERVICES_DIRECTORY),
    applicationName: 'services-test',
  });
  const set = async (enabled: boolean) => {
    await billing.billingSettings.update({ where: { audience }, data: { enabled } });
    const deadline = Date.now() + 15_000;
    for (const shard of await world.router.shards('business')) {
      const copy = world.businesses.forShard(shard);
      // Reference copies have no row-level security: any connection reads them.
      while ((await copy.billingSettings.findUnique({ where: { audience } }))?.enabled !== enabled) {
        if (Date.now() > deadline) throw new Error(`billing settings didn't reach ${shard.databaseName}`);
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };
  try {
    await set(true);
    return await fn();
  } finally {
    await set(false).finally(() => billing.$disconnect());
  }
}

/** Billing switched on for businesses while `fn` runs. */
export const withBusinessBilling = <T>(world: DataPlane, fn: () => Promise<T>) =>
  withBilling(world, 'business', fn);

/** A plan granted by an admin, on the business's shard. */
export async function givePlan(world: DataPlane, businessId: bigint, code: string): Promise<void> {
  await world.inBusiness(businessId, async (tx) => {
    const plan = await tx.plan.findUniqueOrThrow({ where: { code } });
    await tx.subscription.create({
      data: {
        id: world.id(),
        businessId,
        planId: plan.id,
        provider: 'manual',
        status: 'active',
        grantNote: 'test',
      },
    });
  });
}

/** Drop last run's world and build a fresh one. */
export async function buildServicesWorld(): Promise<void> {
  const serverUrl = testEnv.adminUrl('postgres');
  const publisherUrl = testEnv.adminUrl(SERVICES_DIRECTORY);
  const migratorUrl = urlAs(testEnv.migrator, SERVICES_DIRECTORY);

  // 1. Last run's shards (each one's reference copy and slot first), then any slot nobody holds.
  const server = createDatabaseClient({ url: serverUrl, applicationName: 'test-setup' });
  try {
    const old = await server.$queryRaw<{ name: string }[]>`
      SELECT datname::text AS name FROM pg_database WHERE datname LIKE 'buku\\_svctest\\_%'`;
    for (const { name } of old) await dropDatabase({ serverUrl, database: name, publisherUrl });
    await server.$executeRaw`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
      WHERE database = ${SERVICES_DIRECTORY} AND NOT active`;
  } finally {
    await server.$disconnect();
  }

  // 2. The directory, from nothing (its publication isn't in a schema, so it goes by name).
  const owner = createDatabaseClient({ url: migratorUrl, applicationName: 'test-setup', maxConnections: 1 });
  try {
    await owner.$executeRawUnsafe('DROP PUBLICATION IF EXISTS buku_reference');
    await owner.$executeRawUnsafe('DROP SCHEMA IF EXISTS registry, ids, lookup, reference CASCADE');
    await owner.$executeRawUnsafe('DROP TABLE IF EXISTS public._prisma_migrations');
  } finally {
    await owner.$disconnect();
  }
  migrate('prisma.directory.config.ts', 'DATABASE_DIRECTORY_MIGRATION_URL', migratorUrl, SERVICES_DIRECTORY);

  // 3. The layout: this server as the one cluster, a shard for people and one for businesses.
  const registry = createDirectoryClient({ url: migratorUrl, applicationName: 'test-setup' });
  try {
    await registry.region.create({ data: { region: 0, code: 'pk', name: 'Pakistan' } });
    await registry.cluster.create({
      data: { clusterId: 1, region: 0, name: 'services-test', dsnSecret: CLUSTER_SECRET },
    });
    const pattern = 'buku_svctest_{entity}_{region}_{shard}';
    await registry.entity.createMany({
      data: [
        {
          entity: 'user',
          description: 'people (services tests)',
          defaultRowLimit: 1_000_000n,
          databasePattern: pattern,
          placedBy: ['buku_svc_auth', 'buku_app'],
        },
        {
          entity: 'business',
          description: 'businesses (services tests)',
          defaultRowLimit: 1_000_000n,
          databasePattern: pattern,
          placedBy: ['buku_svc_business', 'buku_app'],
        },
      ],
    });
    // Fixtures are written as buku_app, which writes handles too (as prisma/directory/seed.ts does).
    await registry.$executeRaw`UPDATE lookup.handle_kinds SET writers = array_append(writers, 'buku_app')
      WHERE NOT ('buku_app' = ANY (writers))`;
    for (const entity of ['user', 'business'])
      await registry.$queryRaw`SELECT shard_no FROM registry.add_shard(${entity}, 0::smallint, 1::smallint)`;
  } finally {
    await registry.$disconnect();
  }

  // 4. The shard databases, migrated, and the business shard's copy of the reference data.
  await provisionShards({
    directoryUrl: migratorUrl,
    admin: testEnv.admin,
    migrator: testEnv.migrator,
    env: servicesWorld.env,
    families: ['user', 'business'],
    reference: {
      conninfo: `host=localhost port=5432 dbname=${SERVICES_DIRECTORY}`,
      replicator: testEnv.replicator,
      publisherUrl,
    },
  });
  const copy = createDatabaseClient({
    url: testEnv.adminUrl(servicesWorld.shards.business),
    applicationName: 'test-setup',
  });
  try {
    await waitForReferenceCopy(copy, servicesWorld.shards.business, 60_000);
  } finally {
    await copy.$disconnect();
  }

  // 5. Every service's rights there, exactly as in production.
  await ensureServiceRoles();
  await applyStatements(publisherUrl, directoryAccessStatements(SERVICES_DIRECTORY, passwords));
  for (const [family, database] of Object.entries(servicesWorld.shards))
    await applyShardAccess(testEnv.adminUrl(database), family, passwords);
}
