import { createHttpApp, type Logger, type Readiness } from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { MediaLinks } from '@buku/media';
import type { Express } from 'express';
import { CatalogSync } from './catalog/catalog-sync.js';
import { Categories } from './categories.js';
import { registerRoutes, type SearchAnalytics } from './routes.js';
import { SearchService } from './search-service.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface SearchAppDeps {
  /** Database v2 (D3): the catalog to search, the business shards to keep it from (DB-041). */
  plane: DataPlane;
  links: MediaLinks;
  analytics: SearchAnalytics;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildSearchApp(deps: SearchAppDeps): {
  app: Express;
  search: SearchService;
  /** Keeps the catalog from the business shards: the event consumer and the jobs use it. */
  sync: CatalogSync;
} {
  const catalog = deps.plane.catalog;
  if (!catalog) throw new Error('search-service needs the catalog (DataPlane useCatalog)');
  const categories = new Categories(catalog);
  const search = new SearchService(catalog, categories, deps.links);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) => registerRoutes(app, { search, categories, analytics: deps.analytics }),
  });
  return { app, search, sync: new CatalogSync(deps.plane) };
}
