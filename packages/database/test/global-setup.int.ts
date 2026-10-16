/**
 * Vitest global setup for the integration project: rebuilds the `buku_test`
 * schema from scratch and applies every migration, exactly as a production
 * deploy would (`prisma migrate deploy`); the same for the directory's test
 * twin, `buku_directory_test` (created by `pnpm db:prepare`).
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createDatabaseClient } from '../src/index.js';
import { testEnv } from './int-env.js';

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

  const packageDir = resolve(import.meta.dirname, '..');
  execFileSync(resolve(packageDir, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], {
    cwd: packageDir,
    env: { ...process.env, DATABASE_MIGRATION_URL: testEnv.migratorUrl },
    stdio: 'pipe',
  });

  const directory = createDatabaseClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'test-setup',
    maxConnections: 1,
  });
  try {
    await directory.$executeRawUnsafe('DROP SCHEMA IF EXISTS registry, ids, lookup CASCADE');
    await directory.$executeRawUnsafe('DROP TABLE IF EXISTS public._prisma_migrations');
  } finally {
    await directory.$disconnect();
  }
  execFileSync(
    resolve(packageDir, 'node_modules/.bin/prisma'),
    ['migrate', 'deploy', '--config', 'prisma.directory.config.ts'],
    {
      cwd: packageDir,
      env: { ...process.env, DATABASE_DIRECTORY_MIGRATION_URL: testEnv.directoryMigratorUrl },
      stdio: 'pipe',
    },
  );
}
