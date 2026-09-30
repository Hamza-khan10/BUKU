import {
  createHttpApp,
  type BlindIndexer,
  type FieldCipher,
  type JwtSigner,
  type JwtVerifier,
  type Logger,
  type Readiness,
  type RevocationStore,
  type Role,
} from '@buku/common';
import type { Database } from '@buku/database';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import type { OidcVerifier } from './identity/oidc.js';
import { registerRoutes } from './routes/index.js';
import { SessionService } from './sessions/session-service.js';
import { UserService } from './users/user-service.js';

/**
 * Everything auth-service needs, injected. `index.ts` builds the real
 * dependencies; integration tests build test ones (local signing keys, a
 * fake Google key set) and call the same function.
 */
export interface AuthAppDeps {
  db: Database;
  redis: Redis;
  signer: JwtSigner;
  verifier: JwtVerifier;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  revocations: RevocationStore;
  identity: { google: OidcVerifier | null; apple: OidcVerifier | null };
  settings: {
    termsVersion: string;
    devLoginEnabled: boolean;
    sessionIdleTimeoutDays: number;
    adminSessionIdleTimeoutHours: number;
    refreshReuseGraceSeconds: number;
  };
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildAuthApp(deps: AuthAppDeps): Express {
  const { settings } = deps;
  const sessions = new SessionService({
    db: deps.db,
    signer: deps.signer,
    revocations: deps.revocations,
    policy: {
      idleTimeoutMs: (role: Role) =>
        role === 'super_admin'
          ? settings.adminSessionIdleTimeoutHours * 3_600_000
          : settings.sessionIdleTimeoutDays * 86_400_000,
      reuseGraceMs: settings.refreshReuseGraceSeconds * 1000,
    },
  });
  const users = new UserService({
    db: deps.db,
    cipher: deps.cipher,
    indexer: deps.indexer,
    sessions,
    termsVersion: settings.termsVersion,
  });

  return createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        users,
        sessions,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
        identity: deps.identity,
        devLoginEnabled: settings.devLoginEnabled,
      }),
  });
}
