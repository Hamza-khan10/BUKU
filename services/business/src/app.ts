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
import { AdminService } from './businesses/admin-service.js';
import { BusinessService, type BusinessServiceSettings } from './businesses/business-service.js';
import { registerRoutes } from './routes/index.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BusinessAppDeps {
  db: Database;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  settings: BusinessServiceSettings;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildBusinessApp(deps: BusinessAppDeps): Express {
  const businesses = new BusinessService(deps.db, deps.settings);
  const admin = new AdminService(deps.db);
  return createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        businesses,
        admin,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
}
