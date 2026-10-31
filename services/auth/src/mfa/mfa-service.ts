import { createHash, timingSafeEqual } from 'node:crypto';
import {
  AppError,
  ErrorCodes,
  generateSecureToken,
  idFromString,
  type FieldCipher,
  type Role,
  recordSecurityEvent,
} from '@buku/common';
import { recordShardAudit, type DataPlane } from '@buku/database';
import type { Redis } from 'ioredis';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { DeviceInfo, SessionService, SessionTokens, SessionUser } from '../sessions/session-service.js';
import { matchingStep, newRecoveryCodes, newSecret, normalizeRecoveryCode, otpauthUri } from './totp.js';

/**
 * Two-step sign-in with an authenticator app (D-081), kept on the person's own shard.
 *
 *  • SET UP: a new secret (QR code), confirmed by entering a code; ten
 *    single-use recovery codes are shown once.
 *  • SIGN IN: after Google/Apple/password, someone with MFA gets a 5-minute
 *    challenge instead of a session; a code (or a recovery code) turns it into
 *    a session marked `mfa`. A code works once (replay is refused); 5 wrong
 *    tries lock it for 15 minutes.
 *  • Platform admins must have it: admin routes refuse sessions without it,
 *    and they can't switch it off.
 *  • Everything is audited; the secret is encrypted, recovery codes hashed (SHA-256, 32 bytes).
 */

export const MFA_SECRET_CONTEXT = 'users.mfa_secret';
const CHALLENGE_SECONDS = 300;
const MAX_FAILURES = 5;
const LOCK_SECONDS = 15 * 60;

/** Proof of the second factor: a code from the app, or one of the recovery codes (used up). */
export type SecondFactor = { code?: string | undefined; recoveryCode?: string | undefined };

export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
  expiresAt: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const challengeKey = (token: string) => `mfa:challenge:${sha256(token).toString('hex')}`;

export class MfaService {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      redis: Redis;
      cipher: FieldCipher;
      sessions: SessionService;
    },
  ) {}

  // ── Sign-in ───────────────────────────────────────────────────────────────

  /** A session, or — for someone with MFA — a challenge to answer first. */
  async beginSession(
    user: SessionUser,
    device: DeviceInfo,
    ctx: RequestContext,
  ): Promise<SessionTokens | MfaChallenge> {
    const mfa = await (
      await this.deps.plane.user(user.id)
    ).userMfa.findUnique({ where: { userId: user.id }, select: { confirmedAt: true } });
    if (!mfa?.confirmedAt) return this.deps.sessions.start(user, device, ctx);
    const token = generateSecureToken();
    await this.deps.redis.set(
      challengeKey(token),
      JSON.stringify({ userId: user.id.toString(), device }),
      'EX',
      CHALLENGE_SECONDS,
    );
    return {
      mfaRequired: true,
      mfaToken: token,
      expiresAt: new Date(Date.now() + CHALLENGE_SECONDS * 1000).toISOString(),
    };
  }

  /** Answer a sign-in challenge with an authenticator code or a recovery code. */
  async verifyChallenge(
    input: { mfaToken: string; code?: string | undefined; recoveryCode?: string | undefined },
    ctx: RequestContext,
  ) {
    const expired = () => AppError.unauthorized('This sign-in has expired; please sign in again');
    const key = challengeKey(input.mfaToken);
    const raw = await this.deps.redis.get(key);
    if (!raw) throw expired();
    const challenge = JSON.parse(raw) as { userId: string; device: DeviceInfo };
    const userId = idFromString(challenge.userId);
    if (userId === null) throw expired();
    const user = await (
      await this.deps.plane.user(userId)
    ).user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, status: true, deletedAt: true, mustChangePassword: true },
    });
    if (!user || user.deletedAt || user.status !== 'active') throw expired();

    await this.checkSecondFactor(user.id, input, ctx);
    await this.deps.redis.del(key); // one use
    const session = await this.deps.sessions.start(
      { id: user.id, role: user.role as Role, mustChangePassword: user.mustChangePassword },
      challenge.device,
      ctx,
      undefined,
      { mfa: true },
    );
    await auditPerson(this.deps.plane, user.id, {
      userId: user.id,
      action: 'auth.mfa_verified',
      resourceType: 'session',
      resourceId: BigInt(session.sessionId),
      ...auditCtx(ctx),
    });
    return { userId: user.id, session };
  }

  // ── The signed-in person ──────────────────────────────────────────────────

  async status(userId: bigint, role: Role) {
    const m = await (await this.deps.plane.user(userId)).userMfa.findUnique({ where: { userId } });
    return {
      enabled: Boolean(m?.confirmedAt),
      since: m?.confirmedAt?.toISOString() ?? null,
      recoveryCodesLeft: m?.confirmedAt ? m.recoveryHashes.length : 0,
      /** Platform admins must use it. */
      required: role === 'super_admin',
    };
  }

  /** Start (or restart) setting up an app. Refused while one is already in use: turn it off first. */
  async setup(userId: bigint, accountLabel: string, ctx: RequestContext) {
    const db = await this.deps.plane.user(userId);
    const current = await db.userMfa.findUnique({ where: { userId } });
    if (current?.confirmedAt) {
      throw AppError.conflict('Two-step sign-in is already on; turn it off first to switch apps');
    }
    const secret = newSecret();
    const data = {
      secretEnc: this.deps.cipher.encryptBytes(secret, MFA_SECRET_CONTEXT),
      confirmedAt: null,
      lastUsedStep: null,
      recoveryHashes: [],
    };
    await db.userMfa.upsert({ where: { userId }, create: { userId, ...data }, update: data });
    await auditPerson(this.deps.plane, userId, {
      userId,
      action: 'mfa.setup_started',
      resourceType: 'user',
      resourceId: userId,
      ...auditCtx(ctx),
    });
    return { secret, otpauthUri: otpauthUri(secret, accountLabel) };
  }

  /**
   * Prove the app works: turns MFA on, returns the recovery codes (shown once), and marks
   * the current session as having passed MFA (a fresh access token).
   */
  async confirm(user: SessionUser, sessionId: bigint | undefined, code: string, ctx: RequestContext) {
    const db = await this.deps.plane.user(user.id);
    const m = await db.userMfa.findUnique({ where: { userId: user.id } });
    if (!m) throw AppError.notFound('Two-step sign-in setup');
    if (m.confirmedAt) throw AppError.conflict('Two-step sign-in is already on');
    await this.assertNotLocked(user.id);
    const step = matchingStep(this.deps.cipher.decryptBytes(m.secretEnc, MFA_SECRET_CONTEXT), code);
    if (step === null) return this.fail(user.id, ctx);
    const codes = newRecoveryCodes();
    await db.$transaction(async (tx) => {
      await tx.userMfa.update({
        where: { userId: user.id },
        data: {
          confirmedAt: new Date(),
          lastUsedStep: step,
          recoveryHashes: codes.map((c) => sha256(normalizeRecoveryCode(c))),
        },
      });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId: user.id,
        action: 'mfa.enabled',
        resourceType: 'user',
        resourceId: user.id,
        ...auditCtx(ctx),
      });
    });
    const upgraded = sessionId ? await this.deps.sessions.markMfa(user, sessionId) : null;
    return { enabled: true, recoveryCodes: codes, ...(upgraded && { session: upgraded }) };
  }

  /** Re-check a code during a session (e.g. an admin whose session predates MFA). */
  async stepUp(user: SessionUser, sessionId: bigint | undefined, code: string, ctx: RequestContext) {
    if (!sessionId) throw AppError.unauthorized();
    await this.checkSecondFactor(user.id, { code }, ctx);
    await auditPerson(this.deps.plane, user.id, {
      userId: user.id,
      action: 'auth.mfa_step_up',
      resourceType: 'session',
      resourceId: sessionId,
      ...auditCtx(ctx),
    });
    return this.deps.sessions.markMfa(user, sessionId);
  }

  /** New recovery codes (the old ones stop working), with a current code or a recovery code. */
  async newRecoveryCodes(userId: bigint, proof: SecondFactor, ctx: RequestContext) {
    await this.checkSecondFactor(userId, proof, ctx);
    const codes = newRecoveryCodes();
    await (
      await this.deps.plane.user(userId)
    ).userMfa.update({
      where: { userId },
      data: { recoveryHashes: codes.map((c) => sha256(normalizeRecoveryCode(c))) },
    });
    await auditPerson(this.deps.plane, userId, {
      userId,
      action: 'mfa.recovery_codes_replaced',
      resourceType: 'user',
      resourceId: userId,
      ...auditCtx(ctx),
    });
    return { recoveryCodes: codes };
  }

  /**
   * Turn it off, with a current code — or a recovery code, for someone who lost
   * the phone with the app (then they can set up a new one). Platform admins can't.
   */
  async disable(user: SessionUser, proof: SecondFactor, ctx: RequestContext) {
    if (user.role === 'super_admin') {
      throw AppError.forbidden('Platform admins must keep two-step sign-in on');
    }
    await this.checkSecondFactor(user.id, proof, ctx);
    await (
      await this.deps.plane.user(user.id)
    ).$transaction(async (tx) => {
      await tx.userMfa.delete({ where: { userId: user.id } });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId: user.id,
        action: 'mfa.disabled',
        resourceType: 'user',
        resourceId: user.id,
        ...auditCtx(ctx),
      });
    });
  }

  // ── internals ─────────────────────────────────────────────────────────────

  /** A valid, unused code — or a recovery code (used up). Failures count towards a lock. */
  private async checkSecondFactor(userId: bigint, input: SecondFactor, ctx: RequestContext): Promise<void> {
    await this.assertNotLocked(userId);
    const db = await this.deps.plane.user(userId);
    const m = await db.userMfa.findUnique({ where: { userId } });
    if (!m?.confirmedAt) throw AppError.badRequest('Two-step sign-in is not on');

    if (input.recoveryCode) {
      const hash = sha256(normalizeRecoveryCode(input.recoveryCode));
      const match = m.recoveryHashes.find((h) => h.length === hash.length && timingSafeEqual(h, hash));
      if (!match) return this.fail(userId, ctx);
      // Remove it atomically: of two simultaneous uses, only one finds it still there.
      const used = await db.$executeRaw`
        UPDATE user_mfa SET recovery_hashes = array_remove(recovery_hashes, ${Buffer.from(match)}::bytea)
        WHERE user_id = ${userId} AND ${Buffer.from(match)}::bytea = ANY(recovery_hashes)`;
      if (used === 0) return this.fail(userId, ctx);
      await auditPerson(this.deps.plane, userId, {
        userId,
        action: 'mfa.recovery_code_used',
        resourceType: 'user',
        resourceId: userId,
        newValues: { left: m.recoveryHashes.length - 1 },
        ...auditCtx(ctx),
      });
      await this.deps.redis.del(`mfa:fail:${userId}`);
      return;
    }

    const step = input.code
      ? matchingStep(this.deps.cipher.decryptBytes(m.secretEnc, MFA_SECRET_CONTEXT), input.code)
      : null;
    if (step === null) return this.fail(userId, ctx);
    // A code works once: only a step later than the last accepted one (atomic).
    const accepted = await db.$executeRaw`
      UPDATE user_mfa SET last_used_step = ${step}
      WHERE user_id = ${userId} AND (last_used_step IS NULL OR last_used_step < ${step})`;
    if (accepted === 0) return this.fail(userId, ctx);
    await this.deps.redis.del(`mfa:fail:${userId}`);
  }

  private async assertNotLocked(userId: bigint) {
    const failures = Number((await this.deps.redis.get(`mfa:fail:${userId}`)) ?? 0);
    if (failures >= MAX_FAILURES) {
      recordSecurityEvent('mfa_locked');
      throw new AppError('Too many wrong codes; try again in 15 minutes', ErrorCodes.MFA_LOCKED, 429);
    }
  }

  private async fail(userId: bigint, ctx: RequestContext): Promise<never> {
    const key = `mfa:fail:${userId}`;
    const n = await this.deps.redis.incr(key);
    if (n === 1) await this.deps.redis.expire(key, LOCK_SECONDS);
    await auditPerson(this.deps.plane, userId, {
      userId,
      action: 'auth.mfa_failed',
      resourceType: 'user',
      resourceId: userId,
      newValues: { attempt: n },
      ...auditCtx(ctx),
    });
    recordSecurityEvent('mfa_failed');
    throw new AppError('That code isn’t right', ErrorCodes.MFA_INVALID_CODE, 401);
  }
}
