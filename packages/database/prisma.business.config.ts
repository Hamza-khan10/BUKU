import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

/**
 * Prisma CLI configuration for the BUSINESS shard family (docs/DATABASE.md §6, DB-010). Every business
 * shard database has this schema; scripts/provision-shards.ts migrates each one, passing its URL
 * in DATABASE_SHARD_MIGRATION_URL. Run by hand with `--config prisma.business.config.ts`; on the host
 * it then points at the first local business shard (buku_business_pk_1), as `buku_migrator`.
 */
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const migrationUrl =
  process.env.DATABASE_SHARD_MIGRATION_URL ??
  (process.env.BUKU_MIGRATOR_PASSWORD
    ? `postgresql://buku_migrator:${encodeURIComponent(process.env.BUKU_MIGRATOR_PASSWORD)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku_business_pk_1`
    : undefined);

export default defineConfig({
  schema: 'prisma/business/schema.prisma',
  migrations: { path: 'prisma/business/migrations' },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
