import { MfaService } from './mfa/mfa-service.js';
import { AccessReview } from './admin/access-review.js';
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
import type { MediaLinks, ObjectStorage, PictureUploads } from '@buku/media';
import type { Express } from 'express';
import type { Redis } from 'ioredis';
import type { OidcVerifier } from './identity/oidc.js';
import { registerRoutes } from './routes/index.js';
import { MemberService } from './members/member-service.js';
import { PasswordAuthService } from './members/password-auth.js';
import { SessionService } from './sessions/session-service.js';
import { DataRightsService } from './users/data-rights.js';
import { AvatarService } from './users/avatar-service.js';
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
  storage: ObjectStorage;
  pictureUploads: PictureUploads;
  mediaLinks: MediaLinks;
  identity: { google: OidcVerifier | null; apple: OidcVerifier | null };
  settings: {
    termsVersion: string;
    devLoginEnabled: boolean;
    sessionIdleTimeoutDays: number;
    adminSessionIdleTimeoutHours: number;
    refreshReuseGraceSeconds: number;
    deletionGraceDays: number;
    reauthWindowMinutes: number;
    memberLoginMaxAttempts: number;
    memberLockoutMinutes: number;
    maxMembersPerBusiness: number;
  };
  http: { service: string; logger: Logger; readiness: Readiness; trustProxyHops: number; bodyLimit?: string };
}

export function buildAuthApp(deps: AuthAppDeps): { app: Express; rights: DataRightsService } {
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
  const mfa = new MfaService({ db: deps.db, redis: deps.redis, cipher: deps.cipher, sessions });
  const users = new UserService({
    mfa,
    db: deps.db,
    cipher: deps.cipher,
    indexer: deps.indexer,
    sessions,
    links: deps.mediaLinks,
    termsVersion: settings.termsVersion,
    deletionGraceDays: settings.deletionGraceDays,
  });
  const rights = new DataRightsService({
    db: deps.db,
    cipher: deps.cipher,
    users,
    sessions,
    storage: deps.storage,
    links: deps.mediaLinks,
    settings: { graceDays: settings.deletionGraceDays, reauthWindowMinutes: settings.reauthWindowMinutes },
  });

  const avatars = new AvatarService({
    db: deps.db,
    storage: deps.storage,
    uploads: deps.pictureUploads,
    links: deps.mediaLinks,
    users,
  });
  const passwords = new PasswordAuthService({
    db: deps.db,
    users,
    sessions,
    mfa,
    settings: { maxAttempts: settings.memberLoginMaxAttempts, lockoutMinutes: settings.memberLockoutMinutes },
  });
  const members = new MemberService({
    db: deps.db,
    sessions,
    settings: { maxMembersPerBusiness: settings.maxMembersPerBusiness },
  });

  const app = createHttpApp({
    ...deps.http,
    routes: (app) =>
      registerRoutes(app, {
        users,
        sessions,
        rights,
        passwords,
        members,
        avatars,
        verifier: deps.verifier,
        revocations: deps.revocations,
        redis: deps.redis,
        identity: deps.identity,
        devLoginEnabled: settings.devLoginEnabled,
        accessReview: new AccessReview({ db: deps.db, cipher: deps.cipher }),
        mfa,
      }),
  });
  return { app, rights };
}
