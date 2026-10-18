import { assertBusinessLimitOnShard } from '@buku/billing';
import {
  AppError,
  canManageRole,
  ErrorCodes,
  hashPassword,
  publicId,
  type BlindIndexer,
  type BusinessRole,
  type MemberRole,
} from '@buku/common';
import {
  employeeLoginKey,
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessShard,
  type BusinessTx,
  type DataPlane,
  type UserShardClient,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import { auditCtx } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { SessionService } from '../sessions/session-service.js';
import { pushTokenKey } from '../users/user-service.js';
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
 *
 * Database v2 (D3): the membership is the business's, on its shard; the account is the person's,
 * on theirs, with their own view of the role (user_business_roles); the username is a global
 * handle (`user.employee_login`). A step on one shard that fails after a step on another is undone.
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

/** Who is acting: from their token (a temporary password gives no business role, D-034). */
export interface MemberActor {
  id: bigint;
  mustChangePassword: boolean;
}

type Member = BusinessShard.BusinessMember;

/** What the team list shows about a member's account, read on their shard. */
interface Person {
  publicId: string;
  name: string;
  username: string | null;
  managedByBusinessId: bigint | null;
  mustChangePassword: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
}

const PERSON = {
  id: true,
  publicId: true,
  name: true,
  username: true,
  managedByBusinessId: true,
  mustChangePassword: true,
  lockedUntil: true,
  lastLoginAt: true,
} as const;

export class MemberService {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      sessions: SessionService;
      /** For the handles of an employee's devices, given back when the account closes. */
      indexer: BlindIndexer;
      settings: MemberSettings;
    },
  ) {}

  async list(businessId: bigint, actor: MemberActor) {
    const members = await this.deps.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'members.manage');
      return tx.businessMember.findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } });
    });
    const people = await this.people(members.map((m) => m.userId));
    return members.map((m) => toView(businessId, m, people.get(m.userId)));
  }

  async create(businessId: bigint, actor: MemberActor, input: MemberInput, ctx: RequestContext) {
    const { plane, settings } = this.deps;
    const { count, timezone } = await plane.inBusiness(businessId, async (tx) => {
      const role = await requireBusinessPermissionOnShard(tx, businessId, actor, 'members.manage');
      assertCanManage(role, input.role);
      const business = await tx.business.findFirstOrThrow({
        where: { id: businessId },
        select: { timezone: true },
      });
      return { count: await tx.businessMember.count({ where: { businessId } }), timezone: business.timezone };
    });
    if (count >= settings.maxMembersPerBusiness) {
      throw AppError.conflict(
        `A business can have up to ${settings.maxMembersPerBusiness} team accounts`,
        ErrorCodes.LIMIT_REACHED,
      );
    }

    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    const userId = plane.id();
    const memberId = plane.id();
    const pid = publicId();
    const loginKey = employeeLoginKey(businessId, input.username);
    const usernameTaken = () =>
      AppError.conflict(
        `The username "${input.username}" is already used in this business`,
        ErrorCodes.USERNAME_TAKEN,
      );

    // 1. The account, on its own shard (written first, so its handles always lead to it).
    const db = await plane.placeUser(userId);
    try {
      await db.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id: userId,
            publicId: pid,
            name: input.name,
            role: 'staff',
            managedByBusinessId: businessId,
            username: input.username,
            passwordHash,
            mustChangePassword: true,
            timezone,
          },
        });
        await tx.notificationPreference.create({ data: { userId } });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw usernameTaken();
      throw err;
    }

    // 2. The username, unique within the business on every shard; then the public ID.
    const claimed: [string, Buffer][] = [];
    const undo = async () => {
      for (const [kind, key] of claimed) await plane.handles.release(kind, key, userId);
      await db.user.delete({ where: { id: userId } });
    };
    try {
      for (const [kind, key] of [
        ['user.employee_login', loginKey],
        ['user.public_id', Buffer.from(pid, 'ascii')],
      ] as [string, Buffer][]) {
        if (!(await plane.handles.claim(kind, key, userId)).claimed) throw usernameTaken();
        claimed.push([kind, key]);
      }

      // 3. The membership, within the business's plan (Enterprise: unlimited).
      const member = await plane.inBusiness(businessId, async (tx) => {
        await assertBusinessLimitOnShard(tx, businessId, 'team_accounts', () =>
          activeMembers(tx, businessId),
        );
        const member = await tx.businessMember.create({
          data: { id: memberId, businessId, userId, role: input.role, createdById: actor.id },
        });
        await recordShardAudit(tx, plane.id(), {
          userId: actor.id,
          action: 'business.member_created',
          resourceType: 'business_member',
          resourceId: member.id,
          newValues: { businessId: businessId.toString(), role: input.role, username: input.username },
          ...auditCtx(ctx),
        });
        return member;
      });

      // 4. The person's own view of where they work.
      await this.syncRole(db, member, await this.businessName(businessId));
      const people = await this.people([userId]);
      return { member: toView(businessId, member, people.get(userId)), temporaryPassword };
    } catch (err) {
      await plane.inBusiness(businessId, (tx) => tx.businessMember.deleteMany({ where: { id: memberId } }));
      await undo();
      throw err;
    }
  }

  async update(
    businessId: bigint,
    memberId: bigint,
    actor: MemberActor,
    changes: MemberChanges,
    ctx: RequestContext,
  ) {
    const { plane } = this.deps;
    const { member, actorRole, person, managed } = await this.target(businessId, memberId, actor);
    if (changes.role) assertCanManage(actorRole, changes.role);
    if (changes.name !== undefined && !managed) {
      throw AppError.conflict('This person manages their own name in their BUKU account');
    }

    const updated = await plane.inBusiness(businessId, async (tx) => {
      // Turning an account back on counts against the plan like a new one.
      if (changes.status === 'active' && member.status === 'disabled') {
        await assertBusinessLimitOnShard(tx, businessId, 'team_accounts', () =>
          activeMembers(tx, businessId),
        );
      }
      const updated = await tx.businessMember.update({
        where: { id: member.id },
        data: {
          ...(changes.role && { role: changes.role }),
          ...(changes.status && { status: changes.status }),
        },
      });
      await recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: 'business.member_updated',
        resourceType: 'business_member',
        resourceId: member.id,
        oldValues: { role: member.role, status: member.status },
        newValues: { businessId: businessId.toString(), ...changes },
        ...auditCtx(ctx),
      });
      return updated;
    });

    // The person's side: their name (employee accounts only), their view, and their sessions.
    const db = await plane.user(member.userId);
    await db.$transaction(async (tx) => {
      if (changes.name !== undefined) {
        await tx.user.update({ where: { id: member.userId }, data: { name: changes.name } });
      }
      await tx.userBusinessRole.updateMany({
        where: { userId: member.userId, businessId },
        data: { role: updated.role, status: updated.status, version: plane.id() },
      });
      if (changes.status === 'disabled' && member.status === 'active' && managed) {
        await this.deps.sessions.endAllSessions(member.userId, 'access_removed', ctx, tx);
      }
    });
    return toView(
      businessId,
      updated,
      person && changes.name !== undefined ? { ...person, name: changes.name } : person,
    );
  }

  /** New temporary password for an employee account (also unlocks it). Shown once. */
  async resetPassword(businessId: bigint, memberId: bigint, actor: MemberActor, ctx: RequestContext) {
    const { plane } = this.deps;
    const { member, managed } = await this.target(businessId, memberId, actor);
    if (!managed) {
      throw AppError.conflict('This person signs in with their own BUKU account; only they can change it');
    }
    const temporaryPassword = generateTemporaryPassword();
    const passwordHash = await hashPassword(temporaryPassword);
    await (
      await plane.user(member.userId)
    ).$transaction(async (tx) => {
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
      await this.deps.sessions.endAllSessions(member.userId, 'password_reset', ctx, tx);
    });
    await plane.inBusiness(businessId, (tx) =>
      recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: 'business.member_password_reset',
        resourceType: 'business_member',
        resourceId: member.id,
        newValues: { businessId: businessId.toString() },
        ...auditCtx(ctx),
      }),
    );
    return { temporaryPassword };
  }

  /**
   * Remove someone from the team. An employee account exists only for this
   * business, so it is closed too: credentials are erased at once (the
   * username becomes free again) and the account is anonymized after the
   * usual deletion grace period. Their past appointments stay with the business.
   * The account side goes first: if the rest fails, removing again finishes it.
   */
  async remove(businessId: bigint, memberId: bigint, actor: MemberActor, ctx: RequestContext): Promise<void> {
    const { plane, indexer } = this.deps;
    const { member, person, managed } = await this.target(businessId, memberId, actor);
    const devices = await (
      await plane.user(member.userId)
    ).$transaction(async (tx) => {
      await tx.userBusinessRole.deleteMany({ where: { userId: member.userId, businessId } });
      if (!managed) return [];
      const devices = await tx.pushToken.findMany({
        where: { userId: member.userId },
        select: { token: true },
      });
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
      await this.deps.sessions.endAllSessions(member.userId, 'access_removed', ctx, tx);
      return devices.map((d) => d.token);
    });
    if (managed && person?.username) {
      await plane.handles.release(
        'user.employee_login',
        employeeLoginKey(businessId, person.username),
        member.userId,
      );
    }
    for (const token of devices)
      await plane.handles.release('user.push_token', pushTokenKey(indexer, token), member.userId);

    await plane.inBusiness(businessId, async (tx) => {
      await tx.businessMember.delete({ where: { id: member.id } });
      // Other services clean up what belonged to this person in the business (e.g. their photo).
      await enqueueShardEvent(
        tx,
        plane.id(),
        createEvent({
          type: TOPICS.BUSINESSES_MEMBER_REMOVED,
          source: 'auth-service',
          subject: businessId.toString(),
          data: {
            businessId: businessId.toString(),
            userId: member.userId.toString(),
            memberId: member.id.toString(),
          },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'business',
      );
      await recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: 'business.member_removed',
        resourceType: 'business_member',
        resourceId: member.id,
        oldValues: { businessId: businessId.toString(), role: member.role, username: person?.username },
        ...auditCtx(ctx),
      });
    });
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** The member being acted on, after checking the actor may act on them. */
  private async target(businessId: bigint, memberId: bigint, actor: MemberActor) {
    const { actorRole, member } = await this.deps.plane.inBusiness(businessId, async (tx) => ({
      actorRole: await requireBusinessPermissionOnShard(tx, businessId, actor, 'members.manage'),
      member: await tx.businessMember.findFirst({ where: { id: memberId, businessId } }),
    }));
    if (!member) throw AppError.notFound('Team member');
    if (member.userId === actor.id) throw AppError.forbidden('You cannot change your own access');
    assertCanManage(actorRole, member.role as MemberRole);
    const person = (await this.people([member.userId])).get(member.userId);
    return { member, actorRole, person, managed: person?.managedByBusinessId === businessId };
  }

  /** Members' accounts, read on each one's shard (one query per shard). */
  private async people(userIds: bigint[]): Promise<Map<bigint, Person>> {
    const byShard = new Map<UserShardClient, bigint[]>();
    for (const id of new Set(userIds)) {
      const db = await this.deps.plane.user(id);
      byShard.set(db, [...(byShard.get(db) ?? []), id]);
    }
    const found = new Map<bigint, Person>();
    for (const [db, ids] of byShard) {
      for (const { id, ...person } of await db.user.findMany({ where: { id: { in: ids } }, select: PERSON }))
        found.set(id, person);
    }
    return found;
  }

  private async businessName(businessId: bigint): Promise<string> {
    const business = await this.deps.plane.inBusiness(businessId, (tx) =>
      tx.business.findFirstOrThrow({ where: { id: businessId }, select: { name: true } }),
    );
    return business.name;
  }

  /** The person's view of their role at the business (on their shard, DB-014). */
  private async syncRole(db: UserShardClient, member: Member, businessName: string): Promise<void> {
    const view = { role: member.role, status: member.status, businessName, version: this.deps.plane.id() };
    await db.userBusinessRole.upsert({
      where: { userId_businessId: { userId: member.userId, businessId: member.businessId } },
      create: { userId: member.userId, businessId: member.businessId, ...view },
      update: view,
    });
  }
}

/** Team logins in use: active members (turned-off accounts don't count). */
const activeMembers = (tx: BusinessTx, businessId: bigint) =>
  tx.businessMember.count({ where: { businessId, status: 'active' } });

function assertCanManage(actor: BusinessRole, target: MemberRole): void {
  if (!canManageRole(actor, target)) {
    throw AppError.forbidden(
      actor === 'manager'
        ? 'Managers can only manage front desk and staff accounts'
        : 'You do not have permission to manage this team member',
    );
  }
}

/** A member as the team list shows it; IDs are the member's (under its business) and the person's public one. */
function toView(businessId: bigint, m: Member, person: Person | undefined) {
  const managed = person?.managedByBusinessId === businessId;
  const lockedUntil = person?.lockedUntil ?? null;
  return {
    id: m.id.toString(),
    userId: person?.publicId ?? null,
    name: person?.name ?? 'BUKU member',
    role: m.role as MemberRole,
    status: m.status as 'active' | 'disabled',
    accountType: managed ? ('employee' as const) : ('personal' as const),
    username: managed ? (person?.username ?? null) : null,
    /** Still on the temporary password: no business access until it is changed. */
    passwordChangePending: managed && (person?.mustChangePassword ?? false),
    locked: lockedUntil !== null && lockedUntil > new Date(),
    lastSignInAt: person?.lastLoginAt?.toISOString() ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
