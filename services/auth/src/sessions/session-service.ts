import {
  AppError,
  ErrorCodes,
  generateSecureToken,
  hashToken,
  uuidv7,
  type JwtSigner,
  type RevocationReason,
  type RevocationStore,
  type Role,
} from '@buku/common';
import { recordAudit, type Database, type Transaction } from '@buku/database';
import type { RequestContext } from '../http/context.js';

/**
 * Sessions = refresh-token FAMILIES.
 *
 * Signing in creates a family (one per device) and returns:
 *   • an access token  — RS256 JWT, 15 min, carries `sid` = family id
 *   • a refresh token  — 256 random bits; only SHA-256(token) is stored
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

export interface SessionServiceDeps {
  db: Database;
  signer: JwtSigner;
  revocations: RevocationStore;
  policy: SessionPolicy;
}

interface RefreshRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  revoked_reason: string | null;
  mfa: boolean;
}

export class SessionService {
  constructor(private readonly deps: SessionServiceDeps) {}

  /**
   * Start a new session (sign-in). Pass `tx` to create it atomically with a new user;
   * `mfa` when the person passed a second factor (D-081) — the session keeps it.
   */
  async start(
    user: { id: string; role: Role },
    device: DeviceInfo,
    ctx: RequestContext,
    tx?: Transaction,
    opts: { mfa?: boolean } = {},
  ): Promise<SessionTokens> {
    const familyId = uuidv7();
    const mfa = opts.mfa === true;
    const refresh = await this.insertRefreshToken(tx ?? this.deps.db, user, familyId, device, ctx, mfa);
    return this.tokens(user, familyId, refresh, mfa);
  }

  /** The current session passed a second factor just now (step-up): mark it and issue a new access token. */
  async markMfa(
    user: { id: string; role: Role },
    familyId: string,
  ): Promise<{ accessToken: string; accessTokenExpiresAt: string }> {
    const { count } = await this.deps.db.refreshToken.updateMany({
      where: { familyId, userId: user.id, revokedAt: null },
      data: { mfa: true },
    });
    if (count === 0)
      throw new AppError('Your session has ended, please sign in again', ErrorCodes.SESSION_REVOKED, 401);
    const access = await this.deps.signer.sign({ sub: user.id, role: user.role, sid: familyId, mfa: true });
    return { accessToken: access.token, accessTokenExpiresAt: access.expiresAt.toISOString() };
  }

  /** Exchange a refresh token for a new pair (rotation). */
  async refresh(presented: string, ctx: RequestContext): Promise<SessionTokens> {
    const tokenHash = hashToken(presented);
    const outcome = await this.deps.db.$transaction(async (tx) => {
      // FOR UPDATE serialises concurrent refreshes of the same token.
      const [row] = await tx.$queryRaw<RefreshRow[]>`
        SELECT id, user_id, family_id, expires_at, revoked_at, revoked_reason, mfa
        FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
      if (!row) return { kind: 'invalid' as const };

      if (row.revoked_at) {
        const rotatedRecently =
          row.revoked_reason === 'rotated' &&
          Date.now() - row.revoked_at.getTime() < this.deps.policy.reuseGraceMs;
        if (rotatedRecently) return { kind: 'race' as const };
        if (row.revoked_reason === 'rotated') {
          await this.revokeFamily(tx, row.family_id, 'reuse_detected');
          await recordAudit(tx, {
            userId: row.user_id,
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

      // Soft-deleted users are filtered out by the database client extension.
      const user = await tx.user.findUnique({
        where: { id: row.user_id },
        select: { id: true, role: true, status: true },
      });
      if (!user || user.status !== 'active') {
        await this.revokeFamily(tx, row.family_id, user ? 'account_suspended' : 'account_deleted');
        return {
          kind: 'revoked' as const,
          reason: user ? 'account_suspended' : 'account_deleted',
          familyId: row.family_id,
        };
      }

      const next = await this.insertRefreshToken(tx, user, row.family_id, undefined, ctx, row.mfa);
      await tx.refreshToken.update({
        where: { id: row.id },
        data: {
          revokedAt: new Date(),
          revokedReason: 'rotated',
          replacedById: next.id,
          lastUsedAt: new Date(),
        },
      });
      return { kind: 'ok' as const, user, familyId: row.family_id, next, mfa: row.mfa };
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
        await this.deps.revocations.revokeSession(outcome.familyId, outcome.reason as RevocationReason);
        throw new AppError('Your session has ended, please sign in again', ErrorCodes.SESSION_REVOKED, 401, {
          details: { reason: outcome.reason },
        });
      case 'invalid':
        throw new AppError('Invalid refresh token', ErrorCodes.TOKEN_INVALID, 401);
    }
  }

  /** Log out one session (by refresh token). Idempotent, and never reveals whether the token existed. */
  async logoutByRefreshToken(presented: string, ctx: RequestContext): Promise<void> {
    const row = await this.deps.db.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
      select: { userId: true, familyId: true },
    });
    if (!row) return;
    await this.endSession(row.userId, row.familyId, 'logged_out', ctx);
  }

  /** End one of the caller's own sessions. Returns false if it isn't theirs. */
  async endSession(
    userId: string,
    familyId: string,
    reason: RevocationReason,
    ctx: RequestContext,
  ): Promise<boolean> {
    const count = await this.deps.db.$transaction(async (tx) => {
      const revoked = await this.revokeFamily(tx, familyId, reason, userId);
      if (revoked > 0) {
        await recordAudit(tx, {
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
    const owned = count > 0 || (await this.deps.db.refreshToken.count({ where: { familyId, userId } })) > 0;
    if (owned) await this.deps.revocations.revokeSession(familyId, reason);
    return owned;
  }

  /**
   * End EVERY session of a user on every device: "log out everywhere",
   * password change, suspension, deletion. Access tokens die immediately too.
   */
  async endAllSessions(
    userId: string,
    reason: RevocationReason,
    ctx: RequestContext,
    tx?: Transaction,
  ): Promise<void> {
    const run = async (t: Transaction) => {
      await t.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: reason },
      });
      await recordAudit(t, {
        userId,
        action: 'auth.all_sessions_ended',
        resourceType: 'user',
        resourceId: userId,
        newValues: { reason },
        ...auditCtx(ctx),
      });
    };
    if (tx) await run(tx);
    else await this.deps.db.$transaction(run);
    await this.deps.revocations.revokeAllForUser(userId, reason);
  }

  /** When the user actually signed in on this session (not the last refresh). */
  async signedInAt(userId: string, familyId: string): Promise<Date | null> {
    const first = await this.deps.db.refreshToken.findFirst({
      where: { familyId, userId },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    return first?.createdAt ?? null;
  }

  /** Active sessions (devices) of a user, newest activity first. */
  async list(userId: string) {
    const rows = await this.deps.db.refreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { familyId: true, deviceInfo: true, ipAddress: true, userAgent: true, createdAt: true },
    });
    // The first-ever token of each family carries the sign-in time.
    const firstSeen = await this.deps.db.refreshToken.groupBy({
      by: ['familyId'],
      where: { familyId: { in: rows.map((r) => r.familyId) } },
      _min: { createdAt: true },
    });
    const started = new Map(firstSeen.map((f) => [f.familyId, f._min.createdAt]));
    return rows.map((r) => ({
      id: r.familyId,
      device: r.deviceInfo as DeviceInfo | null,
      ipAddress: maskIp(r.ipAddress),
      userAgent: r.userAgent,
      signedInAt: started.get(r.familyId) ?? r.createdAt,
      lastActiveAt: r.createdAt,
    }));
  }

  // ── internals ──────────────────────────────────────────────────────────

  private async insertRefreshToken(
    db: Database | Transaction,
    user: { id: string; role: Role },
    familyId: string,
    device: DeviceInfo | undefined,
    ctx: RequestContext,
    mfa: boolean,
  ) {
    const token = generateSecureToken();
    const expiresAt = new Date(Date.now() + this.deps.policy.idleTimeoutMs(user.role));
    const previous = device
      ? undefined
      : await db.refreshToken.findFirst({
          where: { familyId },
          orderBy: { createdAt: 'desc' },
          select: { deviceInfo: true },
        });
    const row = await db.refreshToken.create({
      data: {
        userId: user.id,
        familyId,
        tokenHash: hashToken(token),
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

  private async revokeFamily(
    tx: Transaction,
    familyId: string,
    reason: string,
    userId?: string,
  ): Promise<number> {
    const { count } = await tx.refreshToken.updateMany({
      where: { familyId, revokedAt: null, ...(userId && { userId }) },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return count;
  }

  private async tokens(
    user: { id: string; role: Role },
    familyId: string,
    refresh: { token: string; expiresAt: Date },
    mfa: boolean,
  ): Promise<SessionTokens> {
    const access = await this.deps.signer.sign({ sub: user.id, role: user.role, sid: familyId, mfa });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.toISOString(),
      sessionId: familyId,
    };
  }
}

export function auditCtx(ctx: RequestContext) {
  return { ipAddress: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
}

/** Show users roughly where a session is, without storing/echoing full IPs to clients. */
function maskIp(ip: string | null): string | null {
  if (!ip) return null;
  if (ip.includes('.')) return ip.split('.').slice(0, 2).join('.') + '.x.x';
  return ip.split(':').slice(0, 3).join(':') + '::';
}
