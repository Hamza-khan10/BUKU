import { PrismaPg } from '@prisma/adapter-pg';
import type { ShardInfo, ShardRouter } from './directory.js';
import { PrismaClient as BusinessShardPrismaClient } from './generated/business/client.js';
import { PrismaClient as CatalogPrismaClient } from './generated/catalog/client.js';
import { PrismaClient as UserShardPrismaClient } from './generated/user/client.js';
import { tlsOptions } from './tls.js';

/**
 * Connections to shard databases (docs/DATABASE.md DB-010…DB-012). A shard's address is its
 * cluster's (the registry names the setting that holds it, `dsn_secret`) plus its own database
 * name; credentials are always the caller's own role, never stored with the address.
 */

export * as UserShard from './generated/user/client.js';
export * as BusinessShard from './generated/business/client.js';
export * as Catalog from './generated/catalog/client.js';

export interface Credentials {
  user: string;
  password: string;
}

/**
 * The URL of one database on a cluster: the cluster's address from `env[dsnSecret]` (host, port
 * and options such as sslmode; any user, password or database in it are ignored), signed in as
 * `credentials`.
 */
export function clusterUrl(
  dsnSecret: string,
  database: string,
  credentials: Credentials,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const address = env[dsnSecret];
  if (!address)
    throw new Error(`${dsnSecret} is not set: the address of a database cluster (run pnpm bootstrap)`);
  const url = new URL(address);
  url.username = encodeURIComponent(credentials.user);
  url.password = encodeURIComponent(credentials.password);
  url.pathname = `/${encodeURIComponent(database)}`;
  return url.toString();
}

export const shardUrl = (shard: ShardInfo, credentials: Credentials, env: NodeJS.ProcessEnv = process.env) =>
  clusterUrl(shard.dsnSecret, shard.databaseName, credentials, env);

export function createUserShardClient(options: {
  url: string;
  applicationName: string;
  maxConnections?: number;
}) {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 5,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // TLS 1.3, the server's certificate and name checked (DB-020; tls.ts).
    ssl: tlsOptions(),
  });
  return new UserShardPrismaClient({ adapter });
}
export type UserShardClient = ReturnType<typeof createUserShardClient>;

/**
 * A business shard's client. Its tables have row-level security by business (DB-020): run each
 * unit of work in a transaction that first calls `forBusiness(tx, id)`.
 */
export function createBusinessShardClient(options: {
  url: string;
  applicationName: string;
  maxConnections?: number;
}) {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 5,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // TLS 1.3, the server's certificate and name checked (DB-020; tls.ts).
    ssl: tlsOptions(),
  });
  return new BusinessShardPrismaClient({ adapter });
}
export type BusinessShardClient = ReturnType<typeof createBusinessShardClient>;

/**
 * Scope a transaction to one business (DB-020): from here to the end of the transaction, rows of
 * every other business are invisible and can't be written. Set inside the transaction (`SET
 * LOCAL`), so a pooled connection never carries it to the next request.
 */
export async function forBusiness(
  tx: { $executeRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<number> },
  businessId: bigint,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('buku.business_id', ${businessId.toString()}, true)`;
}

/**
 * Open a transaction to every business (DB-020), for work that is meant to (reminders, admin
 * queues, ranking statistics): switches to the service's cross-business role,
 * buku_svc_<service>_all, until the transaction ends. Only services listed in CROSS_BUSINESS have
 * one; a request handler never calls this, so a query that forgets its business still sees nothing.
 */
export async function forAllBusinesses(
  tx: { $executeRawUnsafe: (query: string) => Promise<number> },
  service: string,
): Promise<void> {
  if (!/^[a-z]+$/.test(service)) throw new Error(`not a service name: ${service}`);
  await tx.$executeRawUnsafe(`SET LOCAL ROLE "buku_svc_${service}_all"`);
}

/**
 * One connection pool per shard database, opened on first use: `forId` finds a row's shard
 * through the router; `forShard` when it is already known (a new row just placed).
 */
export class ShardClients<C extends { $disconnect(): Promise<void> }> {
  readonly #clients = new Map<string, C>();

  constructor(
    private readonly router: ShardRouter,
    private readonly family: string,
    private readonly connect: (shard: ShardInfo) => C,
  ) {}

  async forId(id: bigint): Promise<C> {
    return this.forShard(await this.router.locate(this.family, id));
  }

  forShard(shard: ShardInfo): C {
    if (shard.entity !== this.family)
      throw new Error(`a ${shard.entity} shard is not a ${this.family} shard`);
    const key = `${shard.clusterId}/${shard.databaseName}`;
    let client = this.#clients.get(key);
    if (!client) {
      client = this.connect(shard);
      this.#clients.set(key, client);
    }
    return client;
  }

  async close(): Promise<void> {
    const clients = [...this.#clients.values()];
    this.#clients.clear();
    await Promise.all(clients.map((c) => c.$disconnect()));
  }
}

/** The catalog (DB-041): what search and discovery read, kept from business events. */
export function createCatalogClient(options: {
  url: string;
  applicationName: string;
  maxConnections?: number;
}) {
  const adapter = new PrismaPg({
    connectionString: options.url,
    max: options.maxConnections ?? 5,
    application_name: options.applicationName,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    // TLS 1.3, the server's certificate and name checked (DB-020; tls.ts).
    ssl: tlsOptions(),
  });
  return new CatalogPrismaClient({ adapter });
}
export type CatalogClient = ReturnType<typeof createCatalogClient>;
