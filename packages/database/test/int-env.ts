/**
 * Connection settings for integration tests. They run against the dev stack
 * (`pnpm dev`) but in the separate `buku_test` database, so they can never
 * touch development data. Tests connect as `buku_app` — the same least-
 * privilege role the services use — so privilege mistakes show up in tests.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';

const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} missing — run \`pnpm bootstrap\` and \`pnpm dev\` first`);
  return value;
}

const host = process.env.TEST_DB_HOST ?? 'localhost';
const port = process.env.POSTGRES_HOST_PORT ?? '5432';

export const testEnv = {
  appUrl: `postgresql://buku_app:${encodeURIComponent(required('BUKU_APP_PASSWORD'))}@${host}:${port}/buku_test`,
  migratorUrl: `postgresql://buku_migrator:${encodeURIComponent(required('BUKU_MIGRATOR_PASSWORD'))}@${host}:${port}/buku_test`,
  kafkaBrokers: process.env.TEST_KAFKA_BROKERS ?? 'localhost:9092',
};
