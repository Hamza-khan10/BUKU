import { logger } from '@buku/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/directory/client.js';

/**
 * Database v2 (docs/DATABASE.md): the directory, user and business shards, and the catalog, reached
 * through the data plane. v1's single `buku` database left the stack in D3j; nothing here reads it.
 */

export { showUpCountsOf, showUpLabelsOf, type PersonShowUpCounts } from './reliability.js';
export {
  createDirectoryClient,
  Directory,
  IdLeaseLostError,
  LeasedIdGenerator,
  ShardNotFoundError,
  ShardRouter,
  type DirectoryClient,
  type ShardInfo,
} from './directory.js';
export {
  businessRoleOfActor,
  businessRoleOnShard,
  DataPlane,
  employeeLoginKey,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  sameServer,
  type BusinessTx,
  type DataPlaneOptions,
  type ShardAuditEntry,
  type UserTx,
} from './data-plane.js';
export {
  BusinessShard,
  Catalog,
  clusterUrl,
  createBusinessShardClient,
  createCatalogClient,
  createUserShardClient,
  forAllBusinesses,
  forBusiness,
  ShardClients,
  shardUrl,
  UserShard,
  type BusinessShardClient,
  type CatalogClient,
  type Credentials,
  type UserShardClient,
} from './shards.js';

/**
 * A plain connection for administrative SQL — provisioning databases, applying rights, setting up
 * tests — on any database of the cluster (`$queryRaw`, `$executeRaw…`, `$transaction`). It has no
 * models of its own: services reach data through the data plane, never through this.
 */
export interface CreateDatabaseOptions {
  url: string;
  /** Pool size per process. Default 10. */
  maxConnections?: number;
  /** Shows up in pg_stat_activity: invaluable when debugging connection leaks. */
  applicationName: string;
}

export function createDatabaseClient(options: CreateDatabaseOptions) {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 10,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
  const log = logger.child({ module: 'database' });
  const client = new PrismaClient({
    adapter,
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  });
  client.$on('warn', (e) => log.warn({ target: e.target }, e.message));
  client.$on('error', (e) => log.error({ target: e.target }, e.message));
  return client;
}

export type Database = ReturnType<typeof createDatabaseClient>;

// ── Error classification ────────────────────────────────────────────────────
// Postgres SQLSTATE codes we handle deliberately. Everything else is a 500.

const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  EXCLUSION_VIOLATION: '23P01',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK: '40P01',
} as const;

const SQLSTATE_PATTERN = /^[0-9A-Z]{5}$/;

/** A Prisma request error with this code (P2002 …), from whichever generated client threw it. */
const isPrismaError = (err: unknown, code: string) =>
  err instanceof Error &&
  err.name === 'PrismaClientKnownRequestError' &&
  (err as { code?: unknown }).code === code;
const PRISMA_CODE_PATTERN = /^P\d{4}$/; // e.g. P2039 — also 5 chars, must not be mistaken for a SQLSTATE

interface PgErrorFields {
  code?: string;
  message?: string;
}

/**
 * Finds the underlying Postgres error. With driver adapters, Prisma wraps it as
 *   PrismaClientKnownRequestError { code: 'P2xxx', meta.driverAdapterError.cause: { originalCode, ... } }
 * so we look there first, then walk plain `cause` chains (raw `pg` errors).
 */
function pgErrorOf(err: unknown): PgErrorFields | undefined {
  const seen = new Set<unknown>();
  let current: unknown = err;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    const c = current as Record<string, unknown>;
    const adapterCause = (
      (c.meta as Record<string, unknown> | undefined)?.driverAdapterError as
        Record<string, unknown> | undefined
    )?.cause as Record<string, unknown> | undefined;
    if (typeof adapterCause?.originalCode === 'string') {
      return {
        code: adapterCause.originalCode,
        message: typeof adapterCause.originalMessage === 'string' ? adapterCause.originalMessage : undefined,
      };
    }
    if (typeof c.code === 'string' && SQLSTATE_PATTERN.test(c.code) && !PRISMA_CODE_PATTERN.test(c.code)) {
      return { code: c.code, message: typeof c.message === 'string' ? c.message : undefined };
    }
    current = c.cause;
  }
  return undefined;
}

/** The Postgres SQLSTATE behind a Prisma/driver-adapter error, if any (e.g. "23505"). */
export function sqlStateOf(err: unknown): string | undefined {
  return pgErrorOf(err)?.code;
}

/**
 * Name of the violated constraint, e.g. "appointments_no_staff_overlap".
 * Lets a service map a specific constraint to a specific API error code.
 */
export function constraintNameOf(err: unknown): string | undefined {
  return pgErrorOf(err)?.message?.match(/constraint "([^"]+)"/)?.[1];
}

export function isUniqueViolation(err: unknown): boolean {
  if (isPrismaError(err, 'P2002')) return true;
  return sqlStateOf(err) === SQLSTATE.UNIQUE_VIOLATION;
}

/** An EXCLUDE constraint fired — e.g. a staff member would be double-booked. */
export function isExclusionViolation(err: unknown): boolean {
  return sqlStateOf(err) === SQLSTATE.EXCLUSION_VIOLATION;
}

export function isForeignKeyViolation(err: unknown): boolean {
  if (isPrismaError(err, 'P2003')) return true;
  return sqlStateOf(err) === SQLSTATE.FOREIGN_KEY_VIOLATION;
}

/** Transient concurrency failures that are safe to retry the whole transaction for. */
export function isRetryableTransactionError(err: unknown): boolean {
  if (isPrismaError(err, 'P2034')) return true;
  const state = sqlStateOf(err);
  return state === SQLSTATE.SERIALIZATION_FAILURE || state === SQLSTATE.DEADLOCK;
}
