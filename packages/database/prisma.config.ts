import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration (generate / migrate / studio).
 *
 * The CLI connects as `buku_migrator` (owns the schema, may run DDL).
 * Services connect as `buku_app` (data only) via DATABASE_URL at runtime.
 *
 * Inside Docker, DATABASE_MIGRATION_URL is provided by docker-compose.
 * On the host, it is assembled from the repo-root .env so that
 * `pnpm db:migrate:dev` just works against the dev stack on localhost.
 */
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const migrationUrl =
  process.env.DATABASE_MIGRATION_URL ??
  (process.env.BUKU_MIGRATOR_PASSWORD
    ? `postgresql://buku_migrator:${encodeURIComponent(process.env.BUKU_MIGRATOR_PASSWORD)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku`
    : undefined);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
