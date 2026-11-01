import {
  businessEntitlementsOnShard,
  customerEntitlements,
  type Audience,
  type Entitlements,
} from '@buku/billing';
import { AppError, ErrorCodes, type Actor } from '@buku/common';
import {
  constraintNameOf,
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';
import { auditByPerson, LIVE } from './shared.js';

/**
 * Accounts and their plans:
 *
 *  • what a business is on, and how much of it they use; customers use BUKU for free (D-101);
 *  • the FREE TRIAL — a month (by default) of a paid plan that each business
 *    can start ONCE, whenever it chooses. Admins switch trials off; then the
 *    Starter plan is simply the normal plan;
 *  • GRANTS — any plan given to any business free of charge (partners, a large
 *    organisation on Enterprise to win them as a customer, support gestures),
 *    optionally until a date; a grant can replace the current grant or trial;
 *  • PLAN REQUESTS — a business asks for a plan (e.g. Enterprise), an admin
 *    approves (→ a grant) or declines.
 *
 * Trials and grants with an end date stop counting once it passes
 * (entitlements check the date); `expireEnded` also marks them `expired` so
 * the business can be given a new plan.
 *
 * Database v2 (D3g): subscriptions and plan requests live on the business's shard, one live
 * subscription at a time (a database rule); plans and settings are read on the directory, where
 * billing-service keeps them. Admin lists visit every business shard; a subscription or request
 * named by its ID is found on whichever shard holds it.
 */

/** Sources we manage ourselves; store subscriptions are changed in the store. */
const OURS = ['manual', 'trial'];

const TRIAL_REFUSALS: Record<string, string> = {
  billing_off: 'Everything is included right now; there is nothing to try',
  trials_off: 'Free trials aren’t available at the moment',
  in_trial: 'Your free trial is already running',
  already_used: 'The free trial can only be used once',
  has_subscription: 'You already have a plan',
};

export interface GrantInput {
  planCode: string;
  /** Customers are free (D-101): a grant to a person is refused. */
  userId?: string | undefined;
  /** The business, by its public ID. */
  businessId?: string | undefined;
  until?: string | undefined;
  note: string;
  /** End the business's current grant or trial and put this plan in its place. */
  replace?: boolean | undefined;
}

export class AccountService {
  constructor(private readonly plane: DataPlane) {}

  // ── Customers and businesses ─────────────────────────────────────────────

  /** A customer's account: free (D-101), with their visits shown (never limited). */
  async mine(userId: bigint) {
    const e = await customerEntitlements(this.plane.directory);
    const settings = await this.plane.directory.billingSettings.findUnique({
      where: { audience: 'user' },
      include: { trialPlan: true },
    });
    return {
      ...summary(e, { visits: await this.visitsOf(userId) }),
      trial: {
        available: false,
        reason: 'billing_off',
        days: settings?.trialDays ?? null,
        plan: settings?.trialPlan ? { code: settings.trialPlan.code, name: settings.trialPlan.name } : null,
        endsAt: null,
      },
    };
  }

  /** Customers have nothing to try: everything is included (D-101). */
  startMyTrial(): Promise<never> {
    return Promise.reject(refusal('billing_off'));
  }

  async business(businessId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return this.businessSummary(tx, businessId);
    });
  }

  async startBusinessTrial(businessId: bigint, actor: Actor, ctx: RequestContext) {
    const settings = await this.plane.directory.billingSettings.findUniqueOrThrow({
      where: { audience: 'business' },
    });
    try {
      await this.plane.inBusiness(businessId, async (tx) => {
        await requireBusinessPermissionOnShard(tx, businessId, actor, 'billing.manage');
        const offer = await this.trialOffer(tx, businessId);
        if (!offer.available) throw refusal(offer.reason!);
        await expireEnded(tx, businessId);
        const now = new Date();
        const sub = await tx.subscription.create({
          data: {
            id: this.plane.id(),
            businessId,
            planId: settings.trialPlanId!,
            provider: 'trial',
            status: 'trialing',
            currentPeriodStart: now,
            currentPeriodEnd: new Date(now.getTime() + settings.trialDays * 86_400_000),
          },
        });
        await recordShardAudit(tx, this.plane.id(), {
          userId: actor.id,
          action: 'billing.trial_started',
          resourceType: 'subscription',
          resourceId: sub.id,
          newValues: { audience: 'business', days: settings.trialDays },
          ...auditCtx(ctx),
        });
      });
    } catch (err) {
      // Two taps at once: the database lets exactly one trial through.
      if (isUniqueViolation(err)) throw AppError.conflict('The free trial can only be used once');
      throw err;
    }
    return this.business(businessId, actor);
  }

  // ── Plan requests (businesses) ───────────────────────────────────────────

  async requestPlan(
    businessId: bigint,
    actor: Actor,
    input: { planCode: string; message: string },
    ctx: RequestContext,
  ) {
    const plan = await this.plane.directory.plan.findUnique({ where: { code: input.planCode } });
    try {
      return await this.plane.inBusiness(businessId, async (tx) => {
        await requireBusinessPermissionOnShard(tx, businessId, actor, 'billing.manage');
        if (!plan || plan.audience !== 'business' || plan.archivedAt || !plan.isPublic)
          throw AppError.notFound('Plan');
        const request = await tx.planRequest.create({
          data: {
            id: this.plane.id(),
            businessId,
            planId: plan.id,
            requestedById: actor.id,
            message: input.message,
          },
        });
        await recordShardAudit(tx, this.plane.id(), {
          userId: actor.id,
          action: 'billing.plan_requested',
          resourceType: 'plan_request',
          resourceId: request.id,
          newValues: { plan: plan.code },
          ...auditCtx(ctx),
        });
        return (await this.requestViews(tx, [request]))[0]!;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('This business already has an open plan request');
      throw err;
    }
  }

  async businessRequests(businessId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      const rows = await tx.planRequest.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      return this.requestViews(tx, rows);
    });
  }

  async withdrawRequest(businessId: bigint, requestId: bigint, actor: Actor, ctx: RequestContext) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'billing.manage');
      const { count } = await tx.planRequest.updateMany({
        where: { id: requestId, businessId, status: 'pending' },
        data: { status: 'withdrawn' },
      });
      if (count === 0) throw AppError.notFound('Open plan request');
      await recordShardAudit(tx, this.plane.id(), {
        userId: actor.id,
        action: 'billing.plan_request_withdrawn',
        resourceType: 'plan_request',
        resourceId: requestId,
        ...auditCtx(ctx),
      });
      return this.requestView(tx, requestId);
    });
  }

  // ── Admin ────────────────────────────────────────────────────────────────

  /** Plan requests on every business shard, oldest first (the admins' queue). */
  async listRequests(status: 'pending' | 'approved' | 'declined' | 'withdrawn' | undefined) {
    const perShard = await this.plane.acrossBusinesses(async (tx) => {
      const rows = await tx.planRequest.findMany({
        where: status ? { status } : {},
        include: {
          business: { select: { publicId: true, name: true, slug: true, city: true, country: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: 200,
      });
      const views = await this.requestViews(tx, rows);
      return rows.map((r, i) => ({
        at: r.createdAt.getTime(),
        view: {
          ...views[i]!,
          business: {
            id: r.business.publicId,
            name: r.business.name,
            slug: r.business.slug,
            city: r.business.city,
            country: r.business.country,
          },
        },
      }));
    });
    return perShard
      .flat()
      .sort((a, b) => a.at - b.at)
      .slice(0, 200)
      .map((r) => r.view);
  }

  /** Approve: the business gets the plan as a grant (replacing a grant or trial it may have). */
  async approveRequest(
    requestId: bigint,
    adminId: bigint,
    input: { until?: string | undefined; note?: string | undefined; planCode?: string | undefined },
    ctx: RequestContext,
  ) {
    const businessId = await this.businessOfRequest(requestId);
    let given = '';
    const view = await this.plane.inBusiness(businessId, async (tx) => {
      const request = await tx.planRequest.findFirst({ where: { id: requestId, status: 'pending' } });
      if (!request) throw AppError.notFound('Open plan request');
      const requested = await this.plane.directory.plan.findUnique({ where: { id: request.planId } });
      const planCode = input.planCode ?? requested?.code;
      if (!planCode) throw AppError.notFound('Plan');
      given = planCode;
      const grant = await this.createGrant(
        tx,
        {
          planCode,
          businessId,
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
      await recordShardAudit(tx, this.plane.id(), {
        userId: adminId,
        action: 'billing.plan_request_approved',
        resourceType: 'plan_request',
        resourceId: requestId,
        newValues: { plan: planCode, until: input.until ?? null },
        ...auditCtx(ctx),
      });
      return this.requestView(tx, requestId);
    });
    // The same step on the admin's own record, for the console's audit log (D-132).
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'admin.plan_request_approved',
      resourceType: 'plan_request',
      resourceId: requestId,
      newValues: { plan: given, until: input.until ?? null, ...(input.note && { reason: input.note }) },
    });
    return view;
  }

  async declineRequest(requestId: bigint, adminId: bigint, note: string, ctx: RequestContext) {
    const businessId = await this.businessOfRequest(requestId);
    const view = await this.plane.inBusiness(businessId, async (tx) => {
      const { count } = await tx.planRequest.updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'declined', decidedById: adminId, decidedAt: new Date(), decisionNote: note },
      });
      if (count === 0) throw AppError.notFound('Open plan request');
      await recordShardAudit(tx, this.plane.id(), {
        userId: adminId,
        action: 'billing.plan_request_declined',
        resourceType: 'plan_request',
        resourceId: requestId,
        newValues: { note },
        ...auditCtx(ctx),
      });
      return this.requestView(tx, requestId);
    });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'admin.plan_request_declined',
      resourceType: 'plan_request',
      resourceId: requestId,
      newValues: { reason: note },
    });
    return view;
  }

  /** Give any plan to any business, free of charge, optionally until a date. */
  async grant(input: GrantInput, adminId: bigint, ctx: RequestContext) {
    if (input.userId) throw AppError.conflict('Customers use BUKU for free; there is no plan to give them');
    const businessId = await this.plane.idOfPublic('business', input.businessId!);
    if (businessId === null) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const sub = await this.createGrant(tx, { ...input, businessId }, adminId, ctx);
      return sub.id;
    });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'admin.plan_granted',
      resourceType: 'subscription',
      resourceId: id,
      newValues: {
        plan: input.planCode,
        business: input.businessId,
        until: input.until ?? null,
        reason: input.note,
      },
    });
    return this.subscriptionView(id);
  }

  /** Who bills a subscription: manual, trial, paddle… (null if unknown). */
  async providerOf(subscriptionId: bigint): Promise<string | null> {
    const found = await this.findSubscription(subscriptionId);
    return found?.provider ?? null;
  }

  /** End a grant or trial now. Store subscriptions are cancelled in the store. */
  async end(subscriptionId: bigint, adminId: bigint, reason: string, ctx: RequestContext) {
    const found = await this.findSubscription(subscriptionId);
    if (!found) throw AppError.notFound('Subscription');
    await this.plane.inBusiness(found.businessId, async (tx) => {
      const sub = await tx.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
      if (!OURS.includes(sub.provider)) {
        throw AppError.conflict(
          `This subscription is billed by ${sub.provider}; cancel it there so the customer stops being charged`,
        );
      }
      if (!(LIVE as readonly string[]).includes(sub.status)) return;
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status: 'cancelled', cancelledAt: new Date() },
      });
      await recordShardAudit(tx, this.plane.id(), {
        userId: adminId,
        action: 'billing.subscription_ended',
        resourceType: 'subscription',
        resourceId: sub.id,
        newValues: { reason },
        ...auditCtx(ctx),
      });
    });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'admin.subscription_ended',
      resourceType: 'subscription',
      resourceId: subscriptionId,
      newValues: { reason },
    });
    return this.subscriptionView(subscriptionId);
  }

  /** Subscriptions on every business shard, newest first. */
  async list(query: {
    planCode?: string | undefined;
    status?: string | undefined;
    page: number;
    limit: number;
  }) {
    const plan = query.planCode
      ? await this.plane.directory.plan.findUnique({ where: { code: query.planCode } })
      : null;
    if (query.planCode && !plan) {
      return { items: [], meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0 } };
    }
    const where = {
      ...(plan && { planId: plan.id }),
      ...(query.status && { status: query.status }),
    };
    const perShard = await this.plane.acrossBusinesses(async (tx) => ({
      total: await tx.subscription.count({ where }),
      rows: await tx.subscription.findMany({
        where,
        include: { business: { select: { publicId: true, name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.page * query.limit,
      }),
    }));
    const rows = perShard
      .flatMap((s) => s.rows)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice((query.page - 1) * query.limit, query.page * query.limit);
    const total = perShard.reduce((n, s) => n + s.total, 0);
    const plans = await this.planNames(rows.map((r) => r.planId));
    return {
      items: rows.map((r) => ({
        ...subscriptionView(r, r.business.publicId, plans),
        businessName: r.business.name,
      })),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  /** Mark trials and grants whose end date passed as `expired`, on every business shard. */
  async expireEnded(): Promise<number> {
    const counts = await this.plane.acrossBusinesses((tx) => expireEnded(tx));
    return counts.reduce((n, c) => n + c, 0);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async businessSummary(tx: BusinessTx, businessId: bigint) {
    const e = await businessEntitlementsOnShard(tx, businessId);
    const team = await tx.businessMember.count({ where: { businessId, status: 'active' } });
    const staff = await tx.staff.count({ where: { businessId, isActive: true } });
    const services = await tx.service.count({ where: { businessId, isActive: true } });
    const photos = await tx.businessPhoto.count({ where: { businessId } });
    const trial = await this.trialOffer(tx, businessId);
    const request = await tx.planRequest.findFirst({ where: { businessId, status: 'pending' } });
    return {
      ...summary(e, { team_accounts: team, staff_profiles: staff, services, photos }),
      trial,
      pendingPlanRequest: request ? (await this.requestViews(tx, [request]))[0]! : null,
    };
  }

  /** Can this business start a free trial now, and of what? Settings from the directory. */
  private async trialOffer(tx: BusinessTx, businessId: bigint) {
    const audience: Audience = 'business';
    const settings = await this.plane.directory.billingSettings.findUnique({
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
    const used = await tx.subscription.findFirst({ where: { businessId, provider: 'trial' } });
    const live = await tx.subscription.findFirst({
      where: {
        businessId,
        status: { in: [...LIVE] },
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: new Date() } }],
      },
    });
    const endsAt = used?.currentPeriodEnd?.toISOString() ?? null;
    if (used && live?.id === used.id) return no('in_trial', endsAt);
    if (used) return no('already_used', endsAt);
    if (live) return no('has_subscription');
    if (!settings.trialEnabled || !plan || plan.archivedAt) return no('trials_off');
    return { available: true, reason: null, ...base };
  }

  private async createGrant(
    tx: BusinessTx,
    input: Omit<GrantInput, 'businessId' | 'userId'> & { businessId: bigint },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const plan = await this.plane.directory.plan.findUnique({ where: { code: input.planCode } });
    if (!plan) throw AppError.notFound('Plan');
    if (plan.audience !== 'business') throw AppError.badRequest(`"${plan.code}" is a ${plan.audience} plan`);
    if (!(await tx.business.findFirst({ where: { id: input.businessId, deletedAt: null } }))) {
      throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    }
    const until = input.until ? new Date(input.until) : null;
    if (until && until <= new Date()) throw AppError.badRequest('`until` must be in the future');

    await expireEnded(tx, input.businessId);
    const current = await tx.subscription.findFirst({
      where: { businessId: input.businessId, status: { in: [...LIVE] } },
    });
    if (current) {
      if (!input.replace) {
        throw AppError.conflict('This business already has a live subscription; end it first or replace it');
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
          id: this.plane.id(),
          businessId: input.businessId,
          planId: plan.id,
          provider: 'manual',
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: until,
          grantedById: adminId,
          grantNote: input.note,
        },
      });
      await recordShardAudit(tx, this.plane.id(), {
        userId: adminId,
        action: 'billing.plan_granted',
        resourceType: 'subscription',
        resourceId: sub.id,
        newValues: {
          plan: plan.code,
          until: input.until ?? null,
          note: input.note,
          replaced: current?.id ?? null,
        },
        ...auditCtx(ctx),
      });
      return sub;
    } catch (err) {
      if (isUniqueViolation(err) && constraintNameOf(err) === 'subscriptions_one_live') {
        throw AppError.conflict('This business already has a live subscription');
      }
      throw err;
    }
  }

  /** The business shard holding a plan request (admins name it by its ID alone). */
  private async businessOfRequest(requestId: bigint): Promise<bigint> {
    const found = (
      await this.plane.acrossBusinesses((tx) =>
        tx.planRequest.findFirst({ where: { id: requestId }, select: { businessId: true } }),
      )
    ).find(Boolean);
    if (!found) throw AppError.notFound('Open plan request');
    return found.businessId;
  }

  /** A subscription named by its ID alone, on whichever business shard holds it. */
  private async findSubscription(subscriptionId: bigint) {
    return (
      (
        await this.plane.acrossBusinesses((tx) =>
          tx.subscription.findFirst({
            where: { id: subscriptionId },
            select: { businessId: true, provider: true },
          }),
        )
      ).find(Boolean) ?? null
    );
  }

  private async subscriptionView(subscriptionId: bigint) {
    const found = await this.findSubscription(subscriptionId);
    if (!found) throw AppError.notFound('Subscription');
    const row = await this.plane.inBusiness(found.businessId, (tx) =>
      tx.subscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { business: { select: { publicId: true } } },
      }),
    );
    return subscriptionView(row, row.business.publicId, await this.planNames([row.planId]));
  }

  private async requestView(tx: BusinessTx, requestId: bigint) {
    return (
      await this.requestViews(tx, [await tx.planRequest.findUniqueOrThrow({ where: { id: requestId } })])
    )[0]!;
  }

  private async requestViews(
    tx: BusinessTx,
    rows: {
      id: bigint;
      businessId: bigint;
      planId: bigint;
      message: string;
      status: string;
      decidedAt: Date | null;
      decisionNote: string | null;
      subscriptionId: bigint | null;
      createdAt: Date;
    }[],
  ) {
    const plans = await this.planNames(rows.map((r) => r.planId));
    const businesses = await tx.business.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.businessId))] } },
      select: { id: true, publicId: true },
    });
    const publicIds = new Map(businesses.map((b) => [b.id, b.publicId]));
    return rows.map((r) => ({
      id: r.id.toString(),
      businessId: publicIds.get(r.businessId)!,
      plan: plans.get(r.planId) ?? { code: 'unknown', name: 'Unknown plan' },
      message: r.message,
      status: r.status,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decisionNote: r.decisionNote,
      subscriptionId: r.subscriptionId?.toString() ?? null,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Plans' codes and names, from the directory. */
  private async planNames(ids: bigint[]): Promise<Map<bigint, { code: string; name: string }>> {
    const plans = await this.plane.directory.plan.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, code: true, name: true },
    });
    return new Map(plans.map((p) => [p.id, { code: p.code, name: p.name }]));
  }

  /**
   * A customer's "visits", from their own shard: appointments that are live, done or missed, and
   * queue visits and no-shows. Cancelled, declined and rescheduled-away ones don't count — they
   * didn't get (or block) a service with them. Shown on the account only (D-101).
   */
  private async visitsOf(userId: bigint): Promise<number> {
    const db = await this.plane.user(userId);
    const appointments = await db.userAppointment.count({
      where: { userId, status: { in: ['pending', 'confirmed', 'checked_in', 'completed', 'no_show'] } },
    });
    const tickets = await db.userVisitOutcome.count({ where: { userId, source: 'queue' } });
    return appointments + tickets;
  }
}

/** Trials and grants whose end date passed become `expired` (all of one shard, or one business). */
async function expireEnded(tx: BusinessTx, businessId?: bigint): Promise<number> {
  const { count } = await tx.subscription.updateMany({
    where: {
      provider: { in: OURS },
      status: { in: [...LIVE] },
      currentPeriodEnd: { lte: new Date() },
      ...(businessId !== undefined && { businessId }),
    },
    data: { status: 'expired' },
  });
  return count;
}

function refusal(reason: string) {
  return new AppError(TRIAL_REFUSALS[reason] ?? 'No trial available', ErrorCodes.CONFLICT, 409, {
    details: { reason },
  });
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

function subscriptionView(
  s: {
    id: bigint;
    planId: bigint;
    provider: string;
    channel: string | null;
    status: string;
    currentPeriodStart: Date | null;
    currentPeriodEnd: Date | null;
    cancelAtPeriodEnd: boolean;
    cancelledAt: Date | null;
    grantNote: string | null;
    createdAt: Date;
  },
  businessPublicId: string,
  plans: Map<bigint, { code: string; name: string }>,
) {
  return {
    id: s.id.toString(),
    plan: plans.get(s.planId) ?? { code: 'unknown', name: 'Unknown plan' },
    businessId: businessPublicId,
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
