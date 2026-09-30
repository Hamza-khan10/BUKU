import { logger } from '@buku/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

import { softDeleteUsers } from './soft-delete.js';

export * from './generated/prisma/client.js';
export { softDeleteUsers };
export { recordAudit, type AuditEntry } from './audit.js';
export { businessRoleOf, requireBusinessPermission } from './authz.js';

/**
 * Shared database client factory.
 *
 * Services connect as `buku_app` (data-only role). The pool is per process:
 * size it so that (replicas × pool size) stays well under Postgres
 * max_connections; put PgBouncer in front before scaling out further.
 */
export interface CreateDatabaseOptions {
  url: string;
  /** Pool size per process. Default 10. */
  maxConnections?: number;
  /** Shows up in pg_stat_activity: invaluable when debugging connection leaks. */
  applicationName: string;
  /** Log every query at debug level (development only). */
  logQueries?: boolean;
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
      ...(options.logQueries ? [{ level: 'query' as const, emit: 'event' as const }] : []),
    ],
  });
  client.$on('warn', (e) => log.warn({ target: e.target }, e.message));
  client.$on('error', (e) => log.error({ target: e.target }, e.message));
  if (options.logQueries) {
    // Log the SQL shape and timing only — never bound parameter values (PII).
    client.$on('query', (e) => log.debug({ durationMs: e.duration }, e.query));
  }

  return client.$extends(softDeleteUsers);
}

export type Database = ReturnType<typeof createDatabaseClient>;
/** The client inside `db.$transaction(async (tx) => ...)`. */
export type Transaction = Parameters<Parameters<Database['$transaction']>[0]>[0];

/** Readiness probe. */
export async function pingDatabase(db: Database): Promise<void> {
  await db.$queryRaw`SELECT 1`;
}

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
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return true;
  return sqlStateOf(err) === SQLSTATE.UNIQUE_VIOLATION;
}

/** An EXCLUDE constraint fired — e.g. a staff member would be double-booked. */
export function isExclusionViolation(err: unknown): boolean {
  return sqlStateOf(err) === SQLSTATE.EXCLUSION_VIOLATION;
}

export function isForeignKeyViolation(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') return true;
  return sqlStateOf(err) === SQLSTATE.FOREIGN_KEY_VIOLATION;
}

/** Transient concurrency failures that are safe to retry the whole transaction for. */
export function isRetryableTransactionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  const state = sqlStateOf(err);
  return state === SQLSTATE.SERIALIZATION_FAILURE || state === SQLSTATE.DEADLOCK;
}

/**
 * Creates the monthly partitions of the partitioned tables (audit_logs,
 * notifications, ad_events) for the next `monthsAhead` months. Idempotent.
 * Run on a schedule (monthly) — the migration pre-creates 12 months.
 */
export async function ensurePartitions(db: Database, monthsAhead = 3): Promise<void> {
  await db.$executeRaw`SELECT ensure_monthly_partitions(${monthsAhead}::int)`;
}
