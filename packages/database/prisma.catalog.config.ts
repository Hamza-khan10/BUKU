import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration for the CATALOG database (docs/DATABASE.md DB-041): what search and
 * discovery read. Run with `--config prisma.catalog.config.ts`. Like the main config: the CLI
 * connects as `buku_migrator`; inside Docker DATABASE_CATALOG_MIGRATION_URL is set by compose, on
 * the host it is assembled from the repo-root .env.
 */
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const migrationUrl =
  process.env.DATABASE_CATALOG_MIGRATION_URL ??
  (process.env.BUKU_MIGRATOR_PASSWORD
    ? `postgresql://buku_migrator:${encodeURIComponent(process.env.BUKU_MIGRATOR_PASSWORD)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku_catalog`
    : undefined);

export default defineConfig({
  schema: 'prisma/catalog/schema.prisma',
  migrations: { path: 'prisma/catalog/migrations' },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
