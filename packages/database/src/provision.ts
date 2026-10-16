import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createDirectoryClient } from './directory.js';
import { createDatabaseClient } from './index.js';
import { clusterUrl, type Credentials } from './shards.js';

/**
 * Makes every shard in the registry a real, up-to-date database (docs/DATABASE.md DB-012,
 * DB-023): creates it on its cluster if missing, takes away the template's default grants,
 * applies its family's migrations, and schedules its partition upkeep. Ready shards too, so the
 * next one is waiting before the current one fills. Idempotent: run it after adding shards and
 * after every release. Families without a schema here (none yet for 'business') are skipped.
 */

/** The Prisma config of each shard family that has a schema. */
export const SHARD_FAMILIES: Readonly<Record<string, string>> = {
  user: 'prisma.user.config.ts',
};

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

    // 1. The database, on its cluster (from template1: extensions, pg_partman).
    const server = createDatabaseClient({
      url: clusterUrl(secret, 'postgres', options.admin, env),
      applicationName: 'provision-shards',
      maxConnections: 1,
    });
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
    const db = createDatabaseClient({
      url: clusterUrl(secret, name, options.admin, env),
      applicationName: 'provision-shards',
      maxConnections: 1,
    });
    try {
      for (const what of ['TABLES', 'SEQUENCES', 'FUNCTIONS'])
        await db.$executeRawUnsafe(
          `ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator REVOKE ALL ON ${what} FROM buku_app`,
        );
    } finally {
      await db.$disconnect();
    }

    // 3. Its family's migrations, as the schema owner.
    execFileSync(
      resolve(PACKAGE_DIR, 'node_modules/.bin/prisma'),
      ['migrate', 'deploy', '--config', SHARD_FAMILIES[shard.entity]!],
      {
        cwd: PACKAGE_DIR,
        env: {
          ...process.env,
          DATABASE_SHARD_MIGRATION_URL: clusterUrl(secret, name, options.migrator, env),
        },
        stdio: 'pipe',
      },
    );

    // 4. Partitions made ahead and dropped behind, hourly, as the tables' owner (DB-006).
    const cron = createDatabaseClient({
      url: clusterUrl(secret, 'postgres', options.admin, env),
      applicationName: 'provision-shards',
      maxConnections: 1,
    });
    try {
      await cron.$queryRaw`SELECT cron.schedule_in_database(${`partman:${name}`}, '7 * * * *',
        'CALL partman.run_maintenance_proc()', ${name}, 'buku_migrator', true)`;
    } finally {
      await cron.$disconnect();
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
