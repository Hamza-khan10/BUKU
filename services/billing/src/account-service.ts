import { countVisits, entitlementsOf, type Entitlements } from '@buku/billing';
import { AppError, ErrorCodes } from '@buku/common';
import { isUniqueViolation, recordAudit, requireBusinessPermission, type Database } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';

/**
 * What a customer or a business is on, how much of it they use, and admin
 * grants (a plan given for free: partners, support, testing). Usage is read
 * from the tables of the services that own the data (read-only).
 */

const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'paused'] as const;

export class AccountService {
  constructor(private readonly db: Database) {}

  async mine(userId: string) {
    const [e, visits] = await Promise.all([
      entitlementsOf(this.db, { userId }),
      countVisits(this.db, userId),
    ]);
    return summary(e, { visits });
  }

  async business(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const [e, team, staff, services, photos] = await Promise.all([
      entitlementsOf(this.db, { businessId }),
      this.db.businessMember.count({ where: { businessId } }),
      this.db.staff.count({ where: { businessId, isActive: true } }),
      this.db.service.count({ where: { businessId, isActive: true } }),
      this.db.businessPhoto.count({ where: { businessId } }),
    ]);
    return summary(e, { team_accounts: team, staff_profiles: staff, services, photos });
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async grant(
    input: {
      planCode: string;
      userId?: string | undefined;
      businessId?: string | undefined;
      until?: string | undefined;
      note: string;
    },
    adminId: string,
    ctx: RequestContext,
  ) {
    const plan = await this.db.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw AppError.notFound('Plan');
    if (plan.audience !== (input.userId ? 'user' : 'business')) {
      throw AppError.badRequest(`"${plan.code}" is a ${plan.audience} plan`);
    }
    if (input.userId && !(await this.db.user.findUnique({ where: { id: input.userId } }))) {
      throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    }
    if (
      input.businessId &&
      !(await this.db.business.findFirst({ where: { id: input.businessId, deletedAt: null } }))
    ) {
      throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    }
    const until = input.until ? new Date(input.until) : null;
    if (until && until <= new Date()) throw AppError.badRequest('`until` must be in the future');
    try {
      const sub = await this.db.$transaction(async (tx) => {
        const sub = await tx.subscription.create({
          data: {
            planId: plan.id,
            userId: input.userId ?? null,
            businessId: input.businessId ?? null,
            provider: 'manual',
            status: 'active',
            currentPeriodStart: new Date(),
            currentPeriodEnd: until,
            grantedById: adminId,
            grantNote: input.note,
          },
          include: { plan: true },
        });
        await recordAudit(tx, {
          userId: adminId,
          action: 'billing.plan_granted',
          resourceType: 'subscription',
          resourceId: sub.id,
          newValues: {
            plan: plan.code,
            userId: input.userId ?? null,
            businessId: input.businessId ?? null,
            until: input.until ?? null,
            note: input.note,
          },
          ...auditCtx(ctx),
        });
        return sub;
      });
      return subscriptionView(sub);
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('This account already has a live subscription; end it first');
      throw err;
    }
  }

  /** End a subscription now. Store subscriptions are cancelled in the store (2.5 part 3). */
  async end(subscriptionId: string, adminId: string, reason: string, ctx: RequestContext) {
    const sub = await this.db.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw AppError.notFound('Subscription');
    if (sub.provider !== 'manual') {
      throw AppError.conflict(
        `This subscription is billed by ${sub.provider}; cancel it there so the customer stops being charged`,
      );
    }
    if (!LIVE_STATUSES.includes(sub.status as never)) return subscriptionView(await this.load(sub.id));
    await this.db.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await recordAudit(tx, {
        userId: adminId,
        action: 'billing.subscription_ended',
        resourceType: 'subscription',
        resourceId: sub.id,
        newValues: { reason },
        ...auditCtx(ctx),
      });
    });
    return subscriptionView(await this.load(sub.id));
  }

  async list(query: {
    planCode?: string | undefined;
    status?: string | undefined;
    page: number;
    limit: number;
  }) {
    const where = {
      ...(query.planCode && { plan: { code: query.planCode } }),
      ...(query.status && { status: query.status as never }),
    };
    const [rows, total] = await Promise.all([
      this.db.subscription.findMany({
        where,
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.subscription.count({ where }),
    ]);
    return {
      items: rows.map(subscriptionView),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  private load(id: string) {
    return this.db.subscription.findUniqueOrThrow({ where: { id }, include: { plan: true } });
  }
}

function summary(e: Entitlements, used: Record<string, number>) {
  return {
    plan: { code: e.plan.code, name: e.plan.name },
    /** subscription | default (no subscription) | billing_off (everyone unlimited for now) */
    source: e.source,
    billingEnabled: e.billingEnabled,
    subscription: e.subscription,
    features: e.features,
    usage: Object.fromEntries(
      Object.entries(e.limits).map(([key, max]) => {
        const n = used[key] ?? 0;
        return [key, { used: n, limit: max, remaining: max === null ? null : Math.max(0, max - n) }];
      }),
    ),
  };
}

function subscriptionView(s: {
  id: string;
  plan: { code: string; name: string };
  userId: string | null;
  businessId: string | null;
  provider: string;
  channel: string | null;
  status: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: Date | null;
  grantNote: string | null;
  createdAt: Date;
}) {
  return {
    id: s.id,
    plan: { code: s.plan.code, name: s.plan.name },
    userId: s.userId,
    businessId: s.businessId,
    provider: s.provider,
    channel: s.channel,
    status: s.status,
    currentPeriodStart: s.currentPeriodStart?.toISOString() ?? null,
    currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    grantNote: s.grantNote,
    createdAt: s.createdAt.toISOString(),
  };
}
