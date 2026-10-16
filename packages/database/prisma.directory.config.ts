import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration for the DIRECTORY database (docs/DATABASE.md §6): the shard registry and
 * ID generator leases, one per deployment. Run with `--config prisma.directory.config.ts`.
 *
 * Like the main config: the CLI connects as `buku_migrator`; inside Docker DATABASE_DIRECTORY_MIGRATION_URL
 * is set by compose, on the host it is assembled from the repo-root .env.
 */
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const migrationUrl =
  process.env.DATABASE_DIRECTORY_MIGRATION_URL ??
  (process.env.BUKU_MIGRATOR_PASSWORD
    ? `postgresql://buku_migrator:${encodeURIComponent(process.env.BUKU_MIGRATOR_PASSWORD)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku_directory`
    : undefined);

export default defineConfig({
  schema: 'prisma/directory/schema.prisma',
  migrations: { path: 'prisma/directory/migrations' },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
