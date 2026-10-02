import { AppError } from '@buku/common';
import { assertBusinessLimit } from '@buku/billing';
import {
  isUniqueViolation,
  type Prisma,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { assertNotSuspended, findBookableBusiness } from '../businesses.js';
import { auditCtx, type RequestContext } from '../http/context.js';
import type { SettingsService } from '../settings/settings-service.js';

/**
 * The service menu: categories ("Haircuts", "Colour") and the services in
 * them, with duration, price and who performs each. Managed by owners and
 * managers (`services.manage`). Prices are in the business's currency and
 * paid at the venue for the MVP.
 *
 * Services are never hard-deleted: past appointments point at them. Removing
 * one archives it (no longer bookable or listed publicly).
 */

export interface ServiceInput {
  name: string;
  description?: string | null | undefined;
  categoryId?: string | null | undefined;
  durationMinutes: number;
  bufferMinutes?: number | undefined;
  price: number;
  sortOrder?: number | undefined;
  /** Staff who perform this service (replaces the current list). */
  staffIds?: string[] | undefined;
}

const serviceInclude = { staff: { select: { staffId: true } } } as const;

type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;

export class CatalogService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  // ── Public ───────────────────────────────────────────────────────────────

  /** The menu customers see: active services by category, plus the business's booking terms. */
  async publicMenu(idOrSlug: string) {
    const business = await findBookableBusiness(this.db, idOrSlug);
    const [categories, services, settings] = await Promise.all([
      this.db.serviceCategory.findMany({
        where: { businessId: business.id },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.db.service.findMany({
        where: { businessId: business.id, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { staff: { where: { staff: { isActive: true } }, select: { staffId: true } } },
      }),
      this.settings.effective(business.id),
    ]);
    return {
      businessId: business.id,
      currency: business.currency,
      categories: groupByCategory(categories, services.map(publicServiceView)),
      booking: {
        confirmationMode: settings.confirmationMode,
        bookingHorizonDays: settings.bookingHorizonDays,
        cancellationWindowHours: settings.cancellationWindowHours,
        minNoticeMinutes: settings.minNoticeMinutes,
      },
    };
  }

  // ── Management ───────────────────────────────────────────────────────────

  /** Everything, archived services included. */
  async manageMenu(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const [categories, services] = await Promise.all([
      this.db.serviceCategory.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.db.service.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: serviceInclude,
      }),
    ]);
    return { categories: groupByCategory(categories, services.map(manageServiceView)) };
  }

  async createCategory(
    businessId: string,
    actorId: string,
    input: { name: string; sortOrder?: number | undefined },
    ctx: RequestContext,
  ) {
    await this.authorize(businessId, actorId);
    try {
      const category = await this.db.serviceCategory.create({
        data: { businessId, name: input.name, sortOrder: input.sortOrder ?? 0 },
      });
      await this.audit(this.db, actorId, 'booking.category_created', category.id, ctx);
      return categoryView(category);
    } catch (err) {
      throw duplicateName(err);
    }
  }

  async updateCategory(
    businessId: string,
    categoryId: string,
    actorId: string,
    input: { name?: string | undefined; sortOrder?: number | undefined },
    ctx: RequestContext,
  ) {
    await this.authorize(businessId, actorId);
    await this.findCategory(businessId, categoryId);
    try {
      const category = await this.db.serviceCategory.update({
        where: { id: categoryId },
        data: {
          ...(input.name !== undefined && { name: input.name }),
          ...(input.sortOrder !== undefined && { sortOrder: input.sortOrder }),
        },
      });
      await this.audit(this.db, actorId, 'booking.category_updated', categoryId, ctx);
      return categoryView(category);
    } catch (err) {
      throw duplicateName(err);
    }
  }

  /** Its services stay, uncategorized. */
  async deleteCategory(businessId: string, categoryId: string, actorId: string, ctx: RequestContext) {
    await this.authorize(businessId, actorId);
    await this.findCategory(businessId, categoryId);
    await this.db.$transaction(async (tx) => {
      await tx.service.updateMany({ where: { businessId, categoryId }, data: { categoryId: null } });
      await tx.serviceCategory.delete({ where: { id: categoryId } });
      await this.audit(tx, actorId, 'booking.category_deleted', categoryId, ctx);
    });
  }

  async createService(businessId: string, actorId: string, input: ServiceInput, ctx: RequestContext) {
    await this.authorize(businessId, actorId);
    if (input.categoryId) await this.findCategory(businessId, input.categoryId);
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { currency: true },
    });
    const service = await this.db.$transaction(async (tx) => {
      await assertBusinessLimit(tx, businessId, 'services', () =>
        tx.service.count({ where: { businessId, isActive: true } }),
      );
      const created = await tx.service.create({
        data: {
          businessId,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId ?? null,
          durationMinutes: input.durationMinutes,
          bufferMinutes: input.bufferMinutes ?? 0,
          price: input.price,
          // Always the business's currency: one business, one price list currency.
          currency: business.currency,
          sortOrder: input.sortOrder ?? 0,
        },
      });
      if (input.staffIds) await this.setStaff(tx, businessId, created.id, input.staffIds);
      await this.audit(tx, actorId, 'booking.service_created', created.id, ctx);
      return tx.service.findUniqueOrThrow({ where: { id: created.id }, include: serviceInclude });
    });
    return manageServiceView(service);
  }

  async updateService(
    businessId: string,
    serviceId: string,
    actorId: string,
    patch: Partial<ServiceInput> & { isActive?: boolean | undefined },
    ctx: RequestContext,
  ) {
    await this.authorize(businessId, actorId);
    const current = await this.findService(businessId, serviceId);
    if (patch.categoryId) await this.findCategory(businessId, patch.categoryId);
    const { staffIds, ...fields } = patch;
    const data = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const service = await this.db.$transaction(async (tx) => {
      // Bringing an archived service back counts against the plan like a new one.
      if (patch.isActive === true && !current.isActive) {
        await assertBusinessLimit(tx, businessId, 'services', () =>
          tx.service.count({ where: { businessId, isActive: true } }),
        );
      }
      await tx.service.update({ where: { id: serviceId }, data });
      if (staffIds) await this.setStaff(tx, businessId, serviceId, staffIds);
      await this.audit(tx, actorId, 'booking.service_updated', serviceId, ctx, {
        fields: [...Object.keys(data), ...(staffIds ? ['staffIds'] : [])],
      });
      return tx.service.findUniqueOrThrow({ where: { id: serviceId }, include: serviceInclude });
    });
    return manageServiceView(service);
  }

  /** Archive: no longer bookable or listed; past appointments keep pointing at it. */
  async archiveService(businessId: string, serviceId: string, actorId: string, ctx: RequestContext) {
    await this.authorize(businessId, actorId);
    await this.findService(businessId, serviceId);
    await this.db.service.update({ where: { id: serviceId }, data: { isActive: false } });
    await this.audit(this.db, actorId, 'booking.service_archived', serviceId, ctx);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Replace who performs a service. Every staff id must belong to this business. */
  private async setStaff(tx: Transaction, businessId: string, serviceId: string, staffIds: string[]) {
    const unique = [...new Set(staffIds)];
    const found = await tx.staff.count({ where: { businessId, id: { in: unique } } });
    if (found !== unique.length) throw AppError.notFound('Staff member');
    await tx.staffService.deleteMany({ where: { serviceId } });
    if (unique.length)
      await tx.staffService.createMany({ data: unique.map((staffId) => ({ staffId, serviceId })) });
  }

  private async authorize(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'services.manage');
    await assertNotSuspended(this.db, businessId);
  }

  private async findCategory(businessId: string, categoryId: string) {
    const category = await this.db.serviceCategory.findFirst({ where: { id: categoryId, businessId } });
    if (!category) throw AppError.notFound('Category');
    return category;
  }

  private async findService(businessId: string, serviceId: string) {
    const service = await this.db.service.findFirst({ where: { id: serviceId, businessId } });
    if (!service) throw AppError.notFound('Service');
    return service;
  }

  private audit(
    db: Database | Transaction,
    userId: string,
    action: string,
    resourceId: string,
    ctx: RequestContext,
    newValues?: { fields: string[] },
  ) {
    return recordAudit(db, {
      userId,
      action,
      resourceType: action.includes('category') ? 'service_category' : 'service',
      resourceId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}

function duplicateName(err: unknown): unknown {
  return isUniqueViolation(err) ? AppError.conflict('A category with this name already exists') : err;
}

function categoryView(c: { id: string; name: string; sortOrder: number }) {
  return { id: c.id, name: c.name, sortOrder: c.sortOrder };
}

/** Money as a string ("800.00"): never through floating point. */
const money = (d: Prisma.Decimal) => d.toFixed(2);

function publicServiceView(s: ServiceRow) {
  return {
    id: s.id,
    categoryId: s.categoryId,
    name: s.name,
    description: s.description,
    durationMinutes: s.durationMinutes,
    price: money(s.price),
    currency: s.currency,
    staffIds: s.staff.map((x) => x.staffId),
  };
}

function manageServiceView(s: ServiceRow) {
  return {
    ...publicServiceView(s),
    bufferMinutes: s.bufferMinutes,
    sortOrder: s.sortOrder,
    isActive: s.isActive,
  };
}

/** Categories in order, each with its services; uncategorized services last (`id: null`). */
function groupByCategory<T extends { categoryId: string | null }>(
  categories: { id: string; name: string; sortOrder: number }[],
  services: T[],
) {
  const groups = categories.map((c) => ({
    ...categoryView(c),
    services: services.filter((s) => s.categoryId === c.id),
  }));
  const other = services.filter((s) => s.categoryId === null);
  return other.length
    ? [...groups, { id: null, name: 'Other services', sortOrder: Number.MAX_SAFE_INTEGER, services: other }]
    : groups;
}
