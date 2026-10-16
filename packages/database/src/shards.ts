import { PrismaPg } from '@prisma/adapter-pg';
import type { ShardInfo, ShardRouter } from './directory.js';
import { PrismaClient as UserShardPrismaClient } from './generated/user/client.js';

/**
 * Connections to shard databases (docs/DATABASE.md DB-010…DB-012). A shard's address is its
 * cluster's (the registry names the setting that holds it, `dsn_secret`) plus its own database
 * name; credentials are always the caller's own role, never stored with the address.
 */

export * as UserShard from './generated/user/client.js';

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
  });
  return new UserShardPrismaClient({ adapter });
}
export type UserShardClient = ReturnType<typeof createUserShardClient>;

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
