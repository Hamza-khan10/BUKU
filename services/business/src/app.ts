import {
  createHttpApp,
  type BlindIndexer,
  type FieldCipher,
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
import { LegalService } from './legal/legal-service.js';
import { MediaService, type MediaSettings } from './media/media-service.js';
import { registerRoutes } from './routes/index.js';
import type { ObjectStorage } from './storage/object-storage.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BusinessAppDeps {
  db: Database;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  storage: ObjectStorage;
  settings: BusinessServiceSettings & MediaSettings;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildBusinessApp(deps: BusinessAppDeps): Express {
  const businesses = new BusinessService(deps.db, deps.settings);
  const legal = new LegalService(deps.db, deps.cipher, deps.indexer);
  const media = new MediaService(deps.db, deps.storage, deps.settings);
  const admin = new AdminService(deps.db, legal);
  return createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        businesses,
        legal,
        media,
        admin,
        db: deps.db,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
}
