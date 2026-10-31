import { AppError, type Actor } from '@buku/common';
import { assertBusinessLimitOnShard } from '@buku/billing';
import {
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import type { MediaLinks } from '@buku/media';
import { assertNotSuspended, findBookableBusiness } from '../businesses.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Staff profiles: the people customers can book. A profile may be linked to
 * an account (an employee account or the owner's), which lets that person
 * manage their own working hours. Managed by owners and managers
 * (`staff.manage`). Profiles are deactivated, never deleted: past
 * appointments point at them. Photos belong to business-service (D-055) and
 * are read here only to show them. A linked account is named by its public ID (DB-042).
 */

export interface StaffInput {
  displayName: string;
  bio?: string | null | undefined;
  specializations?: string[] | undefined;
  /** Link to an account (its public ID): must be the owner or a member of this business. */
  userId?: string | null | undefined;
  /** Services this person performs (replaces the current list). */
  serviceIds?: bigint[] | undefined;
}

const staffInclude = {
  services: { select: { serviceId: true } },
  photo: { select: { storageKey: true } },
} as const;

type StaffRow = {
  id: bigint;
  userId: bigint | null;
  displayName: string;
  bio: string | null;
  specializations: string[];
  isActive: boolean;
  services: { serviceId: bigint }[];
  photo: { storageKey: string } | null;
};

export class StaffService {
  constructor(
    private readonly plane: DataPlane,
    private readonly links: MediaLinks,
  ) {}

  /** "Choose who you'd like": active staff with photo and the services they do. */
  async publicList(idOrSlug: string) {
    const business = await findBookableBusiness(this.plane, idOrSlug);
    const staff = await this.plane.inBusiness(business.id, (tx) =>
      tx.staff.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: { displayName: 'asc' },
        include: {
          ...staffInclude,
          services: { where: { service: { isActive: true } }, select: { serviceId: true } },
        },
      }),
    );
    return Promise.all(staff.map((s) => this.publicView(s)));
  }

  async manageList(businessId: bigint, actor: Actor) {
    const staff = await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return tx.staff.findMany({
        where: { businessId },
        orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
        include: staffInclude,
      });
    });
    const people = await this.publicIdsOf(staff.map((s) => s.userId));
    return Promise.all(staff.map((s) => this.manageView(s, people)));
  }

  async create(businessId: bigint, actor: Actor, input: StaffInput, ctx: RequestContext) {
    const userId = await this.accountOf(input.userId);
    try {
      const staff = await this.plane.inBusiness(businessId, async (tx) => {
        await authorize(tx, businessId, actor);
        if (userId) await assertTeamAccount(tx, businessId, userId);
        await assertBusinessLimitOnShard(tx, businessId, 'staff_profiles', () =>
          tx.staff.count({ where: { businessId, isActive: true } }),
        );
        const id = this.plane.id();
        await tx.staff.create({
          data: {
            id,
            businessId,
            displayName: input.displayName,
            bio: input.bio ?? null,
            specializations: input.specializations ?? [],
            userId: userId ?? null,
          },
        });
        if (input.serviceIds) await setServices(tx, businessId, id, input.serviceIds);
        await this.audit(tx, actor.id, 'booking.staff_created', id, ctx);
        return tx.staff.findUniqueOrThrow({ where: { id }, include: staffInclude });
      });
      return this.manageView(staff, await this.publicIdsOf([staff.userId]));
    } catch (err) {
      throw linkedTwice(err);
    }
  }

  async update(
    businessId: bigint,
    staffId: bigint,
    actor: Actor,
    patch: Partial<StaffInput> & { isActive?: boolean | undefined },
    ctx: RequestContext,
  ) {
    const userId = patch.userId === undefined ? undefined : await this.accountOf(patch.userId);
    try {
      const staff = await this.plane.inBusiness(businessId, async (tx) => {
        await authorize(tx, businessId, actor);
        const current = await find(tx, businessId, staffId);
        if (userId) await assertTeamAccount(tx, businessId, userId);
        const reactivating = patch.isActive === true && !current.isActive;
        const { serviceIds, userId: _publicId, ...fields } = patch;
        const data = {
          ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
          ...(userId !== undefined && { userId }),
        };
        if (reactivating) {
          await assertBusinessLimitOnShard(tx, businessId, 'staff_profiles', () =>
            tx.staff.count({ where: { businessId, isActive: true } }),
          );
        }
        await tx.staff.update({ where: { id: staffId }, data });
        if (serviceIds) await setServices(tx, businessId, staffId, serviceIds);
        await this.audit(tx, actor.id, 'booking.staff_updated', staffId, ctx, {
          fields: [...Object.keys(data), ...(serviceIds ? ['serviceIds'] : [])],
        });
        return tx.staff.findUniqueOrThrow({ where: { id: staffId }, include: staffInclude });
      });
      return this.manageView(staff, await this.publicIdsOf([staff.userId]));
    } catch (err) {
      throw linkedTwice(err);
    }
  }

  /** No longer bookable or listed; history stays. */
  async deactivate(businessId: bigint, staffId: bigint, actor: Actor, ctx: RequestContext) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      await find(tx, businessId, staffId);
      await tx.staff.update({ where: { id: staffId }, data: { isActive: false } });
      await this.audit(tx, actor.id, 'booking.staff_deactivated', staffId, ctx);
    });
  }

  /**
   * Someone left the team (event from auth-service): their profile is no
   * longer bookable and no longer linked to their (closed) account. Idempotent.
   */
  async detachMember(businessId: bigint, userId: bigint): Promise<number> {
    const { count } = await this.plane.inBusiness(businessId, (tx) =>
      tx.staff.updateMany({ where: { businessId, userId }, data: { isActive: false, userId: null } }),
    );
    return count;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The internal ID of the account named by a public ID (null unlinks); 400 for nobody. */
  private async accountOf(publicId: string | null | undefined): Promise<bigint | null | undefined> {
    if (publicId === undefined || publicId === null) return publicId;
    const id = await this.plane.idOfPublic('user', publicId);
    if (id === null) throw AppError.badRequest('The account to link must belong to this business’s team');
    return id;
  }

  /** Linked accounts' public IDs, read on their shards. */
  private async publicIdsOf(userIds: (bigint | null)[]): Promise<Map<bigint, string>> {
    const found = new Map<bigint, string>();
    const ids = userIds.filter((id): id is bigint => id !== null);
    for (const [db, onShard] of await this.plane.usersByShard(ids)) {
      for (const u of await db.user.findMany({
        where: { id: { in: onShard } },
        select: { id: true, publicId: true },
      }))
        found.set(u.id, u.publicId);
    }
    return found;
  }

  private async publicView(s: StaffRow) {
    return {
      id: s.id.toString(),
      displayName: s.displayName,
      bio: s.bio,
      specializations: s.specializations,
      photoUrl: s.photo ? await this.links.publicUrl(s.photo.storageKey) : null,
      serviceIds: s.services.map((x) => x.serviceId.toString()),
    };
  }

  private async manageView(s: StaffRow, people: Map<bigint, string>) {
    return {
      ...(await this.publicView(s)),
      userId: s.userId === null ? null : (people.get(s.userId) ?? null),
      isActive: s.isActive,
    };
  }

  private audit(
    tx: BusinessTx,
    userId: bigint,
    action: string,
    staffId: bigint,
    ctx: RequestContext,
    newValues?: { fields: string[] },
  ) {
    return recordShardAudit(tx, this.plane.id(), {
      userId,
      action,
      resourceType: 'staff',
      resourceId: staffId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}

async function setServices(tx: BusinessTx, businessId: bigint, staffId: bigint, serviceIds: bigint[]) {
  const unique = [...new Set(serviceIds)];
  const found = await tx.service.count({ where: { businessId, id: { in: unique } } });
  if (found !== unique.length) throw AppError.notFound('Service');
  await tx.staffService.deleteMany({ where: { staffId } });
  if (unique.length)
    await tx.staffService.createMany({
      data: unique.map((serviceId) => ({ staffId, serviceId, businessId })),
    });
}

/**
 * Only the owner or a current member can be linked to a profile of this
 * business. Checked on the team itself, not with the person's business role: a new
 * employee still on their temporary password has no business ACCESS yet,
 * but the owner sets up their profile before handing the password over.
 */
async function assertTeamAccount(tx: BusinessTx, businessId: bigint, userId: bigint) {
  const business = await tx.business.findFirst({
    where: { id: businessId },
    select: { ownerUserId: true, members: { where: { userId, status: 'active' }, select: { id: true } } },
  });
  if (business?.ownerUserId !== userId && !business?.members.length) {
    throw AppError.badRequest('The account to link must belong to this business’s team');
  }
}

async function authorize(tx: BusinessTx, businessId: bigint, actor: Actor) {
  await requireBusinessPermissionOnShard(tx, businessId, actor, 'staff.manage');
  await assertNotSuspended(tx, businessId);
}

async function find(tx: BusinessTx, businessId: bigint, staffId: bigint) {
  const staff = await tx.staff.findFirst({ where: { id: staffId, businessId } });
  if (!staff) throw AppError.notFound('Staff member');
  return staff;
}

function linkedTwice(err: unknown): unknown {
  return isUniqueViolation(err) ? AppError.conflict('This account already has a staff profile here') : err;
}
