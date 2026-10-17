import {
  BUSINESS_SHARD_ACCESS,
  CATALOG_ACCESS,
  USER_SHARD_ACCESS,
  type Access,
  type ServiceName,
} from './access.js';
import {
  accessStatements,
  crossBusinessRoleStatements,
  databaseAccessStatements,
  directoryAccessStatements,
} from './access-sql.js';
import { createDirectoryClient } from './directory.js';
import { createDatabaseClient } from './index.js';
import { clusterUrl, type Credentials } from './shards.js';

/**
 * Makes every service's database rights exactly what src/access.ts says, everywhere (D-092,
 * DB-020): the v1 database (and the roles themselves, with their passwords), the cross-business
 * roles, the directory, the catalog, and every shard in the registry. Idempotent; run as an
 * administrator after migrations and after provisioning new shards.
 */

/** Each shard family's map, the schemas its databases have tables in, and whether it has RLS by business. */
export const SHARD_ACCESS: Readonly<
  Record<
    string,
    { map: Readonly<Record<ServiceName, Access>>; schemas: readonly string[]; crossBusiness: boolean }
  >
> = {
  user: { map: USER_SHARD_ACCESS, schemas: ['public'], crossBusiness: false },
  business: { map: BUSINESS_SHARD_ACCESS, schemas: ['public', 'reference', 'ai'], crossBusiness: true },
};

export interface AccessOptions {
  /** The administrator on the v1 database (the roles are made from there). */
  mainUrl: string;
  /** The administrator on the directory. */
  directoryUrl?: string;
  /** The administrator on the catalog. */
  catalogUrl?: string;
  /** Every shard in the registry, reached as this administrator (clusters' addresses from `env`). */
  shards?: { admin: Credentials; env?: NodeJS.ProcessEnv };
  passwords: Partial<Record<ServiceName, string>>;
  log?: (line: string) => void;
}

const databaseOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

/** Run statements in one transaction, as the administrator connected to `url`. */
export async function applyStatements(url: string, statements: string[]): Promise<void> {
  const db = createDatabaseClient({ url, applicationName: 'apply-access', maxConnections: 1 });
  try {
    await db.$transaction(async (tx) => {
      for (const sql of statements) await tx.$executeRawUnsafe(sql);
    });
  } finally {
    await db.$disconnect();
  }
}

/** One shard database's rights (its family's map). */
export async function applyShardAccess(
  url: string,
  family: string,
  passwords: Partial<Record<ServiceName, string>>,
): Promise<void> {
  const f = SHARD_ACCESS[family];
  if (!f) throw new Error(`no access map for ${family} shards`);
  await applyStatements(
    url,
    databaseAccessStatements(databaseOf(url), f.map, passwords, {
      schemas: f.schemas,
      crossBusiness: f.crossBusiness,
    }),
  );
}

export async function applyAccess(options: AccessOptions): Promise<void> {
  const log = options.log ?? (() => undefined);
  const { passwords } = options;
  const services = Object.keys(passwords).join(', ');

  await applyStatements(options.mainUrl, [
    ...accessStatements(databaseOf(options.mainUrl), passwords),
    ...crossBusinessRoleStatements(passwords),
  ]);
  log(`service roles on "${databaseOf(options.mainUrl)}", and their cross-business roles: ${services}`);

  if (options.directoryUrl) {
    await applyStatements(
      options.directoryUrl,
      directoryAccessStatements(databaseOf(options.directoryUrl), passwords),
    );
    log(`the same roles on "${databaseOf(options.directoryUrl)}"`);
  }
  if (options.catalogUrl) {
    await applyStatements(
      options.catalogUrl,
      databaseAccessStatements(databaseOf(options.catalogUrl), CATALOG_ACCESS, passwords, {
        schemas: ['catalog', 'reference'],
      }),
    );
    log(`the same roles on "${databaseOf(options.catalogUrl)}"`);
  }
  if (options.shards && options.directoryUrl) {
    const directory = createDirectoryClient({ url: options.directoryUrl, applicationName: 'apply-access' });
    const shards = await directory.shard
      .findMany({
        where: { entity: { in: Object.keys(SHARD_ACCESS) }, status: { not: 'retired' } },
        include: { cluster: { select: { dsnSecret: true } } },
        orderBy: [{ entity: 'asc' }, { region: 'asc' }, { shardNo: 'asc' }],
      })
      .finally(() => directory.$disconnect());
    for (const s of shards) {
      const url = clusterUrl(s.cluster.dsnSecret, s.databaseName, options.shards.admin, options.shards.env);
      await applyShardAccess(url, s.entity, passwords);
    }
    log(`the same roles on ${shards.length} shard databases`);
  }
}
