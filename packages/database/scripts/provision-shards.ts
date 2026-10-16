/**
 * Makes every shard in the registry a real, up-to-date database (src/provision.ts): create it,
 * migrate it, schedule its partition upkeep. Idempotent; after adding shards and after every
 * release. Runs with the cluster administrator's and the migrator's credentials:
 *
 *   DATABASE_DIRECTORY_MIGRATION_URL=… POSTGRES_SUPERUSER_PASSWORD=… BUKU_MIGRATOR_PASSWORD=… \
 *   BUKU_DB_CLUSTER_LOCAL_1=postgresql://host:5432 tsx scripts/provision-shards.ts
 *
 * On the host (`pnpm db:shards`) everything comes from the repo-root .env.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { provisionShards } from '../src/provision.js';

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

const shards = await provisionShards({
  directoryUrl,
  admin: {
    user: process.env.POSTGRES_ADMIN_USER ?? 'buku_admin',
    password: required('POSTGRES_SUPERUSER_PASSWORD'),
  },
  migrator: { user: 'buku_migrator', password: migratorPassword },
  log: (line) => console.log(`provision-shards: ${line}`),
});
console.log(`provision-shards: ${shards.length} shard databases ready`);
