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
  // Tests sign in to Kafka as the admin (D-092): they make their own consumer groups.
  kafkaSasl: {
    mechanism: 'scram-sha-512' as const,
    username: 'buku-admin',
    password: required('KAFKA_PASSWORD_ADMIN'),
  },
  redisUrl: `redis://:${encodeURIComponent(required('VALKEY_PASSWORD'))}@${host}:${process.env.VALKEY_HOST_PORT ?? '6379'}/0`,
  piiKeyring: required('PII_ENCRYPTION_KEYS'),
  s3: {
    endpoint: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:9100',
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    documentsBucket: 'buku-documents-dev',
    mediaBucket: 'buku-media-dev',
    privateBucket: 'buku-private-dev',
  },
};
