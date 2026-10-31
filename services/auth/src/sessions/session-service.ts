import {
  AppError,
  ErrorCodes,
  generateSecureToken,
  hashToken,
  idFromString,
  type JwtSigner,
  type RevocationReason,
  type RevocationStore,
  type Role,
  recordSecurityEvent,
} from '@buku/common';
import {
  recordShardAudit,
  ShardNotFoundError,
  type DataPlane,
  type UserShardClient,
  type UserTx,
} from '@buku/database';
import { auditCtx } from '../audit.js';
import type { RequestContext } from '../http/context.js';

/**
 * Sessions = refresh-token FAMILIES, on the person's own user shard (database v2, D3).
 *
 * Signing in creates a family (one per device) and returns:
 *   • an access token  — RS256 JWT, 15 min, carries `sid` = family id
 *   • a refresh token  — `<user ID>.<256 random bits>`; only SHA-256(token) is stored
 *
 * The user ID in front routes the token to the shard holding the person (it is no secret: access
 * tokens carry it too), and the hash covers the whole token, so changing that ID finds nothing.
 *
 * Each refresh ROTATES the refresh token: the presented one is marked
 * `rotated` and a new one is issued in the same family, with its expiry slid
 * forward. So a session lives "until the user logs out" (D-029) while any
 * single refresh token is single-use.
 *
 * THEFT DETECTION: if a token that was already rotated is presented again,
 * two parties hold the same session (the user and an attacker who copied
 * it). We can't tell which is which, so the whole family is revoked and the
 * user signs in again on that device. A short grace window avoids false
 * alarms when a client legitimately sends the same refresh twice (two tabs).
 */

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export interface DeviceInfo {
  name?: string | undefined;
  platform?: 'ios' | 'android' | 'web' | undefined;
}

export interface SessionPolicy {
  /** Inactivity timeout for this role, in milliseconds. */
  idleTimeoutMs(role: Role): number;
  reuseGraceMs: number;
}

/** Who a session is for: what the access token says about them. */
export interface SessionUser {
  id: bigint;
  role: Role;
  /** A business-issued temporary password not changed yet (the token's `pwc`, D-034). */
  mustChangePassword?: boolean;
}

export interface SessionServiceDeps {
  plane: DataPlane;
  signer: JwtSigner;
  revocations: RevocationStore;
  policy: SessionPolicy;
}

interface RefreshRow {
  id: bigint;
  expires_at: Date;
  family_id: bigint;
  revoked_at: Date | null;
  revoked_reason: string | null;
  mfa: boolean;
}

const REFRESH_TOKEN = /^([1-9][0-9]{0,18})\.[A-Za-z0-9_-]{43}$/;

/** The person a refresh token belongs to (its first part), or null for anything malformed. */
function ownerOf(token: string): bigint | null {
  const match = REFRESH_TOKEN.exec(token);
  return match ? idFromString(match[1]!) : null;
}

const hashOf = (token: string) => Buffer.from(hashToken(token), 'hex');

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /**
   * Start a new session (sign-in). Pass `tx` (on the person's shard) to create it atomically with
   * a new account; `mfa` when the person passed a second factor (D-081) — the session keeps it.
   */
  async start(
    user: SessionUser,
    device: DeviceInfo,
    ctx: RequestContext,
    tx?: UserTx,
    opts: { mfa?: boolean } = {},
  ): Promise<SessionTokens> {
    // Sign-in paused by an operator (D-129): platform admins still get in, to turn it back on.
    if (user.role !== 'super_admin') this.deps.plane.switches.check('signin');
    // The family is named after its first token.
    const familyId = this.deps.plane.id();
    const mfa = opts.mfa === true;
    const insert = (t: UserTx) => this.insertRefreshToken(t, user, familyId, familyId, device, ctx, mfa);
    const refresh = tx ? await insert(tx) : await (await this.shardOf(user.id)).$transaction(insert);
    return this.tokens(user, familyId, refresh, mfa);
  }

  /** The current session passed a second factor just now (step-up): mark it and issue a new access token. */
  async markMfa(
    user: SessionUser,
    familyId: bigint,
  ): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
    const db = await this.shardOf(user.id);
    const { count } = await db.refreshToken.updateMany({
      where: { familyId, userId: user.id, revokedAt: null },
      data: { mfa: true },
    });
    if (count === 0)
      throw new AppError('Your session has ended, please sign in again', ErrorCodes.SESSION_REVOKED, 401);
    const access = await this.deps.signer.sign(this.claims(user, familyId, true));
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString() };
  }

  /** Exchange a refresh token for a new pair (rotation). */
  async refresh(presented: string, ctx: RequestContext): Promise<SessionTokens> {
    const userId = ownerOf(presented);
    const db = userId === null ? null : await this.shardOf(userId).catch(notFoundToNull);
    if (userId === null || !db) throw new AppError('Invalid refresh token', ErrorCodes.TOKEN_INVALID, 401);
    const tokenHash = hashOf(presented);

    const outcome = await db.$transaction(async (tx) => {
      // FOR UPDATE serialises concurrent refreshes of the same token.
      const [row] = await tx.$queryRaw<RefreshRow[]>`
        SELECT id, expires_at, family_id, revoked_at, revoked_reason, mfa
        FROM refresh_tokens WHERE token_hash = ${tokenHash} AND user_id = ${userId} FOR UPDATE`;
      if (!row) return { kind: 'invalid' as const };

      if (row.revoked_at) {
        const rotatedRecently =
          row.revoked_reason === 'rotated' &&
          Date.now() - row.revoked_at.getTime() < this.deps.policy.reuseGraceMs;
        if (rotatedRecently) return { kind: 'race' as const };
        if (row.revoked_reason === 'rotated') {
          await this.revokeFamily(tx, userId, row.family_id, 'reuse_detected');
          recordSecurityEvent('refresh_token_reuse');
          await recordShardAudit(tx, this.deps.plane.id(), {
            userId,
            action: 'auth.refresh_token_reuse_detected',
            resourceType: 'session',
            resourceId: row.family_id,
            ...auditCtx(ctx),
          });
          return { kind: 'revoked' as const, reason: 'reuse_detected', familyId: row.family_id };
        }
        return {
          kind: 'revoked' as const,
          reason: row.revoked_reason ?? 'logged_out',
          familyId: row.family_id,
        };
      }
      if (row.expires_at.getTime() <= Date.now()) return { kind: 'expired' as const };

      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, status: true, deletedAt: true, mustChangePassword: true },
      });
      if (!user || user.deletedAt || user.status !== 'active') {
        const reason = !user || user.deletedAt ? 'account_deleted' : 'account_suspended';
        await this.revokeFamily(tx, userId, row.family_id, reason);
        return { kind: 'revoked' as const, reason, familyId: row.family_id };
      }

      // Sign-in paused (D-129): sessions aren't renewed either, so everyone but platform admins is
      // signed out within an access token's life. Thrown here, nothing about the session changes.
      if (user.role !== 'super_admin') this.deps.plane.switches.check('signin');

      const sessionUser = {
        id: user.id,
        role: user.role as Role,
        mustChangePassword: user.mustChangePassword,
      };
      const next = await this.insertRefreshToken(
        tx,
        sessionUser,
        this.deps.plane.id(),
        row.family_id,
        undefined,
        ctx,
        row.mfa,
      );
      await tx.refreshToken.updateMany({
        where: { id: row.id, expiresAt: row.expires_at },
        data: {
          revokedAt: new Date(),
          revokedReason: 'rotated',
          replacedById: next.id,
          lastUsedAt: new Date(),
        },
      });
      return { kind: 'ok' as const, user: sessionUser, familyId: row.family_id, next, mfa: row.mfa };
    });

    switch (outcome.kind) {
      case 'ok':
        return this.tokens(outcome.user, outcome.familyId, outcome.next, outcome.mfa);
      case 'race':
        throw new AppError(
          'Refresh token already used; use the newest token',
          ErrorCodes.TOKEN_INVALID,
          401,
          {
            details: { reason: 'superseded' },
          },
        );
      case 'expired':
        throw new AppError('Session expired, please sign in again', ErrorCodes.SESSION_REVOKED, 401, {
          details: { reason: 'expired' },
        });
      case 'revoked':
        // Also kill any access token still alive for that session.
        await this.deps.revocations.revokeSession(
          outcome.familyId.toString(),
          outcome.reason as RevocationReason,
        );
        throw new AppError('Your session has ended, please sign in again', ErrorCodes.SESSION_REVOKED, 401, {
          details: { reason: outcome.reason },
        });
      case 'invalid':
        throw new AppError('Invalid refresh token', ErrorCodes.TOKEN_INVALID, 401);
    }
  }

  /** Log out one session (by refresh token). Idempotent, and never reveals whether the token existed. */
  async logoutByRefreshToken(presented: string, ctx: RequestContext): Promise<void> {
    const userId = ownerOf(presented);
    const db = userId === null ? null : await this.shardOf(userId).catch(notFoundToNull);
    if (userId === null || !db) return;
    const row = await db.refreshToken.findFirst({
      where: { tokenHash: hashOf(presented), userId },
      select: { familyId: true },
    });
    if (!row) return;
    await this.endSession(userId, row.familyId, 'logged_out', ctx);
  }

  /** End one of the caller's own sessions. Returns false if it isn't theirs. */
  async endSession(
    userId: bigint,
    familyId: bigint,
    reason: RevocationReason,
    ctx: RequestContext,
  ): Promise<boolean> {
    const db = await this.shardOf(userId);
    const count = await db.$transaction(async (tx) => {
      const revoked = await this.revokeFamily(tx, userId, familyId, reason);
      if (revoked > 0) {
        await recordShardAudit(tx, this.deps.plane.id(), {
          userId,
          action: `auth.session_ended`,
          resourceType: 'session',
          resourceId: familyId,
          newValues: { reason },
          ...auditCtx(ctx),
        });
      }
      return revoked;
    });
    const owned = count > 0 || (await db.refreshToken.count({ where: { familyId, userId } })) > 0;
    if (owned) await this.deps.revocations.revokeSession(familyId.toString(), reason);
    return owned;
  }

  /**
   * End EVERY session of a user on every device: "log out everywhere",
   * password change, suspension, deletion. Access tokens die immediately too.
   * `tx`, when given, is a transaction on the person's shard.
   */
  async endAllSessions(
    userId: bigint,
    reason: RevocationReason,
    ctx: RequestContext,
    tx?: UserTx,
  ): Promise<void> {
    const run = async (t: UserTx) => {
      await t.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      await recordShardAudit(t, this.deps.plane.id(), {
        userId,
        action: 'auth.all_sessions_ended',
        resourceType: 'user',
        resourceId: userId,
        newValues: { reason },
        ...auditCtx(ctx),
      });
    };
    if (tx) await run(tx);
    else await (await this.shardOf(userId)).$transaction(run);
    await this.deps.revocations.revokeAllForUser(userId.toString(), reason);
  }

  /** When the user actually signed in on this session (not the last refresh). */
  async signedInAt(userId: bigint, familyId: bigint): Promise<Date | null> {
    const first = await (
      await this.shardOf(userId)
    ).refreshToken.findFirst({
      where: { familyId, userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first?.createdAt ?? null;
  }

  /** Active sessions (devices) of a user, newest activity first. */
  async list(userId: bigint) {
    const db = await this.shardOf(userId);
    const rows = await db.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, deviceInfo: true, ipAddress: true, userAgent: true, createdAt: true },
    });
    // The first-ever token of each family carries the sign-in time.
    const firstSeen = await db.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId, familyId: { in: rows.map((r) => r.familyId) } },
      _min: { createdAt: true },
    });
    const started = new Map(firstSeen.map((f) => [f.familyId, f._min.createdAt]));
    return rows.map((r) => ({
      id: r.familyId.toString(),
      device: r.deviceInfo as DeviceInfo | null,
      ipAddress: maskIp(r.ipAddress),
      userAgent: r.userAgent,
      signedInAt: started.get(r.familyId) ?? r.createdAt,
      lastActiveAt: r.createdAt,
    }));
  }

  // ── internals ──────────────────────────────────────────────────────────

  private shardOf(userId: bigint): Promise<UserShardClient> {
    return this.deps.plane.user(userId);
  }

  private async insertRefreshToken(
    tx: UserTx,
    user: SessionUser,
    id: bigint,
    familyId: bigint,
    device: DeviceInfo | undefined,
    ctx: RequestContext,
    mfa: boolean,
  ) {
    const token = `${user.id}.${generateSecureToken()}`;
    const expiresAt = new Date(Date.now() + this.deps.policy.idleTimeoutMs(user.role));
    const previous = device
      ? undefined
      : await tx.refreshToken.findFirst({
          where: { familyId, userId: user.id },
          orderBy: { createdAt: 'desc' },
          select: { deviceInfo: true },
        });
    const row = await tx.refreshToken.create({
      data: {
        id,
        userId: user.id,
        familyId,
        tokenHash: hashOf(token),
        deviceInfo: (device ?? previous?.deviceInfo ?? {}) as object,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
        expiresAt,
        mfa,
      },
      select: { id: true, expiresAt: true },
    });
    return { id: row.id, token, expiresAt: row.expiresAt };
  }

  private async revokeFamily(tx: UserTx, userId: bigint, familyId: bigint, reason: string): Promise<number> {
    const { count } = await tx.refreshToken.updateMany({
      where: { familyId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  private claims(user: SessionUser, familyId: bigint, mfa: boolean) {
    return {
      sub: user.id.toString(),
      role: user.role,
      sid: familyId.toString(),
      mfa,
      pwc: user.mustChangePassword === true,
    };
  }

  private async tokens(
    user: SessionUser,
    familyId: bigint,
    refresh: { token: string; expiresAt: Date },
    mfa: boolean,
  ): Promise<SessionTokens> {
    const access = await this.deps.signer.sign(this.claims(user, familyId, mfa));
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      sessionId: familyId.toString(),
    };
  }
}

/** A token naming a person no shard holds is simply not a valid token. */
function notFoundToNull(err: unknown): null {
  if (err instanceof ShardNotFoundError) return null;
  throw err;
}

/** Show users roughly where a session is, without storing/echoing full IPs to clients. */
function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.') + '.x.x';
  return ip.split(':').slice(0, 3).join(':') + '::';
}
