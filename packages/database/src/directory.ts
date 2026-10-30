import { IdGenerator, logger, regionOfId } from '@buku/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/directory/client.js';
import { tlsOptions } from './tls.js';

/**
 * The directory database (docs/DATABASE.md §6): where every person and business lives, and the ID
 * generators running services lease. Services read it through a cached copy (ShardRouter) and call
 * its functions; they never change its tables directly (scripts/apply-access.ts).
 */

export * as Directory from './generated/directory/client.js';

export function createDirectoryClient(options: {
  url: string;
  applicationName: string;
  maxConnections?: number;
}) {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 4,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // TLS 1.3, the server's certificate and name checked (DB-020; tls.ts).
    ssl: tlsOptions(),
  });
  return new PrismaClient({ adapter });
}
export type DirectoryClient = ReturnType<typeof createDirectoryClient>;

export class IdLeaseLostError extends Error {
  constructor() {
    super('this instance no longer holds an ID generator lease; it must not make IDs');
    this.name = 'IdLeaseLostError';
  }
}

/**
 * An ID generator held through a lease (DB-002). Leases one of its region's generators, renews it
 * every third of its life, and stops making IDs the moment the lease could have run out (by its own
 * monotonic clock, with a safety margin), so two instances never make the same IDs, even if this
 * one freezes and its generator is handed to another.
 */
export class LeasedIdGenerator {
  #generator: IdGenerator | null = null;
  #deadline = 0;
  #timer: NodeJS.Timeout | null = null;
  #stopped = false;
  #leasing: Promise<boolean> | null = null;
  readonly #log = logger.child({ module: 'ids' });

  constructor(
    private readonly directory: DirectoryClient,
    private readonly options: {
      /** This instance's name (host, pod, process): shows who holds a lease. */
      instance: string;
      /** Region code number 0..7 (DB-002). */
      region: number;
      /** Lease length; renewed every third of it. Default 60 s. */
      ttlSeconds?: number;
      /** Stop this long before the lease could expire. Default 5 s. */
      marginSeconds?: number;
    },
  ) {}

  get ttl() {
    return this.options.ttlSeconds ?? 60;
  }

  async start(): Promise<void> {
    this.#stopped = false;
    await this.#lease();
    this.#timer = setInterval(() => void this.renew(), (this.ttl * 1000) / 3);
    this.#timer.unref();
    this.#log.info({ generator: this.generator, region: this.options.region }, 'ID generator leased');
  }

  /** A generator of its own for this instance (the registry hands out only free ones). */
  async #lease(): Promise<void> {
    const asked = performance.now();
    const rows = await this.directory.$queryRaw<{ generator_id: number }[]>`
      SELECT generator_id FROM registry.lease_generator(${this.options.instance}, ${this.options.region}::smallint, ${this.ttl}::int)`;
    const generator = rows[0]?.generator_id;
    if (generator === undefined) throw new Error('no ID generator was leased');
    this.#generator = new IdGenerator(Number(generator));
    this.#extend(asked);
  }

  /** The next ID; throws IdLeaseLostError once the lease may have run out. */
  next(): bigint {
    if (!this.#generator || performance.now() >= this.#deadline) throw new IdLeaseLostError();
    return this.#generator.next();
  }

  get generator(): number | null {
    return this.#generator?.generator ?? null;
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    const generator = this.#generator?.generator;
    this.#generator = null;
    this.#deadline = 0;
    if (generator === undefined) return;
    await this.directory
      .$queryRaw`SELECT registry.release_generator(${generator}::smallint, ${this.options.instance})`;
  }

  /** Counted from when the request was SENT, so slow answers only ever shorten the window. */
  #extend(askedAt: number) {
    this.#deadline = askedAt + (this.ttl - (this.options.marginSeconds ?? 5)) * 1000;
  }

  /**
   * Renew the lease now (it also renews itself every third of its life). True when this instance
   * may go on making IDs. A renewal that doesn't get through keeps the current deadline (IDs then
   * stop by themselves when the lease could run out). A lease that is gone — run out while the
   * directory couldn't be reached, or taken by another instance — is never used again: this
   * instance stops at once and leases a new generator, as a restart would, and keeps trying every
   * renewal until it gets one. Until then it makes no IDs.
   */
  async renew(): Promise<boolean> {
    if (this.#stopped) return false;
    const generator = this.#generator?.generator;
    if (generator === undefined) return this.#leaseAgain();
    const asked = performance.now();
    try {
      const rows = await this.directory.$queryRaw<{ expires: Date | null }[]>`
        SELECT registry.renew_generator(${generator}::smallint, ${this.options.instance}, ${this.ttl}::int) AS expires`;
      if (rows[0]?.expires) {
        this.#extend(asked);
        return true;
      }
    } catch (err) {
      // Keep the old deadline: IDs stop by themselves if renewals keep failing.
      this.#log.warn({ err, generator }, 'could not renew the ID generator lease');
      return false;
    }
    this.#log.error({ generator }, 'ID generator lease lost: no more IDs from it; leasing a new one');
    this.#generator = null;
    this.#deadline = 0;
    return this.#leaseAgain();
  }

  /** One new lease at a time, however many renewals ask for it. */
  #leaseAgain(): Promise<boolean> {
    this.#leasing ??= this.#lease()
      .then(() => {
        this.#log.warn(
          { generator: this.generator, region: this.options.region },
          'ID generator leased again',
        );
        return true;
      })
      .catch((err: unknown) => {
        this.#log.error({ err }, 'could not lease a new ID generator; no IDs until one is leased');
        return false;
      })
      .finally(() => {
        this.#leasing = null;
      });
    return this.#leasing;
  }
}

export interface ShardInfo {
  entity: string;
  region: number;
  shardNo: number;
  status: string;
  minId: bigint;
  /** The end of a closed range; null while the shard is open. */
  maxId: bigint | null;
  /** The highest ID placed so far: every ID up to it is certainly here. */
  lastId: bigint | null;
  clusterId: number;
  databaseName: string;
  /** The name of the secret holding the cluster's connection string. */
  dsnSecret: string;
}

export class ShardNotFoundError extends Error {
  constructor(entity: string, id: bigint) {
    super(`no ${entity} shard holds ${id}`);
    this.name = 'ShardNotFoundError';
  }
}

interface ShardRow {
  version: bigint;
  entity: string | null;
  region: number | null;
  shard_no: number | null;
  status: string | null;
  min_id: bigint | null;
  max_id: bigint | null;
  last_id: bigint | null;
  cluster_id: number | null;
  database_name: string | null;
  dsn_secret: string | null;
}

/**
 * Where an ID lives (DB-011…DB-013), from a cached copy of the registry: no round trip for almost
 * every lookup. The copy is only trusted where it can't be out of date: a closed range never
 * changes, and in the open shard every ID up to the highest one placed (lastId) stays there for
 * good. A newer ID may belong to a shard that opened a moment ago, so for those `locate` first
 * checks the registry (one tiny query, shared by every lookup waiting at that moment).
 *
 * Shard families, regions, limits and clusters all come from the registry, so adding any of them
 * needs no code change.
 */
export class ShardRouter {
  #version = -1n;
  /** Per `entity:region`, sorted by minId; ranges never overlap. */
  #ranges = new Map<string, ShardInfo[]>();
  #timer: NodeJS.Timeout | null = null;
  #running: Promise<void> | null = null;
  #queued: Promise<void> | null = null;

  constructor(
    private readonly directory: DirectoryClient,
    private readonly options: { pollMs?: number } = {},
  ) {}

  async start(): Promise<void> {
    await this.refresh();
    this.#timer = setInterval(() => void this.refresh().catch(() => undefined), this.options.pollMs ?? 5_000);
    this.#timer.unref();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  /** The registry version the cached copy is from. */
  get version(): bigint {
    return this.#version;
  }

  /**
   * Bring the cached copy up to date: when the layout changed, re-read it all; otherwise just how
   * far each open shard has got. Each is one statement, so it sees one consistent moment.
   */
  async refresh(): Promise<void> {
    const open = await this.directory.$queryRaw<ShardRow[]>`
      SELECT v.version, s.entity, s.region, s.shard_no, s.last_id,
             NULL::text AS status, NULL::bigint AS min_id, NULL::bigint AS max_id, NULL::smallint AS cluster_id,
             NULL::text AS database_name, NULL::text AS dsn_secret
      FROM registry.version v LEFT JOIN registry.shards s ON s.status = 'open'
      WHERE v.id = 1`;
    const version = open[0]?.version;
    if (version === undefined) throw new Error('the directory has no registry version');
    if (version === this.#version) {
      for (const row of open) {
        const shard = row.entity === null ? undefined : this.#shard(row.entity, row.region!, row.shard_no!);
        if (shard && row.last_id !== null && (shard.lastId === null || row.last_id > shard.lastId)) {
          shard.lastId = row.last_id;
        }
      }
      return;
    }
    const rows = await this.directory.$queryRaw<ShardRow[]>`
      SELECT v.version, s.entity, s.region, s.shard_no, s.status, s.min_id, s.max_id, s.last_id,
             s.cluster_id, s.database_name, c.dsn_secret
      FROM registry.version v
      LEFT JOIN (registry.shards s JOIN registry.clusters c ON c.cluster_id = s.cluster_id)
        ON s.status <> 'ready'
      WHERE v.id = 1
      ORDER BY s.entity, s.region, s.min_id`;
    const ranges = new Map<string, ShardInfo[]>();
    for (const r of rows) {
      if (r.entity === null || r.min_id === null) continue;
      const key = `${r.entity}:${r.region}`;
      const list = ranges.get(key) ?? [];
      list.push({
        entity: r.entity,
        region: r.region!,
        shardNo: r.shard_no!,
        status: r.status!,
        minId: r.min_id,
        maxId: r.max_id,
        lastId: r.last_id,
        clusterId: r.cluster_id!,
        databaseName: r.database_name!,
        dsnSecret: r.dsn_secret!,
      });
      ranges.set(key, list);
    }
    this.#ranges = ranges;
    this.#version = rows[0]!.version;
  }

  /**
   * Every shard of a family that holds rows (not 'ready'), in every region, as of a fresh read of
   * the registry: for work that visits each one (a sweep across businesses).
   */
  async shards(entity: string): Promise<ShardInfo[]> {
    await this.#checkFromNow();
    return [...this.#ranges.entries()]
      .filter(([key]) => key.startsWith(`${entity}:`))
      .flatMap(([, list]) => list);
  }

  /**
   * The shard holding this ID, from the cached copy, when the copy is certain; null when it might
   * be out of date for this ID (then use `locate`).
   */
  route(entity: string, id: bigint): ShardInfo | null {
    const list = this.#ranges.get(`${entity}:${regionOfId(id)}`);
    if (!list) return null;
    // The last range starting at or before the ID.
    let lo = 0;
    let hi = list.length - 1;
    let found: ShardInfo | undefined;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = list[mid]!;
      if (s.minId <= id) {
        found = s;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (!found) return null;
    if (found.maxId !== null) return id <= found.maxId ? found : null;
    return found.lastId !== null && id <= found.lastId ? found : null;
  }

  /** The shard holding an existing row's ID; checks the registry first when the copy isn't certain. */
  async locate(entity: string, id: bigint): Promise<ShardInfo> {
    const cached = this.route(entity, id);
    if (cached) return cached;
    // The row exists, so it was placed before now: a check that starts now sees where.
    await this.#checkFromNow();
    const shard = this.route(entity, id);
    if (!shard) throw new ShardNotFoundError(entity, id);
    return shard;
  }

  /** Place a NEW row of a family (a new person, a new business): counted, and its shard returned. */
  async place(entity: string, id: bigint): Promise<ShardInfo> {
    const rows = await this.directory.$queryRaw<{ region: number; shard_no: number }[]>`
      SELECT region, shard_no FROM registry.place(${entity}, ${id}::bigint)`;
    const placed = rows[0];
    if (!placed) throw new ShardNotFoundError(entity, id);
    let shard = this.#shard(entity, placed.region, placed.shard_no);
    if (!shard) {
      // A shard that opened with this very row.
      await this.#checkFromNow();
      shard = this.#shard(entity, placed.region, placed.shard_no);
      if (!shard) throw new ShardNotFoundError(entity, id);
    }
    // Ranges are contiguous: everything from the shard's start up to this ID is in it too.
    if (shard.maxId === null && (shard.lastId === null || id > shard.lastId)) shard.lastId = id;
    return shard;
  }

  #shard(entity: string, region: number, shardNo: number): ShardInfo | undefined {
    return this.#ranges.get(`${entity}:${region}`)?.find((s) => s.shardNo === shardNo);
  }

  /** Waits for a registry check that STARTS after this call; callers arriving together share one. */
  #checkFromNow(): Promise<void> {
    if (this.#queued) return this.#queued;
    if (!this.#running) {
      this.#running = this.refresh().finally(() => {
        this.#running = null;
      });
      return this.#running;
    }
    // One is already on its way, but it began before this call: the next one is ours.
    this.#queued = this.#running
      .catch(() => undefined)
      .then(() => {
        this.#queued = null;
        return this.#checkFromNow();
      });
    return this.#queued;
  }
}
