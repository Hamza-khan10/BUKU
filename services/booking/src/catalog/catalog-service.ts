import { AppError, type Actor } from '@buku/common';
import { assertBusinessLimitOnShard } from '@buku/billing';
import {
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { assertNotSuspended, findBookableBusiness } from '../businesses.js';
import { announceListing } from '../listing.js';
import { auditCtx, type RequestContext } from '../http/context.js';
import { exponentOf, formatMinor, toMinor } from '../money.js';
import { effectiveSettings } from '../settings/settings-service.js';

/**
 * The service menu: categories ("Haircuts", "Colour") and the services in
 * them, with duration, price and who performs each. Managed by owners and
 * managers (`services.manage`). Prices are in the business's currency and
 * paid at the venue for the MVP, kept in minor units (DB-009).
 *
 * Services are never hard-deleted: past appointments point at them. Removing
 * one archives it (no longer bookable or listed publicly). On database v2 a category is a
 * service group of the business; IDs are decimal, under the business (DB-042).
 */

export interface ServiceInput {
  name: string;
  description?: string | null | undefined;
  categoryId?: bigint | null | undefined;
  durationMinutes: number;
  bufferMinutes?: number | undefined;
  price: number;
  sortOrder?: number | undefined;
  /** Staff who perform this service (replaces the current list). */
  staffIds?: bigint[] | undefined;
}

const serviceInclude = { staff: { select: { staffId: true } } } as const;

type ServiceRow = BusinessShard.Service & { staff: { staffId: bigint }[] };
type GroupRow = { id: bigint; name: string; sortOrder: number };

export class CatalogService {
  constructor(private readonly plane: DataPlane) {}

  // ── Public ───────────────────────────────────────────────────────────────

  /** The menu customers see: active services by category, plus the business's booking terms. */
  async publicMenu(idOrSlug: string) {
    const business = await findBookableBusiness(this.plane, idOrSlug);
    return this.plane.inBusiness(business.id, async (tx) => {
      const groups = await tx.serviceGroup.findMany({
        where: { businessId: business.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const services = await tx.service.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { staff: { where: { staff: { isActive: true } }, select: { staffId: true } } },
      });
      const settings = await effectiveSettings(tx, business.id);
      const exponent = await exponentOf(tx, business.currency);
      return {
        businessId: business.publicId,
        currency: business.currency,
        categories: groupByCategory(
          groups,
          services.map((s) => publicServiceView(s, exponent)),
        ),
        booking: {
          confirmationMode: settings.confirmationMode,
          bookingHorizonDays: settings.bookingHorizonDays,
          cancellationWindowHours: settings.cancellationWindowHours,
          minNoticeMinutes: settings.minNoticeMinutes,
        },
      };
    });
  }

  // ── Management ───────────────────────────────────────────────────────────

  /** Everything, archived services included. */
  async manageMenu(businessId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      const groups = await tx.serviceGroup.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      });
      const services = await tx.service.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: serviceInclude,
      });
      const exponent = await this.exponent(tx, businessId);
      return {
        categories: groupByCategory(
          groups,
          services.map((s) => manageServiceView(s, exponent)),
        ),
      };
    });
  }

  async createCategory(
    businessId: bigint,
    actor: Actor,
    input: { name: string; sortOrder?: number | undefined },
    ctx: RequestContext,
  ) {
    try {
      return await this.plane.inBusiness(businessId, async (tx) => {
        await authorize(tx, businessId, actor);
        const group = await tx.serviceGroup.create({
          data: { id: this.plane.id(), businessId, name: input.name, sortOrder: input.sortOrder ?? 0 },
        });
        await this.audit(tx, actor.id, 'booking.category_created', group.id, ctx);
        return categoryView(group);
      });
    } catch (err) {
      throw duplicateName(err);
    }
  }

  async updateCategory(
    businessId: bigint,
    categoryId: bigint,
    actor: Actor,
    input: { name?: string | undefined; sortOrder?: number | undefined },
    ctx: RequestContext,
  ) {
    try {
      return await this.plane.inBusiness(businessId, async (tx) => {
        await authorize(tx, businessId, actor);
        await findCategory(tx, businessId, categoryId);
        const group = await tx.serviceGroup.update({
          where: { id: categoryId },
          data: {
            ...(input.name !== undefined && { name: input.name }),
            ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
          },
        });
        await this.audit(tx, actor.id, 'booking.category_updated', categoryId, ctx);
        return categoryView(group);
      });
    } catch (err) {
      throw duplicateName(err);
    }
  }

  /** Its services stay, uncategorized. */
  async deleteCategory(businessId: bigint, categoryId: bigint, actor: Actor, ctx: RequestContext) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      await findCategory(tx, businessId, categoryId);
      await tx.service.updateMany({ where: { businessId, groupId: categoryId }, data: { groupId: null } });
      await tx.serviceGroup.delete({ where: { id: categoryId } });
      await this.audit(tx, actor.id, 'booking.category_deleted', categoryId, ctx);
    });
  }

  async createService(businessId: bigint, actor: Actor, input: ServiceInput, ctx: RequestContext) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      if (input.categoryId) await findCategory(tx, businessId, input.categoryId);
      const { currency } = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { currency: true },
      });
      const exponent = await exponentOf(tx, currency);
      await assertBusinessLimitOnShard(tx, businessId, 'services', () =>
        tx.service.count({ where: { businessId, isActive: true } }),
      );
      const id = this.plane.id();
      await tx.service.create({
        data: {
          id,
          businessId,
          name: input.name,
          description: input.description ?? null,
          groupId: input.categoryId ?? null,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes ?? 0,
          priceMinor: toMinor(input.price, exponent),
          // Always the business's currency: one business, one price list currency.
          currency,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      if (input.staffIds) await setStaff(tx, businessId, id, input.staffIds);
      await this.audit(tx, actor.id, 'booking.service_created', id, ctx);
      await announceListing(tx, this.plane, businessId, 'menu');
      const service = await tx.service.findUniqueOrThrow({ where: { id }, include: serviceInclude });
      return manageServiceView(service, exponent);
    });
  }

  async updateService(
    businessId: bigint,
    serviceId: bigint,
    actor: Actor,
    patch: Partial<ServiceInput> & { isActive?: boolean | undefined },
    ctx: RequestContext,
  ) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      const current = await findService(tx, businessId, serviceId);
      if (patch.categoryId) await findCategory(tx, businessId, patch.categoryId);
      const exponent = await exponentOf(tx, current.currency);
      const { staffIds, categoryId, price, ...fields } = patch;
      const data = {
        ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
        ...(categoryId !== undefined && { groupId: categoryId }),
        ...(price !== undefined && { priceMinor: toMinor(price, exponent) }),
      };
      // Bringing an archived service back counts against the plan like a new one.
      if (patch.isActive === true && !current.isActive) {
        await assertBusinessLimitOnShard(tx, businessId, 'services', () =>
          tx.service.count({ where: { businessId, isActive: true } }),
        );
      }
      await tx.service.update({ where: { id: serviceId }, data });
      if (staffIds) await setStaff(tx, businessId, serviceId, staffIds);
      await announceListing(tx, this.plane, businessId, 'menu');
      await this.audit(tx, actor.id, 'booking.service_updated', serviceId, ctx, {
        fields: [
          ...Object.keys(fields).filter((k) => fields[k as keyof typeof fields] !== undefined),
          ...(categoryId !== undefined ? ['categoryId'] : []),
          ...(price !== undefined ? ['price'] : []),
          ...(staffIds ? ['staffIds'] : []),
        ],
      });
      const service = await tx.service.findUniqueOrThrow({
        where: { id: serviceId },
        include: serviceInclude,
      });
      return manageServiceView(service, exponent);
    });
  }

  /** Archive: no longer bookable or listed; past appointments keep pointing at it. */
  async archiveService(businessId: bigint, serviceId: bigint, actor: Actor, ctx: RequestContext) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      await findService(tx, businessId, serviceId);
      await tx.service.update({ where: { id: serviceId }, data: { isActive: false } });
      await this.audit(tx, actor.id, 'booking.service_archived', serviceId, ctx);
      await announceListing(tx, this.plane, businessId, 'menu');
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async exponent(tx: BusinessTx, businessId: bigint) {
    const { currency } = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { currency: true },
    });
    return exponentOf(tx, currency);
  }

  private audit(
    tx: BusinessTx,
    userId: bigint,
    action: string,
    resourceId: bigint,
    ctx: RequestContext,
    newValues?: { fields: string[] },
  ) {
    return recordShardAudit(tx, this.plane.id(), {
      userId,
      action,
      resourceType: action.includes('category') ? 'service_category' : 'service',
      resourceId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}

/** Replace who performs a service. Every staff id must belong to this business. */
async function setStaff(tx: BusinessTx, businessId: bigint, serviceId: bigint, staffIds: bigint[]) {
  const unique = [...new Set(staffIds)];
  const found = await tx.staff.count({ where: { businessId, id: { in: unique } } });
  if (found !== unique.length) throw AppError.notFound('Staff member');
  await tx.staffService.deleteMany({ where: { serviceId } });
  if (unique.length)
    await tx.staffService.createMany({ data: unique.map((staffId) => ({ staffId, serviceId, businessId })) });
}

async function authorize(tx: BusinessTx, businessId: bigint, actor: Actor) {
  await requireBusinessPermissionOnShard(tx, businessId, actor, 'services.manage');
  await assertNotSuspended(tx, businessId);
}

async function findCategory(tx: BusinessTx, businessId: bigint, categoryId: bigint) {
  const group = await tx.serviceGroup.findFirst({ where: { id: categoryId, businessId } });
  if (!group) throw AppError.notFound('Category');
  return group;
}

async function findService(tx: BusinessTx, businessId: bigint, serviceId: bigint) {
  const service = await tx.service.findFirst({ where: { id: serviceId, businessId } });
  if (!service) throw AppError.notFound('Service');
  return service;
}

function duplicateName(err: unknown): unknown {
  return isUniqueViolation(err) ? AppError.conflict('A category with this name already exists') : err;
}

function categoryView(c: GroupRow) {
  return { id: c.id.toString(), name: c.name, sortOrder: c.sortOrder };
}

function publicServiceView(s: ServiceRow, exponent: number) {
  return {
    id: s.id.toString(),
    categoryId: s.groupId?.toString() ?? null,
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    price: formatMinor(s.priceMinor, exponent),
    currency: s.currency,
    staffIds: s.staff.map((x) => x.staffId.toString()),
  };
}

function manageServiceView(s: ServiceRow, exponent: number) {
  return {
    ...publicServiceView(s, exponent),
    bufferMinutes: s.bufferMinutes,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
  };
}

/** Categories in order, each with its services; uncategorized services last (`id: null`). */
function groupByCategory<T extends { categoryId: string | null }>(groups: GroupRow[], services: T[]) {
  const categorized = groups.map((c) => ({
    ...categoryView(c),
    services: services.filter((s) => s.categoryId === c.id.toString()),
  }));
  const other = services.filter((s) => s.categoryId === null);
  return other.length
    ? [
        ...categorized,
        { id: null, name: 'Other services', sortOrder: Number.MAX_SAFE_INTEGER, services: other },
      ]
    : categorized;
}
