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
 * HTTP routes for booking-service.
 *
 * Phase 1 ships the service skeleton only (health, readiness, metrics,
 * security baseline). Phase 2 mounts the business endpoints here:
 *   /v1/appointments/* (create with slot lock, confirm, cancel, reschedule, complete,
 *   no-show, timeline), /v1/businesses/:id/{appointments,availability,services,staff,
 *   availability-rules,availability-exceptions}, POST /v1/staff/accept-invite
 */
export function registerRoutes(_app: Express, _deps: ServiceDeps): void {
  // Intentionally empty until Phase 2 — see docs/BUILD_GUIDE.md.
}
