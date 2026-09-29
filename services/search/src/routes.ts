import type { Client as ElasticsearchClient } from '@elastic/elasticsearch';
import type { Express } from 'express';
import type { JwtVerifier } from '@buku/common';
import type { Database } from '@buku/database';
import type { EventProducer } from '@buku/kafka';

/** Everything a route handler may use. Constructed once in index.ts. */
export interface ServiceDeps {
  db: Database;
  elasticsearch: ElasticsearchClient;
  producer: EventProducer;
  verifier: JwtVerifier;
}

/**
 * HTTP routes for search-service.
 *
 * Phase 1 ships the service skeleton only (health, readiness, metrics,
 * security baseline). Phase 2 mounts the business endpoints here:
 *   /v1/businesses/{search,nearby,autocomplete,featured,trending},
 *   /v1/categories, /v1/categories/:slug[/businesses]; Kafka consumers for re-indexing
 */
export function registerRoutes(_app: Express, _deps: ServiceDeps): void {
  // Intentionally empty until Phase 2 — see docs/BUILD_GUIDE.md.
}
