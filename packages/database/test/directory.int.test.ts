import { IdGenerator } from '@buku/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDirectoryClient,
  IdLeaseLostError,
  LeasedIdGenerator,
  ShardNotFoundError,
  ShardRouter,
  type DirectoryClient,
} from '../src/index.js';
import { testEnv } from './int-env.js';

/**
 * The directory (docs/DATABASE.md §6, DB-011…DB-013): where every row of a shard family lives,
 * shards that fill at their limit and hand over to the next, ID generator leases, and the router
 * services use. Each test makes its own shard family, so they don't depend on one another.
 */

let app: DirectoryClient; // what services sign in as (buku_app here; buku_svc_* in the stack)
let owner: DirectoryClient; // the schema owner: operators' tools and migrations

beforeAll(async () => {
  app = createDirectoryClient({
    url: testEnv.directoryAppUrl,
    applicationName: 'directory-int-test',
    maxConnections: 12,
  });
  owner = createDirectoryClient({
    url: testEnv.directoryMigratorUrl,
    applicationName: 'directory-int-test-owner',
  });
  await owner.region.createMany({
    data: [
      { region: 0, code: 'pk', name: 'Pakistan' },
      { region: 1, code: 'eu', name: 'Europe' },
    ],
    skipDuplicates: true,
  });
  await owner.cluster.createMany({
    data: [
      { clusterId: 1, region: 0, name: 'test-pk-1', dsnSecret: 'DATABASE_URL_PK_1' },
      { clusterId: 2, region: 1, name: 'test-eu-1', dsnSecret: 'DATABASE_URL_EU_1' },
    ],
    skipDuplicates: true,
  });
  await owner.region.update({ where: { region: 0 }, data: { defaultClusterId: 1 } });
  await owner.region.update({ where: { region: 1 }, data: { defaultClusterId: 2 } });
});

afterAll(async () => {
  await app.$disconnect();
  await owner.$disconnect();
});

/** A shard family of its own for one test, with `ready` shards waiting in region 0. */
async function family(entity: string, rowLimit: number, ready = 2, placedBy = ['buku_app']) {
  await owner.entity.create({
    data: {
      entity,
      description: 'test family',
      defaultRowLimit: BigInt(rowLimit),
      databasePattern: 'test_{entity}_{region}_{shard}',
      placedBy,
    },
  });
  for (let i = 0; i < ready; i++) await addShard(entity);
}
const addShard = (entity: string, region = 0) =>
  owner.$queryRaw`SELECT shard_no FROM registry.add_shard(${entity}, ${region}::smallint)`;
async function place(entity: string, id: bigint, db: DirectoryClient = app): Promise<number> {
  const rows = await db.$queryRaw<
    { shard_no: number }[]
  >`SELECT shard_no FROM registry.place(${entity}, ${id}::bigint)`;
  return rows[0]!.shard_no;
}
const shards = (entity: string) =>
  owner.shard.findMany({ where: { entity }, orderBy: [{ region: 'asc' }, { shardNo: 'asc' }] });
const version = async () => (await owner.version.findUniqueOrThrow({ where: { id: 1 } })).version;
/** An ID made in region 1 (generator 128 is region 1's first). */
const inRegion1 = (n: bigint) => (1n << 19n) | n;

describe('placing rows in shards (DB-011)', () => {
  it('the first row opens shard 1; each shard fills at its limit and hands over to the next', async () => {
    await family('rollover', 3, 3);
    expect(await place('rollover', 10n)).toBe(1);
    expect(await place('rollover', 11n)).toBe(1);
    expect(await place('rollover', 12n)).toBe(1);
    const [s1, s2, s3] = await shards('rollover');
    expect(s1).toMatchObject({ status: 'full', minId: 1n, maxId: 12n, lastId: 12n, rowCount: 3n });
    expect(s1!.closedAt).not.toBeNull();
    expect(s2).toMatchObject({ status: 'open', minId: 13n, maxId: null, rowCount: 0n });
    expect(s3).toMatchObject({ status: 'ready', minId: null });
    expect(s1!.databaseName).toBe('test_rollover_pk_1');
    expect(await place('rollover', 13n)).toBe(2);
    // The database's own lookup agrees.
    const route = (id: bigint) =>
      app.$queryRaw<{ shard_no: number }[]>`SELECT shard_no FROM registry.route('rollover', ${id}::bigint)`;
    expect((await route(12n))[0]!.shard_no).toBe(1);
    expect((await route(13n))[0]!.shard_no).toBe(2);
  });

  it('closes a shard at the highest ID it took, not at a late, lower one', async () => {
    await family('late_ids', 3);
    await place('late_ids', 20n);
    await place('late_ids', 30n);
    // The third row (it fills the shard) carries an ID made a moment before the second.
    await place('late_ids', 25n);
    let [s1, s2] = await shards('late_ids');
    expect(s1).toMatchObject({ status: 'full', maxId: 30n, lastId: 30n });
    expect(s2).toMatchObject({ status: 'open', minId: 31n });
    // Another late ID still lands where its range says, and is counted there.
    expect(await place('late_ids', 28n)).toBe(1);
    expect(await place('late_ids', 31n)).toBe(2);
    [s1, s2] = await shards('late_ids');
    expect(s1).toMatchObject({ status: 'full', rowCount: 4n, maxId: 30n });
    expect(s2).toMatchObject({ rowCount: 1n, lastId: 31n });
  });

  it('with no shard ready, nobody is turned away: one alert, and it hands over once a shard is added', async () => {
    await family('no_spare', 2, 1);
    await place('no_spare', 1n);
    await place('no_spare', 2n);
    expect(await place('no_spare', 3n)).toBe(1);
    const open = { kind: 'no_ready_shard', entity: 'no_spare', resolvedAt: null };
    expect(await owner.alert.count({ where: open })).toBe(1);
    expect((await shards('no_spare'))[0]).toMatchObject({ status: 'open', rowCount: 3n });

    await addShard('no_spare');
    expect(await place('no_spare', 4n)).toBe(1);
    expect(await place('no_spare', 5n)).toBe(2);
    expect((await shards('no_spare'))[0]).toMatchObject({ status: 'full', maxId: 4n, rowCount: 4n });
    expect(await owner.alert.count({ where: open })).toBe(0);
  });

  it('each region has its own shards', async () => {
    await family('two_regions', 10, 1);
    await addShard('two_regions', 1);
    expect(await place('two_regions', 5n)).toBe(1);
    expect(await place('two_regions', inRegion1(5n))).toBe(1);
    const [pk, eu] = await shards('two_regions');
    expect(pk).toMatchObject({
      region: 0,
      status: 'open',
      clusterId: 1,
      databaseName: 'test_two_regions_pk_1',
    });
    expect(eu).toMatchObject({
      region: 1,
      status: 'open',
      clusterId: 2,
      databaseName: 'test_two_regions_eu_1',
    });
  });

  it('stays exact with many placements at once, IDs arriving in any order', async () => {
    await family('crowd', 40, 10);
    const ids = new IdGenerator(5);
    const all = Array.from({ length: 400 }, () => ids.next());
    // Shuffled, deterministically: placements race each other and arrive out of order.
    let seed = 7;
    for (let i = all.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      const j = seed % (i + 1);
      [all[i], all[j]] = [all[j]!, all[i]!];
    }
    const placed = await Promise.all(all.map((id) => place('crowd', id)));

    const used = (await shards('crowd')).filter((s) => s.status !== 'ready');
    expect(used.reduce((n, s) => n + s.rowCount, 0n)).toBe(400n);
    // Ranges follow one another with no gap and no overlap.
    for (let i = 1; i < used.length; i++) expect(used[i]!.minId).toBe(used[i - 1]!.maxId! + 1n);
    // Every row was counted on exactly the shard its ID's range belongs to.
    for (const [i, id] of all.entries()) {
      const s = used.find((x) => x.minId! <= id && (x.maxId === null || id <= x.maxId))!;
      expect(s.shardNo).toBe(placed[i]);
    }
    for (const s of used) {
      expect(placed.filter((n) => n === s.shardNo).length).toBe(Number(s.rowCount));
      if (s.status === 'full') expect(s.rowCount).toBeGreaterThanOrEqual(40n);
    }
  });
});

describe('changing the registry as BUKU grows', () => {
  it('limits change at any time; each change is logged with who asked; counting rows is not a change', async () => {
    await family('adjustable', 5, 2);
    await place('adjustable', 1n);
    const before = await version();
    const logged = await owner.change.count();
    // Counting a row neither moves the version nor fills the log.
    await place('adjustable', 2n);
    expect(await version()).toBe(before);
    expect(await owner.change.count()).toBe(logged);

    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('buku.actor', 'capacity review OPS-42', true)`;
      await tx.shard.update({
        where: { entity_region_shardNo: { entity: 'adjustable', region: 0, shardNo: 1 } },
        data: { rowLimit: 3n },
      });
    });
    expect(await version()).toBeGreaterThan(before);
    const change = await owner.change.findFirstOrThrow({
      where: { tableName: 'shards' },
      orderBy: { id: 'desc' },
    });
    expect(change).toMatchObject({
      actor: 'capacity review OPS-42',
      dbRole: 'buku_migrator',
      operation: 'UPDATE',
    });
    expect((change.oldRow as { row_limit: number }).row_limit).toBe(5);
    expect((change.newRow as { row_limit: number }).row_limit).toBe(3);
    // The new limit applies from the next row.
    await place('adjustable', 3n);
    expect((await shards('adjustable'))[0]).toMatchObject({ status: 'full', maxId: 3n });
  });

  it('the registry refuses what would corrupt it', async () => {
    await family('guarded', 5, 1);
    const bad = [
      owner.entity.create({
        data: { entity: 'Bad-Name', description: 'x', defaultRowLimit: 1n, databasePattern: 'x_{shard}' },
      }),
      owner.entity.create({
        data: { entity: 'no_shard_slot', description: 'x', defaultRowLimit: 1n, databasePattern: 'x' },
      }),
      owner.entity.create({
        data: { entity: 'zero_limit', description: 'x', defaultRowLimit: 0n, databasePattern: 'x_{shard}' },
      }),
      owner.entity.create({
        data: {
          entity: 'odd_roles',
          description: 'x',
          defaultRowLimit: 1n,
          databasePattern: 'x_{shard}',
          placedBy: ['x; drop'],
        },
      }),
      owner.region.create({ data: { region: 8, code: 'zz', name: 'Nowhere' } }),
      owner.region.create({ data: { region: 5, code: 'ZZ<script>', name: 'Nowhere' } }),
      // A connection string where only a secret's name belongs.
      owner.cluster.create({
        data: { clusterId: 9, region: 0, name: 'leaky', dsnSecret: 'postgresql://u:p@h/db' },
      }),
      owner.shard.update({
        where: { entity_region_shardNo: { entity: 'guarded', region: 0, shardNo: 1 } },
        data: { status: 'sideways' },
      }),
    ];
    for (const attempt of bad) await expect(attempt).rejects.toThrow();
    // Two ranges of a family may never overlap, and only one shard may be open.
    await place('guarded', 1n);
    await addShard('guarded');
    await expect(
      owner.shard.update({
        where: { entity_region_shardNo: { entity: 'guarded', region: 0, shardNo: 2 } },
        data: { status: 'full', minId: 1n, maxId: 10n },
      }),
    ).rejects.toThrow();
    await expect(
      owner.shard.update({
        where: { entity_region_shardNo: { entity: 'guarded', region: 0, shardNo: 2 } },
        data: { status: 'open', minId: 1000n },
      }),
    ).rejects.toThrow();
  });
});

describe('who may do what in the directory', () => {
  it('services read the registry and call its functions, but never change it directly', async () => {
    await expect(app.$executeRawUnsafe(`UPDATE registry.shards SET row_limit = 1`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$executeRawUnsafe(`DELETE FROM registry.changes`)).rejects.toThrow(/permission denied/);
    await expect(app.$executeRawUnsafe(`UPDATE registry.version SET version = 0`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$queryRawUnsafe(`SELECT * FROM registry.id_generators`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.$queryRawUnsafe(`SELECT ids.next_id(1::smallint)`)).rejects.toThrow(/permission denied/);
    await expect(app.$queryRawUnsafe(`SELECT registry.add_shard('user', 0::smallint)`)).rejects.toThrow(
      /permission denied/,
    );
    expect(await app.shard.count()).toBeGreaterThan(0);
  });

  it('only the roles a family lists may place its rows; the list is data, changed without a deploy', async () => {
    await family('owned', 10, 1, ['buku_svc_business']);
    await expect(place('owned', 1n)).rejects.toThrow(/may not place/);
    await owner.entity.update({
      where: { entity: 'owned' },
      data: { placedBy: ['buku_svc_business', 'buku_app'] },
    });
    expect(await place('owned', 1n)).toBe(1);
  });

  it('no directory table or sequence is writable by the app role (a new one must revoke, too)', async () => {
    const writable = await owner.$queryRaw<{ name: string }[]>`
      SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname IN ('registry', 'ids', 'lookup') AND c.relkind IN ('r', 'p', 'S')
        AND (has_table_privilege('buku_app', c.oid, 'INSERT') OR has_table_privilege('buku_app', c.oid, 'UPDATE')
          OR has_table_privilege('buku_app', c.oid, 'DELETE') OR has_table_privilege('buku_app', c.oid, 'TRUNCATE')
          OR (c.relkind = 'S' AND has_sequence_privilege('buku_app', c.oid, 'USAGE')))`;
    expect(writable).toEqual([]);
  });
});

describe('global handles (DB-018)', () => {
  const key = (n: number, size = 16) => Buffer.alloc(size, n);
  type Claim = { claimed: boolean; previous_owner: bigint | null };
  const claim = (kind: string, k: Buffer, owner: bigint, takeOver = false) =>
    app.$queryRaw<Claim[]>`SELECT * FROM lookup.claim(${kind}, ${k}, ${owner}::bigint, ${takeOver})`.then(
      (r) => r[0]!,
    );
  const find = (kind: string, k: Buffer) =>
    app.$queryRaw<{ owner: bigint | null }[]>`SELECT lookup.find(${kind}, ${k}) AS owner`.then(
      (r) => r[0]!.owner,
    );
  const release = (kind: string, k: Buffer, owner: bigint) =>
    app.$queryRaw<{ ok: boolean }[]>`SELECT lookup.release(${kind}, ${k}, ${owner}::bigint) AS ok`.then(
      (r) => r[0]!.ok,
    );

  beforeAll(async () => {
    // Services write their own kinds; the tests' role is let in like the dev seed does, except
    // to WhatsApp numbers (the notification service's alone, as the migration says).
    await owner.$executeRaw`UPDATE lookup.handle_kinds SET writers = array_append(writers, 'buku_app')
      WHERE name <> 'user.whatsapp' AND NOT ('buku_app' = ANY (writers))`;
    await owner.$executeRaw`UPDATE lookup.handle_kinds SET writers = ARRAY['buku_svc_notification']
      WHERE name = 'user.whatsapp'`;
  });

  it('one email, one person, across every shard: a second claim is refused and says by whom', async () => {
    expect(await claim('user.email', key(1), 101n)).toEqual({ claimed: true, previous_owner: null });
    // Claiming what is already yours is fine (a retried sign-up).
    expect(await claim('user.email', key(1), 101n)).toEqual({ claimed: true, previous_owner: 101n });
    expect(await claim('user.email', key(1), 202n)).toEqual({ claimed: false, previous_owner: 101n });
    expect(await find('user.email', key(1))).toBe(101n);
    // The same key of another kind is a different handle.
    expect(await claim('user.phone', key(1), 202n)).toEqual({ claimed: true, previous_owner: null });
    expect(await find('user.email', key(99))).toBeNull();
  });

  it('a device moves to whoever signs in on it; only the owner can give a handle back', async () => {
    expect((await claim('user.push_token', key(2), 301n)).claimed).toBe(true);
    expect(await claim('user.push_token', key(2), 302n, true)).toEqual({
      claimed: true,
      previous_owner: 301n,
    });
    expect(await find('user.push_token', key(2))).toBe(302n);
    expect(await release('user.push_token', key(2), 301n)).toBe(false);
    expect(await release('user.push_token', key(2), 302n)).toBe(true);
    expect(await find('user.push_token', key(2))).toBeNull();
  });

  it('an erased account gives back every handle at once', async () => {
    await claim('user.email', key(3), 401n);
    await claim('user.public_id', Buffer.from('Ab3dEf6hIj9k'), 401n);
    await claim('business.slug', Buffer.from('fade-studio'), 401n);
    const n = await app.$queryRaw<{ n: number }[]>`SELECT lookup.release_all('user', 401::bigint) AS n`;
    expect(n[0]!.n).toBe(2);
    expect(await find('user.email', key(3))).toBeNull();
    // Another family's handle with the same owner number is untouched.
    expect(await find('business.slug', Buffer.from('fade-studio'))).toBe(401n);
  });

  it('refuses unknown kinds, wrong key sizes, and roles that may not write a kind', async () => {
    await expect(claim('user.nickname', key(4), 1n)).rejects.toThrow(/unknown handle kind/);
    await expect(claim('user.email', key(4, 15), 1n)).rejects.toThrow(/16 to 16 bytes/);
    await expect(claim('user.public_id', Buffer.from('short'), 1n)).rejects.toThrow(/12 to 12 bytes/);
    await expect(claim('user.email', key(4), 0n)).rejects.toThrow(/key and an owner/);
    // WhatsApp numbers are the notification service's alone.
    await expect(claim('user.whatsapp', key(4), 1n)).rejects.toThrow(/may not write user.whatsapp/);
    // Nobody writes the table directly.
    await expect(
      app.$executeRawUnsafe(`INSERT INTO lookup.handles (owner_id, kind, key) VALUES (1, 1, '\\x00')`),
    ).rejects.toThrow(/permission denied/);
  });

  it('is split into 16 parts by key from the start', async () => {
    const parts = await owner.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM pg_inherits WHERE inhparent = 'lookup.handles'::regclass`;
    expect(parts[0]!.n).toBe(16n);
  });

  it('a new kind is a row, logged like any other change to the layout', async () => {
    const before = await version();
    await owner.handleKind.create({
      data: {
        kind: 200,
        name: 'business.short_code',
        entity: 'business',
        keyMin: 4,
        keyMax: 8,
        writers: ['buku_app'],
        description: 'test',
      },
    });
    expect(await version()).toBeGreaterThan(before);
    expect((await claim('business.short_code', Buffer.from('FADE'), 9n)).claimed).toBe(true);
    await expect(
      owner.handleKind.create({
        data: { kind: 201, name: 'user.Bad Name', entity: 'user', keyMin: 1, keyMax: 2, description: 'x' },
      }),
    ).rejects.toThrow();
  });
});

describe('ID generator leases (DB-002)', () => {
  // Region 7: no other test leases there.
  const lease = (instance: string, ttl = 30) =>
    app.$queryRaw<{ generator_id: number }[]>`
      SELECT generator_id FROM registry.lease_generator(${instance}, 7::smallint, ${ttl}::int)`.then(
      (r) => r[0]!.generator_id,
    );

  it('each instance gets its own generator; a lost lease is reported; a released one waits out a grace period', async () => {
    const a = await lease('lease-a');
    const b = await lease('lease-b');
    expect(a).not.toBe(b);
    expect(a >> 7).toBe(7);
    // Never one of the region's generators kept for databases' own inserts.
    expect(a & 127).toBeLessThan(120);

    const renew = (g: number, who: string) =>
      app.$queryRaw<
        { e: Date | null }[]
      >`SELECT registry.renew_generator(${g}::smallint, ${who}, 30) AS e`.then((r) => r[0]!.e);
    expect(await renew(a, 'lease-a')).toBeInstanceOf(Date);
    expect(await renew(a, 'lease-b')).toBeNull();

    await app.$queryRaw`SELECT registry.release_generator(${a}::smallint, 'lease-a')`;
    // Released, but not handed out again for 30 seconds.
    const c = await lease('lease-c');
    expect(c).not.toBe(a);

    // A lease that ran out more than 30 seconds ago can't be renewed, and is handed out again once
    // the never-used generators are gone; after that, the region has none left.
    await owner.idGenerator.update({
      where: { generatorId: b },
      data: { leaseExpires: new Date(Date.now() - 31_000) },
    });
    expect(await renew(b, 'lease-b')).toBeNull();
    await owner.idGenerator.updateMany({
      where: { generatorId: { gte: 7 * 128, lt: 7 * 128 + 120, not: b }, leasedBy: null },
      data: { leasedBy: 'busy', leaseExpires: new Date(Date.now() + 600_000) },
    });
    expect(await lease('lease-d')).toBe(b);
    await expect(lease('lease-e')).rejects.toThrow(/no free ID generator in region 7/);
  });

  it('refuses nonsense', async () => {
    await expect(lease('', 30)).rejects.toThrow(/instance name/);
    await expect(lease('x', 5)).rejects.toThrow(/10\.\.600/);
    await expect(lease('x', 100_000)).rejects.toThrow(/10\.\.600/);
  });
});

describe('IDs made inside the database (DB-002)', () => {
  it('unique and in order, even asked for at once from many connections', async () => {
    const rows = await Promise.all(
      Array.from(
        { length: 8 },
        () =>
          owner.$queryRaw<
            { id: bigint }[]
          >`SELECT ids.next_id(1023::smallint) AS id FROM generate_series(1, 500)`,
      ),
    );
    const ids = rows.flat().map((r) => r.id);
    expect(new Set(ids).size).toBe(4000);
    for (const batch of rows) {
      for (let i = 1; i < batch.length; i++) expect(batch[i]!.id > batch[i - 1]!.id).toBe(true);
    }
    // Same layout as @buku/common: generator 1023 is region 7's.
    expect(Number((ids[0]! >> 12n) & 1023n)).toBe(1023);
  });
});

describe('LeasedIdGenerator', () => {
  it('makes IDs from its leased generator, and stops the moment its lease is gone', async () => {
    const ids = new LeasedIdGenerator(app, { instance: 'leased-1', region: 6, ttlSeconds: 30 });
    await ids.start();
    const generator = ids.generator!;
    expect(generator >> 7).toBe(6);
    const a = ids.next();
    expect(ids.next() > a).toBe(true);
    expect(Number((a >> 12n) & 1023n)).toBe(generator);
    expect(await ids.renew()).toBe(true);

    // Another instance takes it over (as if this one had frozen past its lease).
    await owner.idGenerator.update({ where: { generatorId: generator }, data: { leasedBy: 'leased-2' } });
    expect(await ids.renew()).toBe(false);
    expect(() => ids.next()).toThrow(IdLeaseLostError);
    await ids.stop();
  });

  it('gives its generator back on stop', async () => {
    const ids = new LeasedIdGenerator(app, { instance: 'leased-3', region: 6, ttlSeconds: 30 });
    await ids.start();
    const generator = ids.generator!;
    await ids.stop();
    expect(() => ids.next()).toThrow(IdLeaseLostError);
    expect(await owner.idGenerator.findUniqueOrThrow({ where: { generatorId: generator } })).toMatchObject({
      leasedBy: null,
    });
  });
});

describe('ShardRouter', () => {
  it('answers from its copy where it is certain, and checks the registry where it might be out of date', async () => {
    await family('routed', 3, 3);
    const router = new ShardRouter(app);
    await router.refresh();
    expect(router.route('routed', 1n)).toBeNull();

    // Placing through the router: each row's shard comes back, and the copy learns it.
    expect((await router.place('routed', 100n)).shardNo).toBe(1);
    expect(router.route('routed', 100n)).toMatchObject({
      shardNo: 1,
      databaseName: 'test_routed_pk_1',
      dsnSecret: 'DATABASE_URL_PK_1',
    });
    await router.place('routed', 101n);

    // Another instance fills shard 1 and opens shard 2; this router hasn't heard yet.
    await place('routed', 102n);
    await place('routed', 103n);
    // IDs it has seen placed are certain (closed ranges never move); a newer one isn't.
    expect(router.route('routed', 101n)?.shardNo).toBe(1);
    expect(router.route('routed', 103n)).toBeNull();
    expect((await router.locate('routed', 103n)).shardNo).toBe(2);
    expect((await router.locate('routed', 102n)).shardNo).toBe(1);
    expect(router.route('routed', 102n)).toMatchObject({ shardNo: 1, status: 'full', maxId: 102n });

    // Lookups that need a check at the same moment share it.
    await place('routed', 104n);
    await place('routed', 105n);
    const found = await Promise.all([104n, 105n, 104n, 105n].map((id) => router.locate('routed', id)));
    expect(found.map((s) => s.shardNo)).toEqual([2, 2, 2, 2]);

    await expect(router.locate('routed', inRegion1(1n))).rejects.toThrow(ShardNotFoundError);
    await expect(router.locate('no_such_family', 1n)).rejects.toThrow(ShardNotFoundError);
  });

  it('notices layout changes by itself', async () => {
    await family('watched', 100, 1);
    const router = new ShardRouter(app, { pollMs: 50 });
    await router.start();
    try {
      const seen = router.version;
      await place('watched', 1n);
      await expect.poll(() => router.version, { timeout: 2000 }).toBeGreaterThan(seen);
      await expect.poll(() => router.route('watched', 1n)?.shardNo, { timeout: 2000 }).toBe(1);
    } finally {
      router.stop();
    }
  });
});
