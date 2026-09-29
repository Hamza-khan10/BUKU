import type { Express } from 'express';
import type { BlindIndexer, FieldCipher, JwtSigner, JwtVerifier } from '@buku/common';
import type { Database } from '@buku/database';
import type { EventProducer } from '@buku/kafka';
import type { Redis } from 'ioredis';

/** Everything a route handler may use. Constructed once in index.ts. */
export interface ServiceDeps {
  db: Database;
  redis: Redis;
  producer: EventProducer;
  verifier: JwtVerifier;
  signer: JwtSigner;
  fieldCipher: FieldCipher;
  blindIndexer: BlindIndexer;
}

/**
 * HTTP routes for auth-service.
 *
 * Phase 1 ships the service skeleton only (health, readiness, metrics,
 * security baseline). Phase 2 mounts the business endpoints here:
 *   POST /v1/auth/register, /verify-otp, /resend-otp, /login, /refresh, /logout, /logout-all,
 *   /forgot-password, /reset-password, /change-password, /oauth/{google,apple};
 *   GET|PATCH|DELETE /v1/auth/me, GET /v1/auth/me/export, POST|DELETE /v1/auth/push-token
 */
export function registerRoutes(_app: Express, _deps: ServiceDeps): void {
  // Intentionally empty until Phase 2 — see docs/BUILD_GUIDE.md.
}
