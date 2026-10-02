import { countVisits, entitlementsOf, type Account, type Audience, type Entitlements } from '@buku/billing';
import { AppError, ErrorCodes } from '@buku/common';
import {
  constraintNameOf,
  isUniqueViolation,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';

/**
 * Accounts and their plans:
 *
 *  • what a customer or a business is on, and how much of it they use;
 *  • the FREE TRIAL — a month (by default) of a paid plan that each customer
 *    and each business can start ONCE, whenever they choose. Admins switch
 *    trials off per audience; then the Free plan is simply the normal plan;
 *  • GRANTS — any plan given to any account free of charge (partners, a large
 *    organisation on Enterprise to win them as a customer, support gestures),
 *    optionally until a date; a grant can replace the current grant or trial;
 *  • PLAN REQUESTS — a business asks for a plan (e.g. Enterprise), an admin
 *    approves (→ a grant) or declines.
 *
 * Trials and grants with an end date stop counting once it passes
 * (entitlements check the date); `expireEnded` also marks them `expired` so
 * the account can be given a new plan.
 */

const LIVE = ['active', 'trialing', 'past_due', 'paused'] as const;
/** Sources we manage ourselves; store subscriptions are changed in the store. */
const OURS = ['manual', 'trial'];

const TRIAL_REFUSALS: Record<string, string> = {
  billing_off: 'Everything is included right now; there is nothing to try',
  trials_off: 'Free trials aren’t available at the moment',
  in_trial: 'Your free trial is already running',
  already_used: 'The free trial can only be used once',
  has_subscription: 'You already have a plan',
};

export class AccountService {
  constructor(private readonly db: Database) {}

  // ── Customers and businesses ─────────────────────────────────────────────

  async mine(userId: string) {
    const account = { userId };
    const [e, visits, trial] = await Promise.all([
      entitlementsOf(this.db, account),
      countVisits(this.db, userId),
      this.trialOffer('user', account),
    ]);
    return { ...summary(e, { visits }), trial };
  }

  async business(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const account = { businessId };
    const [e, team, staff, services, photos, trial, request] = await Promise.all([
      entitlementsOf(this.db, account),
      this.db.businessMember.count({ where: { businessId, status: 'active' } }),
      this.db.staff.count({ where: { businessId, isActive: true } }),
      this.db.service.count({ where: { businessId, isActive: true } }),
      this.db.businessPhoto.count({ where: { businessId } }),
      this.trialOffer('business', account),
      this.db.planRequest.findFirst({ where: { businessId, status: 'pending' }, include: { plan: true } }),
    ]);
    return {
      ...summary(e, { team_accounts: team, staff_profiles: staff, services, photos }),
      trial,
      pendingPlanRequest: request ? requestView(request) : null,
    };
  }

  async startMyTrial(userId: string, ctx: RequestContext) {
    await this.startTrial('user', { userId }, userId, ctx);
    return this.mine(userId);
  }

  async startBusinessTrial(businessId: string, actorId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, actorId, 'billing.manage');
    await this.startTrial('business', { businessId }, actorId, ctx);
    return this.business(businessId, actorId);
  }

  // ── Plan requests (businesses) ───────────────────────────────────────────

  async requestPlan(
    businessId: string,
    actorId: string,
    input: { planCode: string; message: string },
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'billing.manage');
    const plan = await this.db.plan.findUnique({ where: { code: input.planCode } });
    if (!plan || plan.audience !== 'business' || plan.archivedAt || !plan.isPublic)
      throw AppError.notFound('Plan');
    try {
      const request = await this.db.$transaction(async (tx) => {
        const request = await tx.planRequest.create({
          data: { businessId, planId: plan.id, requestedById: actorId, message: input.message },
          include: { plan: true },
        });
        await audit(tx, actorId, 'billing.plan_requested', 'plan_request', request.id, ctx, {
          businessId,
          plan: plan.code,
        });
        return request;
      });
      return requestView(request);
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('This business already has an open plan request');
      throw err;
    }
  }

  async businessRequests(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const rows = await this.db.planRequest.findMany({
      where: { businessId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return rows.map(requestView);
  }

  async withdrawRequest(businessId: string, requestId: string, actorId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, actorId, 'billing.manage');
    const { count } = await this.db.planRequest.updateMany({
      where: { id: requestId, businessId, status: 'pending' },
      data: { status: 'withdrawn' },
    });
    if (count === 0) throw AppError.notFound('Open plan request');
    await audit(this.db, actorId, 'billing.plan_request_withdrawn', 'plan_request', requestId, ctx, {});
    return this.request(requestId);
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  async listRequests(status: 'pending' | 'approved' | 'declined' | 'withdrawn' | undefined) {
    const rows = await this.db.planRequest.findMany({
      where: status ? { status } : {},
      include: {
        plan: true,
        business: { select: { id: true, name: true, slug: true, city: true, country: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({ ...requestView(r), business: r.business }));
  }

  /** Approve: the business gets the plan as a grant (replacing a grant or trial it may have). */
  async approveRequest(
    requestId: string,
    adminId: string,
    input: { until?: string | undefined; note?: string | undefined; planCode?: string | undefined },
    ctx: RequestContext,
  ) {
    const request = await this.db.planRequest.findFirst({
      where: { id: requestId, status: 'pending' },
      include: { plan: true },
    });
    if (!request) throw AppError.notFound('Open plan request');
    const planCode = input.planCode ?? request.plan.code;
    await this.db.$transaction(async (tx) => {
      const grant = await this.createGrant(
        tx,
        {
          planCode,
          businessId: request.businessId,
          until: input.until,
          note: input.note ?? `Approved plan request ${request.id}`,
          replace: true,
        },
        adminId,
        ctx,
      );
      const { count } = await tx.planRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: {
          status: 'approved',
          decidedById: adminId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
          subscriptionId: grant.id,
        },
      });
      if (count === 0) throw AppError.conflict('The request was changed meanwhile');
      await audit(tx, adminId, 'billing.plan_request_approved', 'plan_request', requestId, ctx, {
        plan: planCode,
        until: input.until ?? null,
      });
    });
    return this.request(requestId);
  }

  async declineRequest(requestId: string, adminId: string, note: string, ctx: RequestContext) {
    const { count } = await this.db.planRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'declined', decidedById: adminId, decidedAt: new Date(), decisionNote: note },
    });
    if (count === 0) throw AppError.notFound('Open plan request');
    await audit(this.db, adminId, 'billing.plan_request_declined', 'plan_request', requestId, ctx, { note });
    return this.request(requestId);
  }

  /** Give any plan to any account, free of charge, optionally until a date. */
  async grant(input: GrantInput, adminId: string, ctx: RequestContext) {
    const sub = await this.db.$transaction((tx) => this.createGrant(tx, input, adminId, ctx));
    return subscriptionView(await this.load(sub.id));
  }

  /** Who bills a subscription: manual, trial, paddle… (null if unknown). */
  async providerOf(subscriptionId: string): Promise<string | null> {
    const sub = await this.db.subscription.findUnique({
      where: { id: subscriptionId },
      select: { provider: true },
    });
    return sub?.provider ?? null;
  }

  /** End a grant or trial now. Store subscriptions are cancelled in the store. */
  async end(subscriptionId: string, adminId: string, reason: string, ctx: RequestContext) {
    const sub = await this.db.subscription.findUnique({ where: { id: subscriptionId } });
    if (!sub) throw AppError.notFound('Subscription');
    if (!OURS.includes(sub.provider)) {
      throw AppError.conflict(
        `This subscription is billed by ${sub.provider}; cancel it there so the customer stops being charged`,
      );
    }
    if (LIVE.includes(sub.status as (typeof LIVE)[number])) {
      await this.db.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: sub.id },
          data: { status: 'cancelled', cancelledAt: new Date() },
        });
        await audit(tx, adminId, 'billing.subscription_ended', 'subscription', sub.id, ctx, { reason });
      });
    }
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
      ...(query.status && { status: query.status as (typeof LIVE)[number] }),
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

  /** Mark trials and grants whose end date passed as `expired` (also run periodically). */
  async expireEnded(db: Database | Transaction = this.db, account?: Account): Promise<number> {
    const { count } = await db.subscription.updateMany({
      where: {
        provider: { in: OURS },
        status: { in: [...LIVE] },
        currentPeriodEnd: { lte: new Date() },
        ...(account && ownerOf(account)),
      },
      data: { status: 'expired' },
    });
    return count;
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Can this account start a free trial now, and of what? */
  private async trialOffer(audience: Audience, account: Account) {
    const settings = await this.db.billingSettings.findUnique({
      where: { audience },
      include: { trialPlan: true },
    });
    const plan = settings?.trialPlan;
    const base = {
      days: settings?.trialDays ?? null,
      plan: plan ? { code: plan.code, name: plan.name } : null,
      endsAt: null as string | null,
    };
    const no = (reason: string, endsAt: string | null = null) => ({
      available: false,
      reason,
      ...base,
      endsAt,
    });
    if (!settings?.enabled) return no('billing_off');
    const owner = ownerOf(account);
    const [used, live] = await Promise.all([
      this.db.subscription.findFirst({ where: { ...owner, provider: 'trial' } }),
      this.db.subscription.findFirst({
        where: {
          ...owner,
          status: { in: [...LIVE] },
          OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
        },
      }),
    ]);
    const endsAt = used?.currentPeriodEnd?.toISOString() ?? null;
    if (used && live?.id === used.id) return no('in_trial', endsAt);
    if (used) return no('already_used', endsAt);
    if (live) return no('has_subscription');
    if (!settings.trialEnabled || !plan || plan.archivedAt) return no('trials_off');
    return { available: true, reason: null, ...base };
  }

  private async startTrial(audience: Audience, account: Account, actorId: string, ctx: RequestContext) {
    const offer = await this.trialOffer(audience, account);
    if (!offer.available) {
      throw new AppError(TRIAL_REFUSALS[offer.reason!] ?? 'No trial available', ErrorCodes.CONFLICT, 409, {
        details: { reason: offer.reason },
      });
    }
    const settings = await this.db.billingSettings.findUniqueOrThrow({ where: { audience } });
    const now = new Date();
    try {
      await this.db.$transaction(async (tx) => {
        await this.expireEnded(tx, account);
        const sub = await tx.subscription.create({
          data: {
            planId: settings.trialPlanId!,
            ...ownerOf(account),
            provider: 'trial',
            status: 'trialing',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + settings.trialDays * 86_400_000),
          },
        });
        await audit(tx, actorId, 'billing.trial_started', 'subscription', sub.id, ctx, {
          audience,
          days: settings.trialDays,
        });
      });
    } catch (err) {
      // Two taps at once: the database lets exactly one trial through.
      if (isUniqueViolation(err)) throw AppError.conflict('The free trial can only be used once');
      throw err;
    }
  }

  private async createGrant(tx: Transaction, input: GrantInput, adminId: string, ctx: RequestContext) {
    const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw AppError.notFound('Plan');
    if (plan.audience !== (input.userId ? 'user' : 'business')) {
      throw AppError.badRequest(`"${plan.code}" is a ${plan.audience} plan`);
    }
    if (input.userId && !(await tx.user.findUnique({ where: { id: input.userId } }))) {
      throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    }
    if (
      input.businessId &&
      !(await tx.business.findFirst({ where: { id: input.businessId, deletedAt: null } }))
    ) {
      throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    }
    const until = input.until ? new Date(input.until) : null;
    if (until && until <= new Date()) throw AppError.badRequest('`until` must be in the future');
    const account: Account = input.userId ? { userId: input.userId } : { businessId: input.businessId! };

    await this.expireEnded(tx, account);
    const current = await tx.subscription.findFirst({
      where: { ...ownerOf(account), status: { in: [...LIVE] } },
    });
    if (current) {
      if (!input.replace) {
        throw AppError.conflict('This account already has a live subscription; end it first or replace it');
      }
      if (!OURS.includes(current.provider)) {
        throw AppError.conflict(`The current plan is billed by ${current.provider}; cancel it there first`);
      }
      await tx.subscription.update({
        where: { id: current.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
    }
    try {
      const sub = await tx.subscription.create({
        data: {
          planId: plan.id,
          ...ownerOf(account),
          provider: 'manual',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: until,
          grantedById: adminId,
          grantNote: input.note,
        },
      });
      await audit(tx, adminId, 'billing.plan_granted', 'subscription', sub.id, ctx, {
        plan: plan.code,
        userId: input.userId ?? null,
        businessId: input.businessId ?? null,
        until: input.until ?? null,
        note: input.note,
        replaced: current?.id ?? null,
      });
      return sub;
    } catch (err) {
      if (isUniqueViolation(err) && constraintNameOf(err)?.startsWith('subscriptions_one_live')) {
        throw AppError.conflict('This account already has a live subscription');
      }
      throw err;
    }
  }

  private async request(id: string) {
    return requestView(
      await this.db.planRequest.findUniqueOrThrow({ where: { id }, include: { plan: true } }),
    );
  }

  private load(id: string) {
    return this.db.subscription.findUniqueOrThrow({ where: { id }, include: { plan: true } });
  }
}

export interface GrantInput {
  planCode: string;
  userId?: string | undefined;
  businessId?: string | undefined;
  until?: string | undefined;
  note: string;
  /** End the account's current grant or trial and put this plan in its place. */
  replace?: boolean | undefined;
}

const ownerOf = (account: Account) =>
  'userId' in account ? { userId: account.userId } : { businessId: account.businessId };

function audit(
  db: Database | Transaction,
  userId: string,
  action: string,
  resourceType: string,
  resourceId: string,
  ctx: RequestContext,
  newValues: Record<string, string | number | boolean | null>,
) {
  return recordAudit(db, { userId, action, resourceType, resourceId, newValues, ...auditCtx(ctx) });
}

function summary(e: Entitlements, used: Record<string, number>) {
  return {
    plan: { code: e.plan.code, name: e.plan.name },
    /** subscription | trial | default (no subscription) | billing_off (everyone unlimited for now) */
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

function requestView(r: {
  id: string;
  businessId: string;
  plan: { code: string; name: string };
  message: string;
  status: string;
  decidedAt: Date | null;
  decisionNote: string | null;
  subscriptionId: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    businessId: r.businessId,
    plan: { code: r.plan.code, name: r.plan.name },
    message: r.message,
    status: r.status,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    subscriptionId: r.subscriptionId,
    createdAt: r.createdAt.toISOString(),
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
