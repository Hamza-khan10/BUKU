import {
  AppError,
  ErrorCodes,
  normalizeEmail,
  recordSecurityEvent,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import { recordShardAudit, type DataPlane } from '@buku/database';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { SessionService } from '../sessions/session-service.js';
import { CONTEXT } from '../users/user-service.js';

/** One person's account, as an operator sees it. */
export interface AccountView {
  id: string;
  name: string;
  email: string | null;
  role: string;
  /** active | suspended | deleted */
  status: string;
  since: string;
  lastSignIn: string | null;
  /** Erasure asked for: the date it was (the account is hidden; signing in again restores it). */
  deletionRequested: string | null;
  twoStep: boolean;
  /** Sessions still open (devices signed in). */
  sessions: number;
  /** An employee login a business made, not a person's own account. */
  employeeLogin: boolean;
  businesses: { id: string | null; name: string; role: string; status: string }[];
}

type Lookup = { email: string } | { id: string };

/**
 * Accounts for platform admins (3.6): find one person, then suspend them (signed out everywhere
 * at once, can't sign in), reinstate them, or end their sessions (a stolen phone). Operators look
 * people up one at a time, by email or ID — there is no list of everyone — and every look and
 * every step is recorded on the admin's own audit trail; steps also on the person's.
 *
 * Platform admins can't be suspended here: a compromised admin account must not be able to lock
 * the other admins out. Their access is removed first (`pnpm admin:role`, D-080), then they're
 * an ordinary account.
 */
export class AccountControl {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      cipher: FieldCipher;
      indexer: BlindIndexer;
      sessions: SessionService;
    },
  ) {}

  async find(lookup: Lookup, adminId: bigint, ctx: RequestContext): Promise<AccountView> {
    const userId = await this.idOf(lookup);
    const view = userId === null ? null : await this.view(userId);
    await auditPerson(this.deps.plane, adminId, {
      userId: adminId,
      action: 'admin.account_looked_up',
      resourceType: 'user',
      ...(userId !== null && { resourceId: userId }),
      newValues: { by: 'email' in lookup ? 'email' : 'id', found: view !== null },
      ...auditCtx(ctx),
    });
    if (!view) throw AppError.notFound('Account');
    return view;
  }

  async suspend(
    publicId: string,
    reason: string,
    adminId: bigint,
    ctx: RequestContext,
  ): Promise<AccountView> {
    const userId = await this.target(publicId, adminId);
    const db = await this.deps.plane.user(userId);
    await db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { status: true, deletedAt: true },
      });
      if (user.deletedAt || user.status === 'deleted')
        throw AppError.conflict('This account is deleted or being deleted');
      if (user.status === 'suspended') throw AppError.conflict('This account is already suspended');
      await tx.user.update({ where: { id: userId }, data: { status: 'suspended' } });
      // On the person's record: who did it (the admin) and to whom. The admin's record says the same
      // as `admin.account_suspended`; the names differ so the audit log never shows it twice.
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId: adminId,
        action: 'account.suspended',
        resourceType: 'user',
        resourceId: userId,
        oldValues: { status: user.status },
        newValues: { status: 'suspended', reason },
        ...auditCtx(ctx),
      });
      // Every session ends with it, and access tokens stop working at once.
      await this.deps.sessions.endAllSessions(userId, 'account_suspended', ctx, tx);
    });
    await this.adminTrail(adminId, 'admin.account_suspended', userId, { reason }, ctx);
    recordSecurityEvent('account_suspended_by_admin');
    return this.viewOrThrow(userId);
  }

  async reinstate(
    publicId: string,
    reason: string | undefined,
    adminId: bigint,
    ctx: RequestContext,
  ): Promise<AccountView> {
    const userId = await this.target(publicId, adminId);
    const db = await this.deps.plane.user(userId);
    await db.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { status: true } });
      if (user.status !== 'suspended') throw AppError.conflict('This account isn’t suspended');
      await tx.user.update({ where: { id: userId }, data: { status: 'active' } });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId: adminId,
        action: 'account.reinstated',
        resourceType: 'user',
        resourceId: userId,
        oldValues: { status: 'suspended' },
        newValues: { status: 'active', reason: reason ?? null },
        ...auditCtx(ctx),
      });
    });
    await this.adminTrail(adminId, 'admin.account_reinstated', userId, { reason: reason ?? null }, ctx);
    return this.viewOrThrow(userId);
  }

  /** Sign the person out everywhere; the account stays usable (they sign in again). */
  async endSessions(
    publicId: string,
    reason: string,
    adminId: bigint,
    ctx: RequestContext,
  ): Promise<AccountView> {
    const userId = await this.target(publicId, adminId);
    await this.deps.sessions.endAllSessions(userId, 'ended_by_admin', ctx);
    await this.adminTrail(adminId, 'admin.sessions_ended', userId, { reason }, ctx);
    recordSecurityEvent('sessions_ended_by_admin');
    return this.viewOrThrow(userId);
  }

  /** The person a step is for: someone else, not a platform admin. */
  private async target(publicId: string, adminId: bigint): Promise<bigint> {
    const userId = await this.deps.plane.idOfPublic('user', publicId);
    const db = userId === null ? null : await this.deps.plane.user(userId).catch(() => null);
    const user = await db?.user.findUnique({ where: { id: userId! }, select: { role: true } });
    if (!user || userId === null) throw AppError.notFound('Account');
    if (userId === adminId) throw AppError.badRequest('You can’t do this to your own account');
    if (user.role === 'super_admin')
      throw new AppError(
        'Platform admins can’t be suspended or signed out here. Remove their admin access first (pnpm admin:role), then they’re an ordinary account.',
        ErrorCodes.FORBIDDEN,
        403,
      );
    return userId;
  }

  private async idOf(lookup: Lookup): Promise<bigint | null> {
    const { plane, indexer } = this.deps;
    if ('id' in lookup) return plane.idOfPublic('user', lookup.id);
    return plane.handles.find('user.email', indexer.digest16(CONTEXT.email, normalizeEmail(lookup.email)));
  }

  private async viewOrThrow(userId: bigint): Promise<AccountView> {
    const view = await this.view(userId);
    if (!view) throw AppError.notFound('Account');
    return view;
  }

  private async view(userId: bigint): Promise<AccountView | null> {
    const { plane, cipher } = this.deps;
    const db = await plane.user(userId).catch(() => null);
    const user = await db?.user.findUnique({
      where: { id: userId },
      select: {
        publicId: true,
        name: true,
        emailEnc: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        deletedAt: true,
        purgedAt: true,
        managedByBusinessId: true,
        mfa: { select: { confirmedAt: true } },
        businessRoles: { select: { businessId: true, businessName: true, role: true, status: true } },
      },
    });
    if (!db || !user || user.purgedAt) return null;
    const sessions = await db.refreshToken.groupBy({
      by: ['familyId'],
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
    return {
      id: user.publicId,
      name: user.name,
      email: user.emailEnc ? cipher.decryptBytes(user.emailEnc, CONTEXT.email) : null,
      role: user.role,
      status: user.status,
      since: user.createdAt.toISOString(),
      lastSignIn: user.lastLoginAt?.toISOString() ?? null,
      deletionRequested: user.deletedAt?.toISOString() ?? null,
      twoStep: Boolean(user.mfa?.confirmedAt),
      sessions: sessions.length,
      employeeLogin: user.managedByBusinessId !== null,
      businesses: await Promise.all(
        user.businessRoles.map(async (b) => ({
          id: await plane.businessPublicId(b.businessId).catch(() => null),
          name: b.businessName,
          role: b.role,
          status: b.status,
        })),
      ),
    };
  }

  private async adminTrail(
    adminId: bigint,
    action: string,
    userId: bigint,
    values: Record<string, unknown>,
    ctx: RequestContext,
  ) {
    await auditPerson(this.deps.plane, adminId, {
      userId: adminId,
      action,
      resourceType: 'user',
      resourceId: userId,
      newValues: values,
      ...auditCtx(ctx),
    });
  }
}
