/**
 * Makes sure every database BUKU needs exists, with the extensions only an administrator can add
 * (docs/DATABASE.md §14). Idempotent; runs before migrations, as the admin role (the Postgres
 * superuser in development; the provider's admin role in production, where it is part of
 * provisioning):
 *
 *   DATABASE_ADMIN_URL=postgresql://<admin>@host:5432/postgres tsx scripts/prepare-databases.ts
 *
 * On the host (`pnpm db:prepare`) the URL is assembled from the repo-root .env instead.
 *
 * - The directory database (the shard registry, DB-013), the catalog (search and discovery,
 *   DB-041), and their test twins.
 * - `buku_replicator` (BUKU_REPLICATOR_PASSWORD): copies reference data from the directory to
 *   every business shard and the catalog (logical replication, DB-015). It can replicate and
 *   read the published tables, nothing else.
 * - pg_cron in the `postgres` database (scheduled jobs run from there into the others).
 * - pg_stat_statements (query costs) and pgaudit (schema and role changes) in every database, and
 *   in template1 so every database made later (a new shard) has them too.
 * - pg_partman (time partitions, DB-006) in template1, usable by the migrator, so every shard
 *   database starts with it.
 * - The role `buku_all_businesses` (DB-020): no login and no rights of its own; business shards'
 *   row-level security lets its members (granted WITH INHERIT TRUE by apply-access) work across
 *   businesses. It must exist before a business shard is migrated.
 *
 * Only fixed names below, never input: nothing here is built from anything a caller sends.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createDatabaseClient } from '../src/index.js';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (!process.env.DATABASE_ADMIN_URL && existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });
const password = process.env.POSTGRES_SUPERUSER_PASSWORD;
const url =
  process.env.DATABASE_ADMIN_URL ??
  (password
    ? `postgresql://buku_admin:${encodeURIComponent(password)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/postgres`
    : undefined);
if (!url) {
  console.error('prepare-databases: DATABASE_ADMIN_URL is not set');
  process.exit(1);
}
const replicatorPassword = process.env.BUKU_REPLICATOR_PASSWORD;
if (!replicatorPassword || !/^[A-Za-z0-9_-]{16,128}$/.test(replicatorPassword)) {
  console.error(
    'prepare-databases: BUKU_REPLICATOR_PASSWORD must be 16-128 letters, digits, _ or - (run pnpm bootstrap)',
  );
  process.exit(1);
}

/** Databases that must exist, besides the main one created with the server. */
const DATABASES = ['buku_directory', 'buku_directory_test', 'buku_catalog', 'buku_catalog_test'] as const;
/** Every database that gets the monitoring and audit extensions. */
const MONITORED = ['template1', 'buku', 'buku_test', ...DATABASES] as const;

const at = (database: string) => {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return createDatabaseClient({ url: u.toString(), applicationName: 'prepare-databases', maxConnections: 1 });
};

const admin = at('postgres');
try {
  for (const name of DATABASES) {
    const found = await admin.$queryRaw<
      { n: number }[]
    >`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
    if (found.length === 0) {
      // From template1, so it starts with the `extensions` schema and default privileges.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER buku_migrator TEMPLATE template1`);
      console.log(`prepare-databases: created ${name}`);
    }
    await admin.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
    await admin.$executeRawUnsafe(
      `GRANT CONNECT, TEMPORARY ON DATABASE "${name}" TO buku_migrator, buku_app`,
    );
  }
  await admin.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_cron');
  await admin.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'buku_all_businesses') THEN
      CREATE ROLE buku_all_businesses NOLOGIN NOINHERIT;
    END IF; END $$`);
  await admin.$executeRawUnsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'buku_replicator') THEN
      CREATE ROLE buku_replicator LOGIN REPLICATION NOINHERIT;
    END IF; END $$`);
  // The password was checked above: letters, digits, _ and - only.
  await admin.$executeRawUnsafe(
    `ALTER ROLE buku_replicator WITH LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS CONNECTION LIMIT 100 PASSWORD '${replicatorPassword}'`,
  );
  for (const directory of ['buku_directory', 'buku_directory_test'])
    await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${directory}" TO buku_replicator`);
} finally {
  await admin.$disconnect();
}

for (const name of MONITORED) {
  const db = at(name);
  try {
    await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS extensions');
    await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_stat_statements SCHEMA extensions');
    await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgaudit');
    if (name === 'template1') {
      // Partition upkeep runs as the tables' owner (the migrator), from pg_cron.
      await db.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS partman');
      await db.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pg_partman SCHEMA partman');
      for (const sql of [
        'GRANT USAGE, CREATE ON SCHEMA partman TO buku_migrator',
        'GRANT ALL ON ALL TABLES IN SCHEMA partman TO buku_migrator',
        'GRANT ALL ON ALL SEQUENCES IN SCHEMA partman TO buku_migrator',
        'GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA partman TO buku_migrator',
        'GRANT EXECUTE ON ALL PROCEDURES IN SCHEMA partman TO buku_migrator',
      ])
        await db.$executeRawUnsafe(sql);
    }
  } finally {
    await db.$disconnect();
  }
}
console.log(
  `prepare-databases: ${DATABASES.join(', ')} ready; pg_cron, pg_stat_statements, pgaudit, pg_partman installed`,
);
