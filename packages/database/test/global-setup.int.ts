/**
 * Vitest global setup for the integration project: rebuilds the `buku_test`
 * schema from scratch and applies every migration, exactly as a production
 * deploy would (`prisma migrate deploy`); the same for the directory's and
 * the catalog's test twins, `buku_directory_test` and `buku_catalog_test`
 * (created by `pnpm db:prepare`).
 *
 * The last run's shard databases (buku_test_*) and reference copies go first,
 * subscriptions and replication slots before anything else: a slot left behind
 * would keep the server's WAL forever.
 *
 * Last, the services' own v2 world (services-world.ts), which their tests use.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createDatabaseClient } from '../src/index.js';
import { dropDatabase, dropReferenceCopy } from '../src/provision.js';
import { testEnv } from './int-env.js';
import { buildServicesWorld } from './services-world.js';

const packageDir = resolve(import.meta.dirname, '..');
const prisma = (args: string[], env: Record<string, string>) =>
  execFileSync(resolve(packageDir, 'node_modules/.bin/prisma'), args, {
    cwd: packageDir,
    env: { ...process.env, ...env },
    stdio: 'pipe',
  });

/** Drop these schemas (and Prisma's history) as the owner, so migrations start from nothing. */
async function reset(url: string, schemas: string) {
  const db = createDatabaseClient({ url, applicationName: 'test-setup', maxConnections: 1 });
  try {
    await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${schemas} CASCADE`);
    await db.$executeRawUnsafe('DROP TABLE IF EXISTS public._prisma_migrations');
  } finally {
    await db.$disconnect();
  }
}

export default async function setup(): Promise<void> {
  const db = createDatabaseClient({
    url: testEnv.migratorUrl,
    applicationName: 'test-setup',
    maxConnections: 1,
  });
  try {
    await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public, ai, partitions CASCADE');
    // Default privileges (set up by docker/postgres/init) grant the app role
    // USAGE on schemas the migrator creates, so no explicit GRANT is needed.
    await db.$executeRawUnsafe('CREATE SCHEMA public');
  } finally {
    await db.$disconnect();
  }
  prisma(['migrate', 'deploy'], { DATABASE_MIGRATION_URL: testEnv.migratorUrl });

  // The last run's copies of the test directory: shard databases, then the catalog's copy, then
  // any slot nobody holds any more (a run that crashed).
  const publisherUrl = testEnv.adminUrl('buku_directory_test');
  const server = createDatabaseClient({ url: testEnv.adminUrl('postgres'), applicationName: 'test-setup' });
  try {
    const shards = await server.$queryRaw<{ name: string }[]>`
      SELECT datname::text AS name FROM pg_database WHERE datname LIKE 'buku\\_test\\_%'`;
    for (const { name } of shards) {
      await dropDatabase({ serverUrl: testEnv.adminUrl('postgres'), database: name, publisherUrl });
    }
    const catalog = createDatabaseClient({
      url: testEnv.adminUrl('buku_catalog_test'),
      applicationName: 'test-setup',
    });
    try {
      await dropReferenceCopy(catalog, 'buku_catalog_test', publisherUrl);
    } finally {
      await catalog.$disconnect();
    }
    await server.$executeRaw`SELECT pg_drop_replication_slot(slot_name) FROM pg_replication_slots
      WHERE database = 'buku_directory_test' AND NOT active`;
  } finally {
    await server.$disconnect();
  }

  // The directory: its publication isn't in a schema, so it goes by name.
  const directory = createDatabaseClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'test-setup',
  });
  try {
    await directory.$executeRawUnsafe('DROP PUBLICATION IF EXISTS buku_reference');
  } finally {
    await directory.$disconnect();
  }
  await reset(testEnv.directoryMigratorUrl, 'registry, ids, lookup, reference');
  prisma(['migrate', 'deploy', '--config', 'prisma.directory.config.ts'], {
    DATABASE_DIRECTORY_MIGRATION_URL: testEnv.directoryMigratorUrl,
  });

  await reset(testEnv.catalogMigratorUrl, 'catalog, reference');
  prisma(['migrate', 'deploy', '--config', 'prisma.catalog.config.ts'], {
    DATABASE_CATALOG_MIGRATION_URL: testEnv.catalogMigratorUrl,
  });

  await buildServicesWorld();
}
