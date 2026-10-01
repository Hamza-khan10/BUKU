import {
  AppError,
  canManageRole,
  ErrorCodes,
  hashPassword,
  type BusinessRole,
  type MemberRole,
} from '@buku/common';
import {
  isUniqueViolation,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import type { RequestContext } from '../http/context.js';
import { auditCtx, type SessionService } from '../sessions/session-service.js';
import { generateTemporaryPassword } from './password-auth.js';

/**
 * A business's team (D-034, AWS-IAM-style). Owners and managers create
 * employee accounts — business-scoped username + temporary password — and
 * manage their role and access. Rules:
 *
 *  • permission `members.manage` (owner, manager); managers only create and
 *    manage front desk and staff (`MANAGEABLE_ROLES`);
 *  • nobody changes their own access here;
 *  • the temporary password is returned ONCE and never stored in clear;
 *  • roles are read from the database on every request (D-044), so changes
 *    apply at once. Turning an employee account off, resetting its password or
 *    removing it also ends its sessions on every device.
 */

export interface MemberSettings {
  maxMembersPerBusiness: number;
}

export interface MemberInput {
  name: string;
  username: string;
  role: MemberRole;
}

export interface MemberChanges {
  name?: string | undefined;
  role?: MemberRole | undefined;
  status?: 'active' | 'disabled' | undefined;
}

const memberInclude = {
  user: {
    select: {
      name: true,
      username: true,
      managedByBusinessId: true,
      mustChangePassword: true,
      lockedUntil: true,
      lastLoginAt: true,
    },
  },
} as const;

type MemberRow = {
  id: string;
  businessId: string;
  userId: string;
  role: MemberRole;
  status: 'active' | 'disabled';
  createdAt: Date;
  user: {
    name: string;
    username: string | null;
    managedByBusinessId: string | null;
    mustChangePassword: boolean;
    lockedUntil: Date | null;
    lastLoginAt: Date | null;
  };
};

export class MemberService {
  constructor(private readonly deps: { db: Database; sessions: SessionService; settings: MemberSettings }) {}

  async list(businessId: string, actorId: string) {
    await requireBusinessPermission(this.deps.db, businessId, actorId, 'members.manage');
    const rows = await this.deps.db.businessMember.findMany({
      where: { businessId },
      include: memberInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => toView(r as MemberRow));
  }

  async create(businessId: string, actorId: string, input: MemberInput, ctx: RequestContext) {
    const { db } = this.deps;
    const actorRole = await requireBusinessPermission(db, businessId, actorId, 'members.manage');
    assertCanManage(actorRole, input.role);
    const count = await db.businessMember.count({ where: { businessId } });
    if (count >= this.deps.settings.maxMembersPerBusiness) {
      throw AppError.conflict(
        `A business can have up to ${this.deps.settings.maxMembersPerBusiness} team accounts`,
        ErrorCodes.LIMIT_REACHED,
      );
    }
    const business = await db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    try {
      const member = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name,
            role: 'staff',
            managedByBusinessId: businessId,
            username: input.username,
            passwordHash,
            mustChangePassword: true,
            timezone: business.timezone,
            notificationPrefs: { create: {} },
          },
        });
        const member = await tx.businessMember.create({
          data: { businessId, userId: user.id, role: input.role, createdById: actorId },
          include: memberInclude,
        });
        await recordAudit(tx, {
          userId: actorId,
          action: 'business.member_created',
          resourceType: 'business_member',
          resourceId: member.id,
          newValues: { businessId, role: input.role, username: input.username },
          ...auditCtx(ctx),
        });
        return member;
      });
      return { member: toView(member), temporaryPassword };
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict(
          `The username "${input.username}" is already used in this business`,
          ErrorCodes.USERNAME_TAKEN,
        );
      }
      throw err;
    }
  }

  async update(
    businessId: string,
    memberId: string,
    actorId: string,
    changes: MemberChanges,
    ctx: RequestContext,
  ) {
    const { db } = this.deps;
    const { member, managed } = await this.target(businessId, memberId, actorId);
    if (changes.role) assertCanManage(member.actorRole, changes.role);
    if (changes.name !== undefined && !managed) {
      throw AppError.conflict('This person manages their own name in their BUKU account');
    }

    const updated = await db.$transaction(async (tx) => {
      if (changes.name !== undefined) {
        await tx.user.update({ where: { id: member.userId }, data: { name: changes.name } });
      }
      const updated = await tx.businessMember.update({
        where: { id: member.id },
        data: {
          ...(changes.role && { role: changes.role }),
          ...(changes.status && { status: changes.status }),
        },
        include: memberInclude,
      });
      await recordAudit(tx, {
        userId: actorId,
        action: 'business.member_updated',
        resourceType: 'business_member',
        resourceId: member.id,
        oldValues: { role: member.role, status: member.status },
        newValues: { businessId, ...changes },
        ...auditCtx(ctx),
      });
      if (changes.status === 'disabled' && member.status === 'active') {
        await this.signOutEmployee(tx, member.userId, managed, 'access_removed', ctx);
      }
      return updated;
    });
    return toView(updated);
  }

  /** New temporary password for an employee account (also unlocks it). Shown once. */
  async resetPassword(businessId: string, memberId: string, actorId: string, ctx: RequestContext) {
    const { member, managed } = await this.target(businessId, memberId, actorId);
    if (!managed) {
      throw AppError.conflict('This person signs in with their own BUKU account; only they can change it');
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await this.deps.db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: member.userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await recordAudit(tx, {
        userId: actorId,
        action: 'business.member_password_reset',
        resourceType: 'business_member',
        resourceId: member.id,
        newValues: { businessId },
        ...auditCtx(ctx),
      });
      await this.signOutEmployee(tx, member.userId, managed, 'password_reset', ctx);
    });
    return { temporaryPassword };
  }

  /**
   * Remove someone from the team. An employee account exists only for this
   * business, so it is closed too: credentials are erased at once (the
   * username becomes free again) and the account is anonymized after the
   * usual deletion grace period. Their past appointments stay with the business.
   */
  async remove(businessId: string, memberId: string, actorId: string, ctx: RequestContext): Promise<void> {
    const { member, managed } = await this.target(businessId, memberId, actorId);
    await this.deps.db.$transaction(async (tx) => {
      await tx.businessMember.delete({ where: { id: member.id } });
      if (managed) {
        await tx.user.update({
          where: { id: member.userId },
          data: {
            deletedAt: new Date(),
            username: null,
            passwordHash: null,
            mustChangePassword: false,
            failedLoginCount: 0,
            lockedUntil: null,
          },
        });
        await tx.pushToken.deleteMany({ where: { userId: member.userId } });
      }
      await recordAudit(tx, {
        userId: actorId,
        action: 'business.member_removed',
        resourceType: 'business_member',
        resourceId: member.id,
        oldValues: { businessId, role: member.role, username: member.user.username },
        ...auditCtx(ctx),
      });
      await this.signOutEmployee(tx, member.userId, managed, 'access_removed', ctx);
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** The member being acted on, after checking the actor may act on them. */
  private async target(businessId: string, memberId: string, actorId: string) {
    const actorRole = await requireBusinessPermission(this.deps.db, businessId, actorId, 'members.manage');
    const row = await this.deps.db.businessMember.findFirst({
      where: { id: memberId, businessId },
      include: memberInclude,
    });
    if (!row) throw AppError.notFound('Team member');
    const member = { ...(row as MemberRow), actorRole };
    if (member.userId === actorId) throw AppError.forbidden('You cannot change your own access');
    assertCanManage(actorRole, member.role);
    return { member, managed: member.user.managedByBusinessId === businessId };
  }

  /**
   * End an employee account's sessions everywhere. A personal BUKU account
   * that is a member keeps its sessions: it loses this business's access
   * immediately anyway (roles are read on every request), and the rest of
   * the person's account is none of this business's concern.
   */
  private async signOutEmployee(
    tx: Transaction,
    userId: string,
    managed: boolean,
    reason: 'access_removed' | 'password_reset',
    ctx: RequestContext,
  ): Promise<void> {
    if (managed) await this.deps.sessions.endAllSessions(userId, reason, ctx, tx);
  }
}

function assertCanManage(actor: BusinessRole, target: MemberRole): void {
  if (!canManageRole(actor, target)) {
    throw AppError.forbidden(
      actor === 'manager'
        ? 'Managers can only manage front desk and staff accounts'
        : 'You do not have permission to manage this team member',
    );
  }
}

function toView(r: MemberRow) {
  const managed = r.user.managedByBusinessId === r.businessId;
  return {
    id: r.id,
    userId: r.userId,
    name: r.user.name,
    role: r.role,
    status: r.status,
    accountType: managed ? ('employee' as const) : ('personal' as const),
    username: managed ? r.user.username : null,
    /** Still on the temporary password: no business access until it is changed. */
    passwordChangePending: managed && r.user.mustChangePassword,
    locked: r.user.lockedUntil !== null && r.user.lockedUntil > new Date(),
    lastSignInAt: r.user.lastLoginAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
