import { CROSS_BUSINESS, type ServiceName } from './access.js';
import {
  createDirectoryClient,
  LeasedIdGenerator,
  ShardRouter,
  type DirectoryClient,
  type ShardInfo,
} from './directory.js';
import {
  createBusinessShardClient,
  createCatalogClient,
  createUserShardClient,
  forAllBusinesses,
  forBusiness,
  ShardClients,
  shardUrl,
  type BusinessShardClient,
  type CatalogClient,
  type Credentials,
  type UserShardClient,
} from './shards.js';

/**
 * A service's way into database v2 (docs/DATABASE.md §6, D3): the directory, the router, a leased
 * ID generator, a connection pool per shard, and the catalog for those that use it, all signed
 * in as the service's own role (D-092). Business-shard work runs scoped to one business
 * (`inBusiness`, DB-020); work meant to span every business runs through the service's
 * cross-business role, shard by shard (`acrossBusinesses`), and only for services allowed one.
 */

export type BusinessTx = Parameters<Parameters<BusinessShardClient['$transaction']>[0]>[0];
export type UserTx = Parameters<Parameters<UserShardClient['$transaction']>[0]>[0];

export interface DataPlaneOptions {
  service: ServiceName;
  /** The service's DATABASE_URL: its role's credentials, and the default server of the directory and catalog. */
  databaseUrl: string;
  directoryUrl?: string;
  /** Only services that read or keep the catalog (search, ads). */
  catalogUrl?: string;
  useCatalog?: boolean;
  /** The region IDs are made in (DB-002). */
  region?: number;
  /** This running instance's name, for its ID generator lease. */
  instance: string;
  /** Where cluster addresses are read from (the settings the registry names). */
  env?: NodeJS.ProcessEnv;
  poolSize?: number;
}

/** The same server and credentials as `url`, another database. */
export function sameServer(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function credentialsOf(url: string): Credentials {
  const u = new URL(url);
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}

export class DataPlane {
  private constructor(
    readonly service: ServiceName,
    readonly directory: DirectoryClient,
    readonly router: ShardRouter,
    readonly ids: LeasedIdGenerator,
    readonly users: ShardClients<UserShardClient>,
    readonly businesses: ShardClients<BusinessShardClient>,
    readonly catalog: CatalogClient | null,
  ) {}

  static async start(options: DataPlaneOptions): Promise<DataPlane> {
    const name = `${options.service}-service`;
    const credentials = credentialsOf(options.databaseUrl);
    const pool = options.poolSize ?? 5;
    const directory = createDirectoryClient({
      url: options.directoryUrl ?? sameServer(options.databaseUrl, 'buku_directory'),
      applicationName: name,
    });
    const router = new ShardRouter(directory);
    const ids = new LeasedIdGenerator(directory, { instance: options.instance, region: options.region ?? 0 });
    const users = new ShardClients<UserShardClient>(router, 'user', (s) =>
      createUserShardClient({
        url: shardUrl(s, credentials, options.env),
        applicationName: name,
        maxConnections: pool,
      }),
    );
    const businesses = new ShardClients<BusinessShardClient>(router, 'business', (s) =>
      createBusinessShardClient({
        url: shardUrl(s, credentials, options.env),
        applicationName: name,
        maxConnections: pool,
      }),
    );
    const catalog = options.useCatalog
      ? createCatalogClient({
          url: options.catalogUrl ?? sameServer(options.databaseUrl, 'buku_catalog'),
          applicationName: name,
          maxConnections: pool,
        })
      : null;
    await router.start();
    await ids.start();
    return new DataPlane(options.service, directory, router, ids, users, businesses, catalog);
  }

  /** A new ID (DB-002). */
  id(): bigint {
    return this.ids.next();
  }

  /** The user shard holding this person. */
  user(userId: bigint): Promise<UserShardClient> {
    return this.users.forId(userId);
  }

  /** Place a new person or business (registry.place, DB-011) and return its shard's client. */
  async placeUser(userId: bigint): Promise<UserShardClient> {
    return this.users.forShard(await this.router.place('user', userId));
  }
  async placeBusiness(businessId: bigint): Promise<BusinessShardClient> {
    return this.businesses.forShard(await this.router.place('business', businessId));
  }

  /** One transaction on the business's shard, seeing and writing only that business (DB-020). */
  async inBusiness<T>(
    businessId: bigint,
    work: (tx: BusinessTx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T> {
    const shard = await this.businesses.forId(businessId);
    return shard.$transaction(async (tx) => {
      await forBusiness(tx, businessId);
      return work(tx);
    }, options);
  }

  /**
   * Visit every business shard, one transaction each, through the service's cross-business role
   * (CROSS_BUSINESS): for sweeps that are meant to see every business. Results in shard order.
   */
  async acrossBusinesses<T>(work: (tx: BusinessTx, shard: ShardInfo) => Promise<T>): Promise<T[]> {
    if (!CROSS_BUSINESS[this.service]) {
      throw new Error(`${this.service} has no cross-business role (CROSS_BUSINESS in access.ts)`);
    }
    const out: T[] = [];
    for (const shard of await this.router.shards('business')) {
      const client = this.businesses.forShard(shard);
      out.push(
        await client.$transaction(async (tx) => {
          await forAllBusinesses(tx, this.service);
          return work(tx, shard);
        }),
      );
    }
    return out;
  }

  /** Visit every user shard (no row-level security there): for sweeps across people. */
  async acrossUsers<T>(work: (db: UserShardClient, shard: ShardInfo) => Promise<T>): Promise<T[]> {
    const out: T[] = [];
    for (const shard of await this.router.shards('user'))
      out.push(await work(this.users.forShard(shard), shard));
    return out;
  }

  /** Global handles (DB-018): what people and businesses are found by. */
  readonly handles = {
    claim: async (kind: string, key: Buffer, owner: bigint, takeOver = false) => {
      const rows = await this.directory.$queryRaw<{ claimed: boolean; previous_owner: bigint | null }[]>`
        SELECT claimed, previous_owner FROM lookup.claim(${kind}, ${key}, ${owner}::bigint, ${takeOver})`;
      const row = rows[0]!;
      return { claimed: row.claimed, previousOwner: row.previous_owner };
    },
    find: async (kind: string, key: Buffer): Promise<bigint | null> => {
      const rows = await this.directory.$queryRaw<
        { owner: bigint | null }[]
      >`SELECT lookup.find(${kind}, ${key}) AS owner`;
      return rows[0]?.owner ?? null;
    },
    release: async (kind: string, key: Buffer, owner: bigint): Promise<boolean> => {
      const rows = await this.directory.$queryRaw<{ ok: boolean }[]>`
        SELECT lookup.release(${kind}, ${key}, ${owner}::bigint) AS ok`;
      return rows[0]?.ok ?? false;
    },
    releaseAll: async (entity: 'user' | 'business', owner: bigint): Promise<number> => {
      const rows = await this.directory.$queryRaw<{ n: number }[]>`
        SELECT lookup.release_all(${entity}, ${owner}::bigint) AS n`;
      return Number(rows[0]?.n ?? 0);
    },
  };

  async close(): Promise<void> {
    this.router.stop();
    await this.ids.stop().catch(() => undefined);
    await Promise.all([this.users.close(), this.businesses.close(), this.catalog?.$disconnect()]);
    await this.directory.$disconnect();
  }
}

/** An audit entry on a shard (append-only, DB-022), as v1's recordAudit but with a v2 ID. */
export interface ShardAuditEntry {
  userId?: bigint | null;
  action: string;
  resourceType: string;
  resourceId?: bigint | null;
  oldValues?: unknown;
  newValues?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}
export async function recordShardAudit(
  tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  id: bigint,
  entry: ShardAuditEntry,
): Promise<void> {
  const json = (value: unknown) =>
    value === undefined
      ? null
      : JSON.stringify(value, (_, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  await tx.$executeRaw`
    INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, ip_address, user_agent, request_id,
                            old_values, new_values)
    VALUES (${id}, ${entry.userId ?? null}, ${entry.action}, ${entry.resourceType}, ${entry.resourceId ?? null},
            ${entry.ipAddress ?? null}::inet, ${entry.userAgent?.slice(0, 500) ?? null}, ${entry.requestId ?? null},
            ${json(entry.oldValues)}::jsonb, ${json(entry.newValues)}::jsonb)`;
}

/**
 * A person's role in a business, read on the business's shard (D3): the owner, or an active
 * member. Whether the person still has to change a temporary password (D-034) lives on their own
 * shard, so it travels in their sign-in token and is checked by the caller.
 */
export async function businessRoleOnShard(
  tx: BusinessTx,
  businessId: bigint,
  userId: bigint,
): Promise<'owner' | 'manager' | 'front_desk' | 'staff' | null> {
  const business = await tx.business.findFirst({
    where: { id: businessId, deletedAt: null },
    select: {
      ownerUserId: true,
      members: { where: { userId, status: 'active' }, select: { role: true }, take: 1 },
    },
  });
  if (!business) return null;
  if (business.ownerUserId === userId) return 'owner';
  const role = business.members[0]?.role;
  return role === 'manager' || role === 'front_desk' || role === 'staff' ? role : null;
}
