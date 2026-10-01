import { AppError } from '@buku/common';
import {
  isUniqueViolation,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
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
 * are read here only to show them.
 */

export interface StaffInput {
  displayName: string;
  bio?: string | null | undefined;
  specializations?: string[] | undefined;
  /** Link to an account: must be the owner or a member of this business. */
  userId?: string | null | undefined;
  /** Services this person performs (replaces the current list). */
  serviceIds?: string[] | undefined;
}

const staffInclude = {
  services: { select: { serviceId: true } },
  photo: { select: { storageKey: true } },
} as const;

type StaffRow = {
  id: string;
  userId: string | null;
  displayName: string;
  bio: string | null;
  specializations: string[];
  isActive: boolean;
  services: { serviceId: string }[];
  photo: { storageKey: string } | null;
};

export class StaffService {
  constructor(
    private readonly db: Database,
    private readonly links: MediaLinks,
  ) {}

  /** "Choose who you'd like": active staff with photo and the services they do. */
  async publicList(idOrSlug: string) {
    const business = await findBookableBusiness(this.db, idOrSlug);
    const staff = await this.db.staff.findMany({
      where: { businessId: business.id, isActive: true },
      orderBy: { displayName: 'asc' },
      include: {
        ...staffInclude,
        services: { where: { service: { isActive: true } }, select: { serviceId: true } },
      },
    });
    return Promise.all(staff.map((s) => this.publicView(s)));
  }

  async manageList(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const staff = await this.db.staff.findMany({
      where: { businessId },
      orderBy: [{ isActive: 'desc' }, { displayName: 'asc' }],
      include: staffInclude,
    });
    return Promise.all(staff.map((s) => this.manageView(s)));
  }

  async create(businessId: string, actorId: string, input: StaffInput, ctx: RequestContext) {
    await this.authorize(businessId, actorId);
    if (input.userId) await this.assertTeamAccount(businessId, input.userId);
    try {
      const staff = await this.db.$transaction(async (tx) => {
        const created = await tx.staff.create({
          data: {
            businessId,
            displayName: input.displayName,
            bio: input.bio ?? null,
            specializations: input.specializations ?? [],
            userId: input.userId ?? null,
          },
        });
        if (input.serviceIds) await this.setServices(tx, businessId, created.id, input.serviceIds);
        await this.audit(tx, actorId, 'booking.staff_created', created.id, ctx);
        return tx.staff.findUniqueOrThrow({ where: { id: created.id }, include: staffInclude });
      });
      return this.manageView(staff);
    } catch (err) {
      throw linkedTwice(err);
    }
  }

  async update(
    businessId: string,
    staffId: string,
    actorId: string,
    patch: Partial<StaffInput> & { isActive?: boolean | undefined },
    ctx: RequestContext,
  ) {
    await this.authorize(businessId, actorId);
    await this.find(businessId, staffId);
    if (patch.userId) await this.assertTeamAccount(businessId, patch.userId);
    const { serviceIds, ...fields } = patch;
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    try {
      const staff = await this.db.$transaction(async (tx) => {
        await tx.staff.update({ where: { id: staffId }, data });
        if (serviceIds) await this.setServices(tx, businessId, staffId, serviceIds);
        await this.audit(tx, actorId, 'booking.staff_updated', staffId, ctx, {
          fields: [...Object.keys(data), ...(serviceIds ? ['serviceIds'] : [])],
        });
        return tx.staff.findUniqueOrThrow({ where: { id: staffId }, include: staffInclude });
      });
      return this.manageView(staff);
    } catch (err) {
      throw linkedTwice(err);
    }
  }

  /** No longer bookable or listed; history stays. */
  async deactivate(businessId: string, staffId: string, actorId: string, ctx: RequestContext) {
    await this.authorize(businessId, actorId);
    await this.find(businessId, staffId);
    await this.db.staff.update({ where: { id: staffId }, data: { isActive: false } });
    await this.audit(this.db, actorId, 'booking.staff_deactivated', staffId, ctx);
  }

  /**
   * Someone left the team (event from auth-service): their profile is no
   * longer bookable and no longer linked to their (closed) account. Idempotent.
   */
  async detachMember(businessId: string, userId: string): Promise<number> {
    const { count } = await this.db.staff.updateMany({
      where: { businessId, userId },
      data: { isActive: false, userId: null },
    });
    return count;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async setServices(tx: Transaction, businessId: string, staffId: string, serviceIds: string[]) {
    const unique = [...new Set(serviceIds)];
    const found = await tx.service.count({ where: { businessId, id: { in: unique } } });
    if (found !== unique.length) throw AppError.notFound('Service');
    await tx.staffService.deleteMany({ where: { staffId } });
    if (unique.length)
      await tx.staffService.createMany({ data: unique.map((serviceId) => ({ staffId, serviceId })) });
  }

  /**
   * Only the owner or a current member can be linked to a profile of this
   * business. Checked on the team itself, not with `businessRoleOf`: a new
   * employee still on their temporary password has no business ACCESS yet,
   * but the owner sets up their profile before handing the password over.
   */
  private async assertTeamAccount(businessId: string, userId: string) {
    const business = await this.db.business.findFirst({
      where: { id: businessId },
      select: { ownerId: true, members: { where: { userId, status: 'active' }, select: { id: true } } },
    });
    if (business?.ownerId !== userId && !business?.members.length) {
      throw AppError.badRequest('The account to link must belong to this business’s team');
    }
  }

  private async authorize(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'staff.manage');
    await assertNotSuspended(this.db, businessId);
  }

  private async find(businessId: string, staffId: string) {
    const staff = await this.db.staff.findFirst({ where: { id: staffId, businessId } });
    if (!staff) throw AppError.notFound('Staff member');
    return staff;
  }

  private async publicView(s: StaffRow) {
    return {
      id: s.id,
      displayName: s.displayName,
      bio: s.bio,
      specializations: s.specializations,
      photoUrl: s.photo ? await this.links.publicUrl(s.photo.storageKey) : null,
      serviceIds: s.services.map((x) => x.serviceId),
    };
  }

  private async manageView(s: StaffRow) {
    return { ...(await this.publicView(s)), userId: s.userId, isActive: s.isActive };
  }

  private audit(
    db: Database | Transaction,
    userId: string,
    action: string,
    staffId: string,
    ctx: RequestContext,
    newValues?: { fields: string[] },
  ) {
    return recordAudit(db, {
      userId,
      action,
      resourceType: 'staff',
      resourceId: staffId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}

function linkedTwice(err: unknown): unknown {
  return isUniqueViolation(err) ? AppError.conflict('This account already has a staff profile here') : err;
}
