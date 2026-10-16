/**
 * Development seed for the DIRECTORY database (docs/DATABASE.md §6): one region (Pakistan), the one
 * local cluster, the two shard families, and two 'ready' shards for each, so the first person or
 * business placed opens shard 1 and the next one is already waiting when it fills.
 *
 * Idempotent, and it never overwrites: anything changed since (a limit, who may place a family)
 * stays changed. Refuses to run in production, where the registry is set up by operators (DB-013).
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { createDirectoryClient } from '../../src/directory.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production directory.');
  process.exit(1);
}

const rootEnv = resolve(import.meta.dirname, '../../../../.env');
if (!process.env.DATABASE_DIRECTORY_MIGRATION_URL && existsSync(rootEnv))
  loadEnv({ path: rootEnv, quiet: true });
const password = process.env.BUKU_MIGRATOR_PASSWORD;
const url =
  process.env.DATABASE_DIRECTORY_MIGRATION_URL ??
  (password
    ? `postgresql://buku_migrator:${encodeURIComponent(password)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/buku_directory`
    : undefined);
if (!url) throw new Error('DATABASE_DIRECTORY_MIGRATION_URL or BUKU_MIGRATOR_PASSWORD is required');

/** Ready shards kept waiting per family and region (operators add more as they fill). */
const READY = 2;
const REGION = 0;

const db = createDirectoryClient({ url, applicationName: 'directory-seed', maxConnections: 1 });
try {
  await db.$transaction(async (tx) => {
    // Who made these changes, in the registry's change log.
    await tx.$executeRaw`SELECT set_config('buku.actor', 'directory seed', true)`;
    await tx.region.createMany({
      data: [{ region: REGION, code: 'pk', name: 'Pakistan' }],
      skipDuplicates: true,
    });
    // In development every shard database sits on the one local server, whose address (host and
    // port only) is in BUKU_DB_CLUSTER_LOCAL_1; in production each cluster has its own setting.
    await tx.cluster.createMany({
      data: [{ clusterId: 1, region: REGION, name: 'local-1', dsnSecret: 'BUKU_DB_CLUSTER_LOCAL_1' }],
      skipDuplicates: true,
    });
    // Directories seeded before D2 named the services' URL instead.
    await tx.cluster.updateMany({
      where: { clusterId: 1, dsnSecret: 'DATABASE_URL' },
      data: { dsnSecret: 'BUKU_DB_CLUSTER_LOCAL_1' },
    });
    await tx.region.updateMany({
      where: { region: REGION, defaultClusterId: null },
      data: { defaultClusterId: 1 },
    });
    await tx.entity.createMany({
      data: [
        {
          entity: 'user',
          description: 'People (customers, owners, staff) and everything that is theirs',
          defaultRowLimit: 10_000_000n,
          databasePattern: 'buku_{entity}_{region}_{shard}',
          placedBy: ['buku_svc_auth', 'buku_app'],
        },
        {
          entity: 'business',
          description: 'Businesses and everything that is theirs (services, staff, schedules, bookings)',
          defaultRowLimit: 1_000_000n,
          databasePattern: 'buku_{entity}_{region}_{shard}',
          placedBy: ['buku_svc_business', 'buku_app'],
        },
      ],
      skipDuplicates: true,
    });
    // Local tools and tests sign in as buku_app: let it write handles too (DB-018).
    await tx.$executeRaw`UPDATE lookup.handle_kinds SET writers = array_append(writers, 'buku_app')
      WHERE NOT ('buku_app' = ANY (writers))`;
    for (const entity of ['user', 'business']) {
      const ready = await tx.shard.count({ where: { entity, region: REGION, status: 'ready' } });
      for (let i = ready; i < READY; i++) {
        await tx.$queryRaw`SELECT shard_no FROM registry.add_shard(${entity}, ${REGION}::smallint)`;
      }
    }
  });
  const shards = await db.shard.groupBy({
    by: ['entity', 'status'],
    _count: true,
    orderBy: { entity: 'asc' },
  });
  console.log(
    `directory seed: ${shards.map((s) => `${s.entity} ${s.status} ×${s._count}`).join(', ') || 'no shards'}`,
  );
} finally {
  await db.$disconnect();
}
