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
import { AccountService } from './account-service.js';
import { CatalogService } from './catalog-service.js';
import type { PaddleClient } from './paddle/client.js';
import { StoreService, type PaddleConfig } from './store-service.js';
import { registerRoutes } from './routes/index.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BillingAppDeps {
  /** Database v2 (D3): the directory, the shards, IDs — signed in as billing-service's own role. */
  plane: DataPlane;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  /** Both null when Paddle isn't configured (no online checkout). */
  paddle: { client: PaddleClient; config: PaddleConfig } | null;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildBillingApp(deps: BillingAppDeps): { app: Express; accounts: AccountService } {
  const accounts = new AccountService(deps.plane);
  const store = new StoreService(deps.plane, deps.paddle?.client ?? null, deps.paddle?.config ?? null);
  const app = createHttpApp({
    ...deps.http,
    // Paddle signs the exact body bytes.
    keepRawBody: true,
    routes: (app) =>
      registerRoutes(app, {
        plane: deps.plane,
        catalog: new CatalogService(deps.plane),
        accounts,
        store,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, accounts };
}
