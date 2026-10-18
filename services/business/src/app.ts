import {
  createHttpApp,
  type BlindIndexer,
  type FieldCipher,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
} from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import { AdminService } from './businesses/admin-service.js';
import { BusinessService, type BusinessServiceSettings } from './businesses/business-service.js';
import { CategoryService } from './categories/category-service.js';
import { LegalService } from './legal/legal-service.js';
import type { MediaLinks, ObjectStorage, PictureUploads } from '@buku/media';
import { DocumentService, type DocumentSettings } from './media/document-service.js';
import { PictureService } from './media/picture-service.js';
import { registerRoutes } from './routes/index.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface BusinessAppDeps {
  /** Database v2 (D3): the directory, the shards, IDs — signed in as business-service's own role. */
  plane: DataPlane;
  redis: Redis;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  storage: ObjectStorage;
  pictureUploads: PictureUploads;
  mediaLinks: MediaLinks;
  settings: BusinessServiceSettings & DocumentSettings;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export interface BusinessApp {
  app: Express;
  /** Exposed for the event consumer (index.ts) and tests. */
  pictures: PictureService;
}

export function buildBusinessApp(deps: BusinessAppDeps): BusinessApp {
  const { plane } = deps;
  const categories = new CategoryService(plane);
  const businesses = new BusinessService(plane, categories, deps.settings);
  const legal = new LegalService(plane, deps.cipher, deps.indexer);
  const documents = new DocumentService(plane, deps.storage, deps.settings);
  const pictures = new PictureService(plane, deps.storage, deps.pictureUploads, deps.mediaLinks);
  const admin = new AdminService(plane, legal);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        businesses,
        categories,
        legal,
        documents,
        pictures,
        admin,
        plane,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
      }),
  });
  return { app, pictures };
}
