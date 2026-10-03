import { createHttpApp, type Logger, type Readiness } from '@buku/common';
import type { Database } from '@buku/database';
import type { MediaLinks } from '@buku/media';
import type { Express } from 'express';
import { Categories } from './categories.js';
import { registerRoutes, type SearchAnalytics } from './routes.js';
import { SearchService } from './search-service.js';

/** All dependencies injected: index.ts builds real ones, tests build test ones. */
export interface SearchAppDeps {
  db: Database;
  links: MediaLinks;
  analytics: SearchAnalytics;
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildSearchApp(deps: SearchAppDeps): { app: Express; search: SearchService } {
  const categories = new Categories(deps.db);
  const search = new SearchService(deps.db, categories, deps.links);
  const app = createHttpApp({
    ...deps.http,
    routes: (app) => registerRoutes(app, { search, categories, analytics: deps.analytics }),
  });
  return { app, search };
}
