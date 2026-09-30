import { AppError, ErrorCodes, type BusinessRole } from '@buku/common';
import {
  isUniqueViolation,
  Prisma,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { createEvent, enqueueEvent, TOPICS } from '@buku/kafka';
import { auditCtx, type RequestContext } from '../http/context.js';
import { candidateSlugs } from './slug.js';
import { privateView, publicView } from './views.js';

/** Statuses the public can see. Suspended/rejected businesses disappear (404). */
const PUBLIC_STATUSES = ['pending', 'verified'] as const;

/**
 * Changing any of these on a VERIFIED business sends it back to review: it
 * is who/where the business is, which is exactly what verification checked.
 */
const IDENTITY_FIELDS = [
  'name',
  'categoryId',
  'address',
  'city',
  'state',
  'country',
  'postalCode',
  'lat',
  'lng',
] as const;

const include = { category: { select: { id: true, name: true, slug: true } }, hours: true } as const;

export interface BusinessProfileInput {
  name: string;
  categoryId: string;
  description?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
  address: string;
  city: string;
  state?: string | undefined;
  country: string;
  postalCode?: string | undefined;
  lat: number;
  lng: number;
  timezone: string;
  currency: string;
}

export interface BusinessServiceSettings {
  businessTermsVersion: string;
  maxBusinessesPerOwner: number;
}

export class BusinessService {
  constructor(
    private readonly db: Database,
    private readonly settings: BusinessServiceSettings,
  ) {}

  async create(
    ownerId: string,
    input: BusinessProfileInput & { acceptedBusinessTermsVersion: string },
    ctx: RequestContext,
  ) {
    if (input.acceptedBusinessTermsVersion !== this.settings.businessTermsVersion) {
      throw new AppError(
        `Please accept the Business Terms (version ${this.settings.businessTermsVersion}) to register a business`,
        ErrorCodes.TERMS_NOT_ACCEPTED,
        422,
        { details: { termsVersion: this.settings.businessTermsVersion } },
      );
    }
    const owned = await this.db.business.count({ where: { ownerId, deletedAt: null } });
    if (owned >= this.settings.maxBusinessesPerOwner) {
      throw new AppError(
        `You can register up to ${this.settings.maxBusinessesPerOwner} businesses`,
        ErrorCodes.PLAN_LIMIT_REACHED,
        409,
      );
    }
    await this.assertCategory(input.categoryId);

    const { acceptedBusinessTermsVersion: _terms, ...profile } = input;
    for (const slug of candidateSlugs(input.name, input.city)) {
      try {
        const business = await this.db.$transaction(async (tx) => {
          const created = await tx.business.create({
            data: {
              ...profile,
              slug,
              ownerId,
              status: 'pending',
              verified: false,
              businessTermsVersion: this.settings.businessTermsVersion,
              businessTermsAcceptedAt: new Date(),
            },
            include,
          });
          await this.emit(
            tx,
            TOPICS.BUSINESSES_CREATED,
            created.id,
            {
              businessId: created.id,
              ownerId,
              categoryId: created.categoryId,
              city: created.city,
              country: created.country,
              status: created.status,
            },
            ctx,
          );
          await recordAudit(tx, {
            userId: ownerId,
            action: 'business.created',
            resourceType: 'business',
            resourceId: created.id,
            ...auditCtx(ctx),
          });
          return created;
        });
        return privateView(business, 'owner');
      } catch (err) {
        if (isUniqueViolation(err)) continue; // slug taken: try the next candidate
        throw err;
      }
    }
    throw AppError.internal('Could not allocate a unique business URL');
  }

  /** Businesses I own or work at, with my role in each. */
  async listMine(userId: string) {
    const [owned, memberships] = await Promise.all([
      this.db.business.findMany({
        where: { ownerId: userId, deletedAt: null },
        include,
        orderBy: { createdAt: 'asc' },
      }),
      this.db.businessMember.findMany({
        where: { userId, status: 'active', business: { deletedAt: null } },
        include: { business: { include } },
      }),
    ]);
    return [
      ...owned.map((b) => privateView(b, 'owner')),
      ...memberships.map((m) => privateView(m.business, m.role)),
    ];
  }

  async getManaged(businessId: string, userId: string) {
    const role = await requireBusinessPermission(this.db, businessId, userId, 'business.view_private');
    return privateView(await this.load(businessId), role);
  }

  async getPublic(idOrSlug: string) {
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(idOrSlug);
    const business = await this.db.business.findFirst({
      where: {
        ...(isId ? { id: idOrSlug } : { slug: idOrSlug }),
        deletedAt: null,
        status: { in: [...PUBLIC_STATUSES] },
      },
      include,
    });
    if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return publicView(business);
  }

  async update(
    businessId: string,
    userId: string,
    patch: Partial<BusinessProfileInput>,
    ctx: RequestContext,
  ) {
    const role = await requireBusinessPermission(this.db, businessId, userId, 'business.update');
    const current = await this.load(businessId);
    this.assertWritable(current.status);
    if (patch.categoryId) await this.assertCategory(patch.categoryId);

    const changed = (Object.keys(patch) as (keyof BusinessProfileInput)[]).filter((k) => {
      const now = current[k];
      const next = patch[k];
      if (next === undefined) return false;
      return now instanceof Prisma.Decimal ? now.toNumber() !== next : now !== next;
    });
    if (changed.length === 0) return privateView(current, role);

    const identityChanged = changed.some((k) => (IDENTITY_FIELDS as readonly string[]).includes(k));
    // A verified (or rejected-and-fixed) business whose identity changes goes back to review.
    const reverify = identityChanged && (current.status === 'verified' || current.status === 'rejected');

    const updated = await this.db.$transaction(async (tx) => {
      const row = await tx.business.update({
        where: { id: businessId },
        data: {
          ...Object.fromEntries(changed.map((k) => [k, patch[k]])),
          ...(reverify && { status: 'pending', verified: false, verifiedAt: null, rejectionReason: null }),
        },
        include,
      });
      await this.emit(
        tx,
        TOPICS.BUSINESSES_UPDATED,
        businessId,
        {
          businessId,
          changedFields: changed,
          reverificationRequired: reverify,
          status: row.status,
        },
        ctx,
      );
      await recordAudit(tx, {
        userId,
        action: 'business.updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: { changedFields: changed, reverificationRequired: reverify },
        ...auditCtx(ctx),
      });
      return row;
    });
    return privateView(updated, role);
  }

  /** Replace the whole weekly schedule (days not listed are closed). */
  async setHours(
    businessId: string,
    userId: string,
    hours: { dayOfWeek: number; openTime: string; closeTime: string }[],
    ctx: RequestContext,
  ) {
    const role = await requireBusinessPermission(this.db, businessId, userId, 'business.hours');
    const current = await this.load(businessId);
    this.assertWritable(current.status);
    const updated = await this.db.$transaction(async (tx) => {
      await tx.businessHours.deleteMany({ where: { businessId } });
      await tx.businessHours.createMany({ data: hours.map((h) => ({ businessId, ...h })) });
      await this.emit(
        tx,
        TOPICS.BUSINESSES_UPDATED,
        businessId,
        { businessId, changedFields: ['hours'], reverificationRequired: false, status: current.status },
        ctx,
      );
      await recordAudit(tx, {
        userId,
        action: 'business.hours_updated',
        resourceType: 'business',
        resourceId: businessId,
        ...auditCtx(ctx),
      });
      return tx.business.findUniqueOrThrow({ where: { id: businessId }, include });
    });
    return privateView(updated, role);
  }

  async report(
    businessId: string,
    reporterId: string,
    input: {
      reason: 'fake_business' | 'wrong_information' | 'inappropriate_content' | 'scam_or_fraud' | 'other';
      details?: string | undefined;
    },
    ctx: RequestContext,
  ) {
    const business = await this.db.business.findFirst({
      where: { id: businessId, deletedAt: null, status: { in: [...PUBLIC_STATUSES] } },
      select: { ownerId: true },
    });
    if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    if (business.ownerId === reporterId) throw AppError.badRequest('You cannot report your own business');
    try {
      const report = await this.db.businessReport.create({
        data: { businessId, reporterId, reason: input.reason, details: input.details ?? null },
      });
      await recordAudit(this.db, {
        userId: reporterId,
        action: 'business.reported',
        resourceType: 'business',
        resourceId: businessId,
        newValues: { reason: input.reason },
        ...auditCtx(ctx),
      });
      return { id: report.id, status: report.status };
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('You have already reported this business', ErrorCodes.ALREADY_REPORTED);
      throw err;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async load(businessId: string) {
    const b = await this.db.business.findFirst({ where: { id: businessId, deletedAt: null }, include });
    if (!b) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return b;
  }

  private async assertCategory(categoryId: string) {
    const ok = await this.db.category.count({ where: { id: categoryId, isActive: true } });
    if (!ok)
      throw AppError.badRequest('Unknown category', [
        { path: 'categoryId', message: 'unknown or inactive category' },
      ]);
  }

  private assertWritable(status: string) {
    if (status === 'suspended') {
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
    }
  }

  private async emit(
    tx: Transaction,
    type: (typeof TOPICS)[keyof typeof TOPICS],
    businessId: string,
    data: object,
    ctx: RequestContext,
  ) {
    await enqueueEvent(
      tx,
      createEvent({
        type,
        source: 'business-service',
        subject: businessId,
        data,
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'business',
    );
  }
}

export type { BusinessRole };
