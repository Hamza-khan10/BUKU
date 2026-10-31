/**
 * Connection settings for integration tests. They run against the dev stack (`pnpm dev`) but in
 * databases of their own — the test twins of the directory and the catalog, `buku_test_*` shards
 * and the services' world (services-world.ts) — so they can never touch development data. Tests
 * connect as `buku_app` or as a service's own role, so privilege mistakes show up in tests.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { localReferenceSource } from '../src/provision.js';

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
  // The test cluster's address (host and port only) and the roles that build shard databases on it.
  cluster: `postgresql://${host}:${port}`,
  admin: { user: 'buku_admin', password: required('POSTGRES_SUPERUSER_PASSWORD') },
  migrator: { user: 'buku_migrator', password: required('BUKU_MIGRATOR_PASSWORD') },
  app: { user: 'buku_app', password: required('BUKU_APP_PASSWORD') },
  replicator: { user: 'buku_replicator', password: required('BUKU_REPLICATOR_PASSWORD') },
  /** Each service's own database password (D-092), as `pnpm bootstrap` made them. */
  servicePasswords: Object.fromEntries(
    ['auth', 'booking', 'queue', 'notification', 'business', 'billing', 'search', 'ads', 'analytics'].map(
      (s) => [s, required(`BUKU_DB_PASSWORD_${s.toUpperCase()}`)],
    ),
  ),
  /** The administrator on one database of the test cluster. */
  adminUrl: (database: string) =>
    `postgresql://buku_admin:${encodeURIComponent(required('POSTGRES_SUPERUSER_PASSWORD'))}@${host}:${port}/${database}`,
  /**
   * The test directory as the database server reaches it (reference data is copied from it,
   * DB-015): itself, so localhost on the server's own port, over TLS (DB-020).
   */
  referenceSource: localReferenceSource('buku_directory_test'),
  // The catalog's test twin (DB-041).
  catalogAppUrl: `postgresql://buku_app:${encodeURIComponent(required('BUKU_APP_PASSWORD'))}@${host}:${port}/buku_catalog_test`,
  catalogMigratorUrl: `postgresql://buku_migrator:${encodeURIComponent(required('BUKU_MIGRATOR_PASSWORD'))}@${host}:${port}/buku_catalog_test`,
  // The directory database's test twin (shard registry, ID generator leases; docs/DATABASE.md §6).
  directoryAppUrl: `postgresql://buku_app:${encodeURIComponent(required('BUKU_APP_PASSWORD'))}@${host}:${port}/buku_directory_test`,
  directoryMigratorUrl: `postgresql://buku_migrator:${encodeURIComponent(required('BUKU_MIGRATOR_PASSWORD'))}@${host}:${port}/buku_directory_test`,
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
