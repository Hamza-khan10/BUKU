import type { Redis } from 'ioredis';
import type { VerifiedAccessToken } from './jwt.js';

/**
 * Immediate revocation of ACCESS tokens.
 *
 * Access tokens are short-lived (15 min) JWTs that services verify without a
 * database call. Refresh tokens are revoked in Postgres, but an access token
 * already in a client's hands would stay valid until it expires. For "log out
 * everywhere" and "password changed" that is not acceptable, so auth-service
 * writes a small marker to Valkey and every service checks it per request:
 *
 *   auth:rev:user:<userId>  → { before, reason }  tokens issued at/before `before` are dead
 *   auth:rev:sid:<sessionId> → reason              one device/session is dead
 *
 * Markers only need to live as long as the longest access token, so they
 * expire on their own and Valkey never accumulates them.
 */
export type RevocationReason =
  | 'logged_out'
  | 'logged_out_everywhere'
  | 'password_changed'
  | 'reuse_detected'
  | 'revoked_by_user'
  | 'account_suspended'
  | 'account_deleted';

export interface RevocationStore {
  /** Kill every access token of `userId` issued up to now. */
  revokeAllForUser(userId: string, reason: RevocationReason): Promise<void>;
  /** Kill the access tokens of one session (one device). */
  revokeSession(sessionId: string, reason: RevocationReason): Promise<void>;
  /** For `authenticate({ isRevoked })`: false if valid, else the reason. */
  isRevoked(token: VerifiedAccessToken): Promise<false | string>;
}

const userKey = (userId: string) => `auth:rev:user:${userId}`;
const sessionKey = (sessionId: string) => `auth:rev:sid:${sessionId}`;

export function createRevocationStore(redis: Redis, accessTokenTtlSeconds = 15 * 60): RevocationStore {
  // Keep markers a little longer than any access token can live (clock skew).
  const ttl = accessTokenTtlSeconds + 120;
  return {
    async revokeAllForUser(userId, reason) {
      const before = Math.floor(Date.now() / 1000);
      await redis.set(userKey(userId), JSON.stringify({ before, reason }), 'EX', ttl);
    },
    async revokeSession(sessionId, reason) {
      await redis.set(sessionKey(sessionId), reason, 'EX', ttl);
    },
    async isRevoked(token) {
      const [userMarker, sessionMarker] = await redis.mget(
        userKey(token.sub),
        token.sid ? sessionKey(token.sid) : `auth:rev:none`,
      );
      if (sessionMarker) return sessionMarker;
      if (userMarker) {
        const { before, reason } = JSON.parse(userMarker) as { before: number; reason: string };
        if (token.iat <= before) return reason;
      }
      return false;
    },
  };
}
