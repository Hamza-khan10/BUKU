import { AppError, ErrorCodes, logger, publicId, type Actor, type BusinessRole } from '@buku/common';
import {
  businessRoleOfActor,
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  ShardNotFoundError,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS, type Topic } from '@buku/kafka';
import { auditCtx, type RequestContext } from '../http/context.js';
import type { CategoryService } from '../categories/category-service.js';
import { candidateSlugs } from './slug.js';
import { loadBusiness, privateView, publicView, type LoadedBusiness, type PrivateBusiness } from './views.js';

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

export interface BusinessProfileInput {
  name: string;
  categoryId: bigint;
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

/**
 * Businesses on database v2 (D3c): each on its own business shard, found by its public ID or its
 * address (global handles, DB-018); its owner's and team's own lists of where they work on their
 * user shards (DB-014). Every request works inside one business (`inBusiness`, DB-020).
 */
export class BusinessService {
  constructor(
    private readonly plane: DataPlane,
    private readonly categories: CategoryService,
    private readonly settings: BusinessServiceSettings,
  ) {}

  /**
   * Register a business. Like an account (D-113), its row is written first and its handles claimed
   * after — the address (the first free candidate), then the public ID — so a handle always leads
   * to a business; anything that fails on the way is undone.
   */
  async create(
    owner: Actor,
    input: BusinessProfileInput & { acceptedBusinessTermsVersion: string },
    ctx: RequestContext,
  ) {
    const { plane, settings } = this;
    if (input.acceptedBusinessTermsVersion !== settings.businessTermsVersion) {
      throw new AppError(
        `Please accept the Business Terms (version ${settings.businessTermsVersion}) to register a business`,
        ErrorCodes.TERMS_NOT_ACCEPTED,
        422,
        { details: { termsVersion: settings.businessTermsVersion } },
      );
    }
    const ownerShard = await plane.user(owner.id);
    const owned = await ownerShard.userBusinessRole.count({ where: { userId: owner.id, role: 'owner' } });
    if (owned >= settings.maxBusinessesPerOwner) {
      throw new AppError(
        `You can register up to ${settings.maxBusinessesPerOwner} businesses`,
        ErrorCodes.PLAN_LIMIT_REACHED,
        409,
      );
    }
    await this.categories.assertUsable(input.categoryId);

    const { acceptedBusinessTermsVersion: _terms, ...profile } = input;
    const id = plane.id();
    const pid = publicId();
    await plane.placeBusiness(id);
    const claimed: [string, Buffer][] = [];
    let written = false;
    let viewed = false;
    try {
      // 1. The row, under the first address nobody has, on this shard or any other.
      let slug: string | null = null;
      for (const candidate of candidateSlugs(input.name, input.city)) {
        try {
          await plane.inBusiness(id, (tx) =>
            written
              ? tx.business.update({ where: { id }, data: { slug: candidate } })
              : tx.business.create({
                  data: {
                    ...profile,
                    id,
                    publicId: pid,
                    slug: candidate,
                    ownerUserId: owner.id,
                    status: 'pending',
                    businessTermsVersion: settings.businessTermsVersion,
                    businessTermsAcceptedAt: new Date(),
                  },
                }),
          );
          written = true;
        } catch (err) {
          if (isUniqueViolation(err)) continue; // taken on this shard
          throw err;
        }
        const key = Buffer.from(candidate, 'utf8');
        if ((await plane.handles.claim('business.slug', key, id)).claimed) {
          claimed.push(['business.slug', key]);
          slug = candidate;
          break;
        }
      }
      if (!slug) throw AppError.internal('Could not allocate a unique business URL');
      const pidKey = Buffer.from(pid, 'ascii');
      if (!(await plane.handles.claim('business.public_id', pidKey, id)).claimed) {
        throw AppError.internal('Could not allocate a public ID');
      }
      claimed.push(['business.public_id', pidKey]);

      // 2. The owner's own list of their businesses (DB-014).
      await ownerShard.userBusinessRole.create({
        data: {
          userId: owner.id,
          businessId: id,
          role: 'owner',
          status: 'active',
          businessName: input.name,
          version: plane.id(),
        },
      });
      viewed = true;

      // 3. Announced and audited, with the business as it now is.
      const business = await plane.inBusiness(id, async (tx) => {
        const created = (await loadBusiness(tx, plane.directory, id))!;
        await this.emit(
          tx,
          TOPICS.BUSINESSES_CREATED,
          id,
          {
            businessId: id.toString(),
            ownerId: owner.id.toString(),
            categoryId: created.categoryId.toString(),
            city: created.city,
            country: created.country,
            status: created.status,
          },
          ctx,
        );
        await recordShardAudit(tx, plane.id(), {
          userId: owner.id,
          action: 'business.created',
          resourceType: 'business',
          resourceId: id,
          ...auditCtx(ctx),
        });
        return created;
      });
      return privateView(business, 'owner');
    } catch (err) {
      if (viewed)
        await ownerShard.userBusinessRole.deleteMany({ where: { userId: owner.id, businessId: id } });
      for (const [kind, key] of claimed) await plane.handles.release(kind, key, id);
      if (written) await plane.inBusiness(id, (tx) => tx.business.deleteMany({ where: { id } }));
      throw err;
    }
  }

  /** Businesses I own or work at, with my role in each (my own list, checked against each business). */
  async listMine(actor: Actor): Promise<PrivateBusiness[]> {
    const mine = await (
      await this.plane.user(actor.id)
    ).userBusinessRole.findMany({ where: { userId: actor.id, status: 'active' } });
    const found: { role: BusinessRole; business: LoadedBusiness }[] = [];
    for (const { businessId } of mine) {
      const row = await this.plane
        .inBusiness(businessId, async (tx) => {
          const role = await businessRoleOfActor(tx, businessId, actor);
          const business = role && (await loadBusiness(tx, this.plane.directory, businessId));
          return role && business ? { role, business } : null;
        })
        .catch((err: unknown) => {
          if (err instanceof ShardNotFoundError) return null;
          throw err;
        });
      if (row) found.push(row);
    }
    // Owned first, then the rest; oldest first in each.
    return found
      .sort(
        (a, b) =>
          Number(b.role === 'owner') - Number(a.role === 'owner') ||
          +a.business.createdAt - +b.business.createdAt,
      )
      .map(({ role, business }) => privateView(business, role));
  }

  async getManaged(businessId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      const role = await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return privateView(await this.load(tx, businessId), role);
    });
  }

  /** The public profile, by the business's public ID or its address. */
  async getPublic(idOrSlug: string) {
    const businessId =
      (await this.plane.idOfPublic('business', idOrSlug)) ??
      (await this.plane.handles.find('business.slug', Buffer.from(idOrSlug, 'utf8')));
    const business =
      businessId === null
        ? null
        : await this.plane.inBusiness(businessId, async (tx) => {
            const b = await loadBusiness(tx, this.plane.directory, businessId);
            return b && (PUBLIC_STATUSES as readonly string[]).includes(b.status) ? b : null;
          });
    if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return { internalId: business.id, ...publicView(business) };
  }

  async update(businessId: bigint, actor: Actor, patch: Partial<BusinessProfileInput>, ctx: RequestContext) {
    const { plane } = this;
    if (patch.categoryId !== undefined) await this.categories.assertUsable(patch.categoryId);
    const { view, renamed } = await plane.inBusiness(businessId, async (tx) => {
      const role = await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.update');
      const current = await this.load(tx, businessId);
      assertWritable(current.status);

      const changed = (Object.keys(patch) as (keyof BusinessProfileInput)[]).filter(
        (k) => patch[k] !== undefined && current[k] !== patch[k],
      );
      if (changed.length === 0) return { view: privateView(current, role), renamed: false };

      const identityChanged = changed.some((k) => (IDENTITY_FIELDS as readonly string[]).includes(k));
      // A verified (or rejected-and-fixed) business whose identity changes goes back to review.
      const reverify = identityChanged && (current.status === 'verified' || current.status === 'rejected');
      await tx.business.update({
        where: { id: businessId },
        data: {
          ...Object.fromEntries(changed.map((k) => [k, patch[k]])),
          ...(reverify && { status: 'pending', verifiedAt: null, rejectionReason: null }),
        },
      });
      const row = await this.load(tx, businessId);
      await this.emit(
        tx,
        TOPICS.BUSINESSES_UPDATED,
        businessId,
        {
          businessId: businessId.toString(),
          changedFields: changed,
          reverificationRequired: reverify,
          status: row.status,
        },
        ctx,
      );
      await recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: 'business.updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: { changedFields: changed, reverificationRequired: reverify },
        ...auditCtx(ctx),
      });
      return { view: privateView(row, role), renamed: changed.includes('name') };
    });
    if (renamed) await this.renameInLists(businessId, view.name);
    return view;
  }

  /** Replace the whole weekly schedule (days not listed are closed). */
  async setHours(
    businessId: bigint,
    actor: Actor,
    hours: { dayOfWeek: number; openTime: string; closeTime: string }[],
    ctx: RequestContext,
  ) {
    const { plane } = this;
    return plane.inBusiness(businessId, async (tx) => {
      const role = await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.hours');
      const current = await this.load(tx, businessId);
      assertWritable(current.status);
      await tx.businessHours.deleteMany({ where: { businessId } });
      await tx.businessHours.createMany({ data: hours.map((h) => ({ id: plane.id(), businessId, ...h })) });
      await this.emit(
        tx,
        TOPICS.BUSINESSES_UPDATED,
        businessId,
        {
          businessId: businessId.toString(),
          changedFields: ['hours'],
          reverificationRequired: false,
          status: current.status,
        },
        ctx,
      );
      await recordShardAudit(tx, plane.id(), {
        userId: actor.id,
        action: 'business.hours_updated',
        resourceType: 'business',
        resourceId: businessId,
        ...auditCtx(ctx),
      });
      return privateView(await this.load(tx, businessId), role);
    });
  }

  async report(
    businessId: bigint,
    reporter: Actor,
    input: {
      reason: 'fake_business' | 'wrong_information' | 'inappropriate_content' | 'scam_or_fraud' | 'other';
      details?: string | undefined;
    },
    ctx: RequestContext,
  ) {
    const { plane } = this;
    try {
      return await plane.inBusiness(businessId, async (tx) => {
        const business = await tx.business.findFirst({
          where: { id: businessId, deletedAt: null, status: { in: [...PUBLIC_STATUSES] } },
          select: { ownerUserId: true },
        });
        if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
        if (business.ownerUserId === reporter.id)
          throw AppError.badRequest('You cannot report your own business');
        const report = await tx.businessReport.create({
          data: {
            id: plane.id(),
            businessId,
            reporterId: reporter.id,
            reason: input.reason,
            details: input.details ?? null,
          },
        });
        await recordShardAudit(tx, plane.id(), {
          userId: reporter.id,
          action: 'business.reported',
          resourceType: 'business',
          resourceId: businessId,
          newValues: { reason: input.reason },
          ...auditCtx(ctx),
        });
        return { id: report.id.toString(), status: report.status };
      });
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('You have already reported this business', ErrorCodes.ALREADY_REPORTED);
      throw err;
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────

  private async load(tx: BusinessTx, businessId: bigint): Promise<LoadedBusiness> {
    const b = await loadBusiness(tx, this.plane.directory, businessId);
    if (!b) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return b;
  }

  /**
   * The new name in the owner's and team's own lists, on their shards. After the change itself:
   * a list that misses it shows the old name until the next change, nothing worse.
   */
  private async renameInLists(businessId: bigint, name: string): Promise<void> {
    const { plane } = this;
    const people = await plane.inBusiness(businessId, async (tx) => {
      const b = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { ownerUserId: true },
      });
      const members = await tx.businessMember.findMany({ where: { businessId }, select: { userId: true } });
      return [b.ownerUserId, ...members.map((m) => m.userId)];
    });
    for (const userId of new Set(people)) {
      try {
        await (
          await plane.user(userId)
        ).userBusinessRole.updateMany({
          where: { userId, businessId },
          data: { businessName: name, version: plane.id() },
        });
      } catch (err) {
        logger.warn({ err, businessId: businessId.toString() }, 'could not rename a business in a list');
      }
    }
  }

  private async emit(tx: BusinessTx, type: Topic, businessId: bigint, data: object, ctx: RequestContext) {
    await enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({
        type,
        source: 'business-service',
        subject: businessId.toString(),
        data,
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'business',
    );
  }
}

export function assertWritable(status: string) {
  if (status === 'suspended') {
    throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
  }
}

export type { BusinessRole };
