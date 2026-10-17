/**
 * Makes every shard in the registry a real, up-to-date database (src/provision.ts): create it,
 * migrate it, schedule its partition upkeep, subscribe its reference copy. Idempotent; after adding shards and after every
 * release. Runs with the cluster administrator's and the migrator's credentials:
 *
 *   DATABASE_DIRECTORY_MIGRATION_URL=… POSTGRES_SUPERUSER_PASSWORD=… BUKU_MIGRATOR_PASSWORD=… \
 *   BUKU_REPLICATOR_PASSWORD=… BUKU_DB_CLUSTER_LOCAL_1=postgresql://host:5432 tsx scripts/provision-shards.ts
 *
 * Business shards and the catalog get a copy of the reference data (DB-015), subscribed to the
 * directory as the database servers reach it: BUKU_REFERENCE_SOURCE ("host=… port=… dbname=…";
 * default the directory on localhost:5432, i.e. one server).
 *
 * On the host (`pnpm db:shards`) everything comes from the repo-root .env.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createDatabaseClient } from '../src/index.js';
import { ensureReferenceCopy, provisionShards } from '../src/provision.js';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (!process.env.DATABASE_DIRECTORY_MIGRATION_URL && existsSync(rootEnv))
  loadEnv({ path: rootEnv, quiet: true });

const required = (name: string) => {
  const value = process.env[name];
  if (!value) {
    console.error(`provision-shards: ${name} is not set (run pnpm bootstrap)`);
    process.exit(1);
  }
  return value;
};
const migratorPassword = required('BUKU_MIGRATOR_PASSWORD');
const directoryUrl =
  process.env.DATABASE_DIRECTORY_MIGRATION_URL ??
  `postgresql://buku_migrator:${encodeURIComponent(migratorPassword)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku_directory`;

// The directory as the database servers reach it (on one server in development: localhost).
const directoryHost = new URL(directoryUrl);
const adminUser = process.env.POSTGRES_ADMIN_USER ?? 'buku_admin';
const adminPassword = required('POSTGRES_SUPERUSER_PASSWORD');
const asAdmin = (database: string) => {
  const url = new URL(directoryUrl);
  url.username = encodeURIComponent(adminUser);
  url.password = encodeURIComponent(adminPassword);
  url.pathname = `/${database}`;
  return url.toString();
};
const reference = {
  conninfo:
    process.env.BUKU_REFERENCE_SOURCE ??
    `host=localhost port=5432 dbname=${decodeURIComponent(directoryHost.pathname.slice(1))}`,
  replicator: { user: 'buku_replicator', password: required('BUKU_REPLICATOR_PASSWORD') },
  publisherUrl: asAdmin(decodeURIComponent(directoryHost.pathname.slice(1))),
};

const shards = await provisionShards({
  directoryUrl,
  admin: { user: adminUser, password: adminPassword },
  migrator: { user: 'buku_migrator', password: migratorPassword },
  reference,
  log: (line) => console.log(`provision-shards: ${line}`),
});

// The catalog keeps a copy too (DB-041); on the directory's server unless said otherwise.
const catalog = createDatabaseClient({
  url: process.env.DATABASE_CATALOG_ADMIN_URL ?? asAdmin('buku_catalog'),
  applicationName: 'provision-shards',
  maxConnections: 1,
});
try {
  await ensureReferenceCopy(catalog, 'buku_catalog', reference);
} finally {
  await catalog.$disconnect();
}
console.log(
  `provision-shards: ${shards.length} shard databases ready; reference data copied to them and the catalog`,
);
