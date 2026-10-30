import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createDirectoryClient } from './directory.js';
import { createDatabaseClient, type Database } from './index.js';
import { clusterUrl, type Credentials } from './shards.js';

/**
 * Makes every shard in the registry a real, up-to-date database (docs/DATABASE.md DB-012,
 * DB-023): creates it on its cluster if missing, takes away the template's default grants,
 * applies its family's migrations, schedules its partition upkeep, and, for families that keep a
 * copy of the reference data, subscribes it to the directory's publication (DB-015). Ready shards
 * too, so the next one is waiting before the current one fills. Idempotent: run it after adding
 * shards and after every release. Families without a schema here are skipped.
 */

/** Each shard family that has a schema: its Prisma config, and whether it copies reference data. */
export const SHARD_FAMILIES: Readonly<Record<string, { config: string; referenceCopy: boolean }>> = {
  user: { config: 'prisma.user.config.ts', referenceCopy: false },
  business: { config: 'prisma.business.config.ts', referenceCopy: true },
};

/** Where reference data is copied from (the directory's `buku_reference` publication, DB-015). */
export interface ReferenceSource {
  /**
   * The directory as the database SERVERS reach it, as libpq parameters without credentials:
   * "host=… port=… dbname=buku_directory sslmode=verify-full sslrootcert=…" (DB-020: TLS, the
   * server's certificate checked); on one server in development, localReferenceSource().
   */
  conninfo: string;
  /** The role the copies sign in as (LOGIN REPLICATION, reads the published tables). */
  replicator: Credentials;
  /** The administrator on the directory database: makes and drops replication slots. */
  publisherUrl: string;
}

export interface ProvisionOptions {
  /** A role that can read the registry (any service role, or the migrator). */
  directoryUrl: string;
  /** The administrator on every cluster: creates databases and schedules jobs. */
  admin: Credentials;
  /** The schema owner: runs migrations. */
  migrator: Credentials;
  /** Where clusters' addresses are read from (their `dsn_secret` names). */
  env?: NodeJS.ProcessEnv;
  /** Only these families (default: every family with a schema). */
  families?: string[];
  /** Subscribe reference copies to it; without it, copies are left as they are. */
  reference?: ReferenceSource;
  log?: (line: string) => void;
}

export interface ProvisionedShard {
  entity: string;
  region: number;
  shardNo: number;
  databaseName: string;
  created: boolean;
}

const PACKAGE_DIR = resolve(import.meta.dirname, '..');
/** Database names come from the registry, whose CHECK allows only these; checked again here. */
const SAFE_NAME = /^[a-z][a-z0-9_]{0,62}$/;
/** Values that end up inside SQL text (a subscription's connection) are held to this. */
const SAFE_CONNINFO = /^[A-Za-z0-9_.=/ -]+$/;

/**
 * The directory as a development server reaches it: itself, on localhost, over TLS and checking its
 * own certificate against the authority the BUKU image installs (docker/postgres/tls; DB-020).
 */
export function localReferenceSource(database: string): string {
  return `host=localhost port=5432 dbname=${database} sslmode=verify-full sslrootcert=/var/lib/postgresql/tls/ca.crt`;
}
const SAFE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;

const admin = (url: string) =>
  createDatabaseClient({ url, applicationName: 'provision-shards', maxConnections: 1 });

export async function provisionShards(options: ProvisionOptions): Promise<ProvisionedShard[]> {
  const env = options.env ?? process.env;
  const log = options.log ?? (() => undefined);
  const families = (options.families ?? Object.keys(SHARD_FAMILIES)).filter((f) => f in SHARD_FAMILIES);

  const directory = createDirectoryClient({ url: options.directoryUrl, applicationName: 'provision-shards' });
  const shards = await directory.shard
    .findMany({
      where: { entity: { in: families }, status: { not: 'retired' } },
      include: { cluster: { select: { dsnSecret: true } } },
      orderBy: [{ entity: 'asc' }, { region: 'asc' }, { shardNo: 'asc' }],
    })
    .finally(() => directory.$disconnect());

  const done: ProvisionedShard[] = [];
  for (const shard of shards) {
    const name = shard.databaseName;
    if (!SAFE_NAME.test(name)) throw new Error(`refusing database name ${JSON.stringify(name)}`);
    const secret = shard.cluster.dsnSecret;
    const family = SHARD_FAMILIES[shard.entity]!;

    // 1. The database, on its cluster (from template1: extensions, pg_partman).
    const server = admin(clusterUrl(secret, 'postgres', options.admin, env));
    let created = false;
    try {
      const found = await server.$queryRaw<
        { n: number }[]
      >`SELECT 1 AS n FROM pg_database WHERE datname = ${name}`;
      if (found.length === 0) {
        await server.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER buku_migrator TEMPLATE template1`);
        created = true;
      }
      await server.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${name}" FROM PUBLIC`);
      await server.$executeRawUnsafe(
        `GRANT CONNECT, TEMPORARY ON DATABASE "${name}" TO buku_migrator, buku_app`,
      );
      // Which shard this is, for anyone connected to it (a guard against writing to the wrong one).
      await server.$executeRawUnsafe(
        `ALTER DATABASE "${name}" SET buku.shard = '${shard.entity}:${shard.region}:${shard.shardNo}'`,
      );
    } finally {
      await server.$disconnect();
    }

    // 2. Nothing granted by default (DB-023): template1's defaults would give the app role every
    //    table and partition the migrator makes. Migrations and apply-access grant exactly.
    const db = admin(clusterUrl(secret, name, options.admin, env));
    try {
      for (const what of ['TABLES', 'SEQUENCES', 'FUNCTIONS'])
        await db.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator REVOKE ALL ON ${what} FROM buku_app`,
        );
    } finally {
      await db.$disconnect();
    }

    // 3. Its family's migrations, as the schema owner.
    migrate(
      family.config,
      'DATABASE_SHARD_MIGRATION_URL',
      clusterUrl(secret, name, options.migrator, env),
      name,
    );

    // 4. Partitions made ahead and dropped behind, hourly, as the tables' owner (DB-006).
    const cron = admin(clusterUrl(secret, 'postgres', options.admin, env));
    try {
      await cron.$queryRaw`SELECT cron.schedule_in_database(${`partman:${name}`}, '7 * * * *',
        'CALL partman.run_maintenance_proc()', ${name}, 'buku_migrator', true)`;
    } finally {
      await cron.$disconnect();
    }

    // 5. Its copy of the reference data, kept by logical replication (DB-015).
    if (family.referenceCopy && options.reference) {
      const copy = admin(clusterUrl(secret, name, options.admin, env));
      try {
        await ensureReferenceCopy(copy, name, options.reference);
      } finally {
        await copy.$disconnect();
      }
    }

    log(
      `${created ? 'created' : 'up to date'}: ${shard.entity} shard ${shard.region}/${shard.shardNo} (${name})`,
    );
    done.push({
      entity: shard.entity,
      region: shard.region,
      shardNo: shard.shardNo,
      databaseName: name,
      created,
    });
  }
  return done;
}

/** Apply a schema's migrations to one database, reporting Prisma's own error if one fails. */
export function migrate(config: string, urlVariable: string, url: string, name: string): void {
  try {
    execFileSync(
      resolve(PACKAGE_DIR, 'node_modules/.bin/prisma'),
      ['migrate', 'deploy', '--config', config],
      {
        cwd: PACKAGE_DIR,
        env: { ...process.env, [urlVariable]: url },
        stdio: 'pipe',
        encoding: 'utf8',
      },
    );
  } catch (err) {
    // Prisma's own words (which migration, which statement), not a buffer of bytes.
    const { stdout = '', stderr = '' } = err as { stdout?: string; stderr?: string };
    throw new Error(`migrating ${name} failed:\n${stdout}${stderr}`, { cause: err });
  }
}

/** The replication slot (on the directory) and subscription (on the copy) of one database. */
export function referenceSlot(database: string): string {
  const slot = `ref_${database}`;
  if (!/^[a-z0-9_]{1,63}$/.test(slot)) throw new Error(`no replication slot name for ${database}`);
  return slot;
}

/**
 * Subscribe one database's `reference` copy to the directory's publication, or bring an existing
 * subscription up to date: its connection (a rotated password) and its tables (a reference table
 * added since). The slot is made on the directory first, then the subscription without making
 * one: that also works when both databases are on one server, where letting CREATE SUBSCRIPTION
 * make the slot would wait on itself.
 *
 * @param copy the administrator, connected to the database that keeps the copy
 */
export async function ensureReferenceCopy(
  copy: Database,
  database: string,
  source: ReferenceSource,
): Promise<void> {
  if (!SAFE_CONNINFO.test(source.conninfo) || !SAFE_NAME.test(source.replicator.user)) {
    throw new Error('the reference source has characters it must not');
  }
  if (!SAFE_SECRET.test(source.replicator.password)) {
    throw new Error('the replicator password must be 16-128 letters, digits, _ or -');
  }
  const slot = referenceSlot(database);
  const connection = `${source.conninfo} user=${source.replicator.user} password=${source.replicator.password}`;
  const existing = await copy.$queryRaw<{ n: number }[]>`
    SELECT 1 AS n FROM pg_subscription
    WHERE subname = ${slot} AND subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  if (existing.length > 0) {
    await copy.$executeRawUnsafe(`ALTER SUBSCRIPTION "${slot}" CONNECTION '${connection}'`);
    await copy.$executeRawUnsafe(`ALTER SUBSCRIPTION "${slot}" REFRESH PUBLICATION`);
    return;
  }
  const publisher = admin(source.publisherUrl);
  try {
    const slots = await publisher.$queryRaw<{ active: boolean }[]>`
      SELECT active FROM pg_replication_slots WHERE slot_name = ${slot}`;
    if (slots[0]?.active) throw new Error(`replication slot ${slot} is in use by another copy`);
    // A slot left by an earlier copy of this database (dropped without its subscription).
    if (slots.length > 0) await publisher.$executeRaw`SELECT pg_drop_replication_slot(${slot})`;
    await publisher.$queryRaw`SELECT slot_name::text FROM pg_create_logical_replication_slot(${slot}, 'pgoutput')`;
  } finally {
    await publisher.$disconnect();
  }
  await copy.$executeRawUnsafe(
    `CREATE SUBSCRIPTION "${slot}" CONNECTION '${connection}' PUBLICATION "buku_reference"
     WITH (create_slot = false, slot_name = '${slot}', copy_data = true)`,
  );
}

/**
 * Wait until a new reference copy has copied every table (each table's first copy runs on its own;
 * after that, changes stream in). Throws if it isn't done in time.
 *
 * @param copy the administrator, connected to the database that keeps the copy
 */
export async function waitForReferenceCopy(
  copy: Database,
  database: string,
  timeoutMs = 30_000,
): Promise<void> {
  const slot = referenceSlot(database);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await copy.$queryRaw<{ tables: bigint; ready: bigint }[]>`
      SELECT count(*) AS tables, count(*) FILTER (WHERE r.srsubstate IN ('r', 's')) AS ready
      FROM pg_subscription s JOIN pg_subscription_rel r ON r.srsubid = s.oid
      WHERE s.subname = ${slot} AND s.subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    const { tables, ready } = rows[0]!;
    if (tables > 0n && ready === tables) return;
    if (Date.now() > deadline)
      throw new Error(`the reference copy of ${database} isn't ready: ${ready} of ${tables} tables`);
    await sleep(200);
  }
}

/**
 * Stop one database's reference copy: its subscription (in that database), then its slot on the
 * directory. A slot nobody reads keeps every WAL file from then on, until the disk fills.
 *
 * @param copy the administrator, connected to the database that keeps the copy
 * @param publisherUrl the administrator on the directory
 */
export async function dropReferenceCopy(
  copy: Database,
  database: string,
  publisherUrl: string,
): Promise<void> {
  const subs = await copy.$queryRaw<{ name: string }[]>`
    SELECT subname::text AS name FROM pg_subscription
    WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())`;
  for (const { name } of subs) {
    await copy.$executeRawUnsafe(`ALTER SUBSCRIPTION "${name}" DISABLE`);
    await copy.$executeRawUnsafe(`ALTER SUBSCRIPTION "${name}" SET (slot_name = NONE)`);
    await copy.$executeRawUnsafe(`DROP SUBSCRIPTION "${name}"`);
  }
  const publisher = admin(publisherUrl);
  try {
    const slot = referenceSlot(database);
    // A disabled subscription's sender takes a moment to let go of the slot.
    for (let i = 0; i < 100; i++) {
      const rows = await publisher.$queryRaw<{ active: boolean }[]>`
        SELECT active FROM pg_replication_slots WHERE slot_name = ${slot}`;
      if (rows.length === 0) return;
      if (!rows[0]!.active) {
        await publisher.$executeRaw`SELECT pg_drop_replication_slot(${slot})`;
        return;
      }
      await sleep(100);
    }
    throw new Error(`replication slot ${slot} is still in use`);
  } finally {
    await publisher.$disconnect();
  }
}

/**
 * Drop a database the safe way: its reference copy first (subscription and slot, see above), its
 * partition upkeep job, and only then the database.
 *
 * @param serverUrl the administrator on the database's server (any database; `postgres` is used)
 * @param publisherUrl the administrator on the directory, when the database may keep a copy
 */
export async function dropDatabase(options: { serverUrl: string; database: string; publisherUrl?: string }) {
  const { database } = options;
  if (!SAFE_NAME.test(database)) throw new Error(`refusing database name ${JSON.stringify(database)}`);
  const at = (name: string) => {
    const url = new URL(options.serverUrl);
    url.pathname = `/${name}`;
    return admin(url.toString());
  };
  const server = at('postgres');
  try {
    const exists = await server.$queryRaw<
      { n: number }[]
    >`SELECT 1 AS n FROM pg_database WHERE datname = ${database}`;
    if (exists.length > 0 && options.publisherUrl) {
      const db = at(database);
      try {
        await dropReferenceCopy(db, database, options.publisherUrl);
      } finally {
        await db.$disconnect();
      }
    }
    await server.$executeRaw`SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = ${`partman:${database}`}`;
    await server.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  } finally {
    await server.$disconnect();
  }
}
