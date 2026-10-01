import {
  createHttpApp,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { Database } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { QueueService } from './queue-service.js';
import { registerRoutes } from './routes/index.js';
import { QueueSettingsService } from './settings.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface QueueAppDeps {
  db: Database;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildQueueApp(deps: QueueAppDeps): { app: Express; queue: QueueService } {
  const settings = new QueueSettingsService(deps.db);
  const queue = new QueueService(deps.db, settings);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        queue,
        settings,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, queue };
}
