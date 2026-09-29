import type { ClickHouseClient } from '@clickhouse/client';
import type { Express } from 'express';
import type { JwtVerifier } from '@buku/common';
import type { EventProducer } from '@buku/kafka';

/** Everything a route handler may use. Constructed once in index.ts. */
export interface ServiceDeps {
  clickhouse: ClickHouseClient;
  producer: EventProducer;
  verifier: JwtVerifier;
}

/**
 * HTTP routes for analytics-service.
 *
 * Phase 1 ships the service skeleton only (health, readiness, metrics,
 * security baseline). Phase 2 mounts the business endpoints here:
 *   /v1/businesses/:id/analytics/{overview,bookings,peak-hours,revenue,staff,no-show,customers},
 *   /v1/admin/analytics/platform; Kafka → ClickHouse batch ingestion
 */
export function registerRoutes(_app: Express, _deps: ServiceDeps): void {
  // Intentionally empty until Phase 2 — see docs/BUILD_GUIDE.md.
}
