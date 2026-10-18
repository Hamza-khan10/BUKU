import {
  createHttpApp,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { LiveHub } from './live/live-hub.js';
import { QueueService } from './queue-service.js';
import { registerRoutes } from './routes/index.js';
import { QueueSettingsService } from './settings.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface QueueAppDeps {
  /** Database v2 (D3): the directory, the shards, IDs — signed in as queue-service's own role. */
  plane: DataPlane;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  /** A second Valkey connection, used only to hear queue changes from every replica. */
  subscriber: Redis;
  live?: { maxConnections?: number; maxPerClient?: number; heartbeatMs?: number; debounceMs?: number };
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildQueueApp(deps: QueueAppDeps): { app: Express; queue: QueueService; live: LiveHub } {
  const settings = new QueueSettingsService(deps.plane);
  // The queue tells the hub about changes; the hub asks the queue for the state. Streams are kept
  // by the business's internal ID (never shown: viewers name a business by public ID or slug).
  const live: LiveHub = new LiveHub({
    subscriber: deps.subscriber,
    publisher: deps.redis,
    state: (businessId) => queue.publicStateOf(BigInt(businessId)),
    ...deps.live,
  });
  const queue = new QueueService(deps.plane, (businessId) => live.notify(businessId.toString()));
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        queue,
        settings,
        live,
        plane: deps.plane,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, queue, live };
}
