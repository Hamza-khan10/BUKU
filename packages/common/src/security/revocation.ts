import type { Redis } from 'ioredis';
import { uuidv7Timestamp } from '../ids.js';
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
 *   auth:rev:user:<userId>  → { beforeMs, reason }  tokens issued at/before `beforeMs` are dead
 *   auth:rev:sid:<sessionId> → reason              one device/session is dead
 *
 * Markers only need to live as long as the longest access token, so they
 * expire on their own and Valkey never accumulates them.
 */
export type RevocationReason =
  | 'logged_out'
  | 'logged_out_everywhere'
  | 'password_changed'
  /** A business reset an employee's password. */
  | 'password_reset'
  /** A business disabled or removed an employee's access. */
  | 'access_removed'
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
      const beforeMs = Date.now();
      await redis.set(userKey(userId), JSON.stringify({ beforeMs, reason }), 'EX', ttl);
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
        const marker = JSON.parse(userMarker) as { beforeMs?: number; before?: number; reason: string };
        // `before` (whole seconds) is the format written by earlier versions.
        const beforeMs = marker.beforeMs ?? (marker.before ?? 0) * 1000 + 999;
        if (issuedAtMs(token) <= beforeMs) return marker.reason;
      }
      return false;
    },
  };
}

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * When a token was issued, to the millisecond. Comparing whole seconds would
 * also revoke a token issued moments AFTER "sign out everywhere" within the
 * same second, e.g. signing in again right after changing the password. Our
 * jti is a UUIDv7 whose timestamp must agree with the signed `iat`; anything
 * else counts as issued at the very end of its `iat` second (the safe side).
 */
export function issuedAtMs(token: Pick<VerifiedAccessToken, 'jti' | 'iat'>): number {
  const endOfSecond = token.iat * 1000 + 999;
  if (!UUID_V7.test(token.jti)) return endOfSecond;
  const ms = uuidv7Timestamp(token.jti).getTime();
  return Math.floor(ms / 1000) === token.iat ? ms : endOfSecond;
}
