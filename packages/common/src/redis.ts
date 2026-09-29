import { Redis, type RedisOptions } from 'ioredis';
import { logger } from './logger.js';

/**
 * Valkey/Redis client factory (Valkey is wire-compatible with Redis; BUKU runs
 * Valkey because DigitalOcean's managed cache is Valkey).
 *
 * Two flavours:
 *  - default: commands fail fast (maxRetriesPerRequest=3) when the server is
 *    down, so HTTP requests return 503 instead of hanging.
 *  - `forBlockingWorkers: true`: required by BullMQ workers, which issue
 *    blocking commands and must wait indefinitely across reconnects.
 */
export interface CreateRedisOptions {
  url: string;
  /** Shows up in `CLIENT LIST` on the server: makes debugging connections easy. */
  connectionName: string;
  forBlockingWorkers?: boolean;
  extra?: RedisOptions;
}

export function createRedisClient(options: CreateRedisOptions): Redis {
  const log = logger.child({ module: 'redis', connection: options.connectionName });
  const client = new Redis(options.url, {
    connectionName: options.connectionName,
    maxRetriesPerRequest: options.forBlockingWorkers ? null : 3,
    enableReadyCheck: true,
    connectTimeout: 5_000,
    // Exponential backoff capped at 5s; never give up (the server may just be restarting).
    retryStrategy: (attempt) => Math.min(2 ** attempt * 100, 5_000),
    ...options.extra,
  });

  let lastErrorLog = 0;
  client.on('error', (err) => {
    // During an outage ioredis emits an error per retry; log at most every 10s.
    const now = Date.now();
    if (now - lastErrorLog > 10_000) {
      lastErrorLog = now;
      log.error({ err }, 'redis connection error');
    }
  });
  client.on('ready', () => log.info('redis ready'));
  return client;
}
