import type { Express } from 'express';
import type { JwtVerifier } from '@buku/common';
import type { Database } from '@buku/database';
import type { EventProducer } from '@buku/kafka';
import type { Redis } from 'ioredis';

/** Everything a route handler may use. Constructed once in index.ts. */
export interface ServiceDeps {
  db: Database;
  redis: Redis;
  producer: EventProducer;
  verifier: JwtVerifier;
}

/**
 * HTTP routes for ads-service.
 *
 * Phase 1 ships the service skeleton only (health, readiness, metrics,
 * security baseline). Phase 2 mounts the business endpoints here:
 *   /v1/ads/* (campaign CRUD, approve/reject, click, stats, active),
 *   /v1/businesses/:id/ads, /v1/admin/ads; impression flush + budget jobs
 */
export function registerRoutes(_app: Express, _deps: ServiceDeps): void {
  // Intentionally empty until Phase 2 — see docs/BUILD_GUIDE.md.
}
