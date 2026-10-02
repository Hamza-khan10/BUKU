import {
  computeEconomics,
  describeKeys,
  featureKeysOf,
  limitKeysOf,
  readPlanValues,
  type Audience,
} from '@buku/billing';
import { AppError, ErrorCodes } from '@buku/common';
import { isUniqueViolation, Prisma, recordAudit, type Database, type Transaction } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';

/**
 * The catalog (D-065): plans, prices, the on/off switch per audience, running
 * costs and channel fees. Everything is data that platform admins change at
 * any time; every change is audited.
 *
 *  • Prices are never edited: a new price replaces the one in force (which is
 *    archived) so existing subscribers keep the price they agreed to.
 *  • Plans are archived, never deleted: hidden and not for sale, while current
 *    subscribers keep them. A plan an audience falls back to can't be archived.
 */

type Channel = 'web' | 'android' | 'ios';
type Interval = 'month' | 'year';

export interface PlanInput {
  code: string;
  audience: Audience;
  name: string;
  tagline?: string | null | undefined;
  benefits?: string[] | undefined;
  limits?: Record<string, number | null> | undefined;
  features?: Record<string, boolean> | undefined;
  isPublic?: boolean | undefined;
  sortOrder?: number | undefined;
}

export interface PriceInput {
  channel: Channel;
  currency: string;
  amount: number;
  interval: Interval;
  taxInclusive?: boolean | undefined;
  trialDays?: number | undefined;
  externalPriceId?: string | undefined;
}

const LIVE_STATUSES = ['active', 'trialing', 'past_due', 'paused'] as const;
const planInclude = {
  prices: { orderBy: [{ archivedAt: 'asc' as const }, { createdAt: 'desc' as const }] },
} satisfies Prisma.PlanInclude;
type PlanRow = Prisma.PlanGetPayload<{ include: typeof planInclude }>;

export class CatalogService {
  constructor(private readonly db: Database) {}

  // ── Public: the pricing page ─────────────────────────────────────────────

  /**
   * Plans on sale for an audience, with the price on one channel, their
   * benefits and a comparison of limits and features — everything the
   * pricing page needs to show what each plan gives.
   */
  async pricing(audience: Audience, channel: Channel, currency: string) {
    const [settings, plans] = await Promise.all([
      this.db.billingSettings.findUnique({
        where: { audience },
        include: { defaultPlan: true, trialPlan: true },
      }),
      this.db.plan.findMany({
        where: { audience, isPublic: true, archivedAt: null },
        orderBy: { sortOrder: 'asc' },
        include: { prices: { where: { archivedAt: null, channel, currency } } },
      }),
    ]);
    return {
      audience,
      channel,
      currency,
      /** False while billing is off: everyone has everything, and the page can say so. */
      billingEnabled: settings?.enabled ?? false,
      defaultPlan: settings ? settings.defaultPlan.code : null,
      /** "Try <plan> free for <days> days" — once per account, started whenever they like. */
      trial:
        settings?.trialEnabled && settings.trialPlan && !settings.trialPlan.archivedAt
          ? {
              days: settings.trialDays,
              plan: { code: settings.trialPlan.code, name: settings.trialPlan.name },
            }
          : null,
      comparison: describeKeys(audience),
      plans: plans
        // A paid plan without a price on this channel isn't for sale here; free plans always show.
        .filter((p) => p.prices.length > 0 || p.code === settings?.defaultPlan.code)
        .map((p) => ({
          code: p.code,
          name: p.name,
          tagline: p.tagline,
          benefits: p.benefits as string[],
          ...readPlanValues(audience, p.limits, p.features),
          prices: p.prices.map((x) => ({
            id: x.id,
            amount: x.amount.toFixed(2),
            currency: x.currency,
            interval: x.interval,
            taxInclusive: x.taxInclusive,
            trialDays: x.trialDays,
          })),
          free: p.prices.length === 0,
        })),
    };
  }

  // ── Admin: plans ─────────────────────────────────────────────────────────

  async listPlans() {
    const [plans, settings, counts] = await Promise.all([
      this.db.plan.findMany({ orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }], include: planInclude }),
      this.db.billingSettings.findMany(),
      this.db.subscription.groupBy({
        by: ['planId'],
        where: { status: { in: [...LIVE_STATUSES] } },
        _count: { _all: true },
      }),
    ]);
    const subscribers = new Map(counts.map((c) => [c.planId, c._count._all]));
    return plans.map((p) => ({
      ...this.planView(p),
      subscribers: subscribers.get(p.id) ?? 0,
      usedAs: settings
        .flatMap((s) => [
          s.defaultPlanId === p.id ? `default for ${s.audience}s` : null,
          s.planWhenDisabledId === p.id ? `plan for ${s.audience}s while billing is off` : null,
          s.trialPlanId === p.id ? `free trial for ${s.audience}s` : null,
        ])
        .filter(Boolean),
    }));
  }

  async createPlan(input: PlanInput, adminId: string, ctx: RequestContext) {
    this.validateValues(input.audience, input.limits, input.features);
    try {
      const plan = await this.db.$transaction(async (tx) => {
        const plan = await tx.plan.create({
          data: {
            code: input.code,
            audience: input.audience,
            name: input.name,
            tagline: input.tagline ?? null,
            benefits: input.benefits ?? [],
            limits: (input.limits ?? {}) as Prisma.InputJsonObject,
            features: (input.features ?? {}) as Prisma.InputJsonObject,
            isPublic: input.isPublic ?? true,
            sortOrder: input.sortOrder ?? 0,
          },
          include: planInclude,
        });
        await this.audit(tx, adminId, 'billing.plan_created', 'plan', plan.id, ctx, { code: plan.code });
        return plan;
      });
      return this.planView(plan);
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(`A plan with code "${input.code}" already exists`);
      throw err;
    }
  }

  /** Limits and features merge: keys given are set (null = unlimited), others stay. */
  async updatePlan(
    code: string,
    changes: Partial<Omit<PlanInput, 'code' | 'audience'>>,
    adminId: string,
    ctx: RequestContext,
  ) {
    const plan = await this.findPlan(code);
    this.validateValues(plan.audience, changes.limits, changes.features);
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.plan.update({
        where: { id: plan.id },
        data: {
          ...(changes.name !== undefined && { name: changes.name }),
          ...(changes.tagline !== undefined && { tagline: changes.tagline }),
          ...(changes.benefits !== undefined && { benefits: changes.benefits }),
          ...(changes.isPublic !== undefined && { isPublic: changes.isPublic }),
          ...(changes.sortOrder !== undefined && { sortOrder: changes.sortOrder }),
          ...(changes.limits && {
            limits: { ...(plan.limits as object), ...changes.limits } as Prisma.InputJsonObject,
          }),
          ...(changes.features && {
            features: { ...(plan.features as object), ...changes.features } as Prisma.InputJsonObject,
          }),
        },
        include: planInclude,
      });
      await this.audit(tx, adminId, 'billing.plan_updated', 'plan', plan.id, ctx, {
        code,
        old: { limits: plan.limits, features: plan.features, name: plan.name, isPublic: plan.isPublic },
        changes,
      });
      return updated;
    });
    return this.planView(updated);
  }

  /** Stop selling a plan. Subscribers keep it until moved; the audience's fallback plans can't be archived. */
  async archivePlan(code: string, adminId: string, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    const usedBy = await this.db.billingSettings.findFirst({
      where: { OR: [{ defaultPlanId: plan.id }, { planWhenDisabledId: plan.id }, { trialPlanId: plan.id }] },
    });
    if (usedBy) {
      const role = usedBy.trialPlanId === plan.id ? 'free-trial' : 'fallback';
      throw AppError.conflict(
        `"${code}" is the ${usedBy.audience}s’ ${role} plan; choose another one in the billing settings first`,
      );
    }
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.plan.update({
        where: { id: plan.id },
        data: { archivedAt: plan.archivedAt ?? new Date() },
        include: planInclude,
      });
      await this.audit(tx, adminId, 'billing.plan_archived', 'plan', plan.id, ctx, { code });
      return updated;
    });
    return this.planView(updated);
  }

  async restorePlan(code: string, adminId: string, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.plan.update({
        where: { id: plan.id },
        data: { archivedAt: null },
        include: planInclude,
      });
      await this.audit(tx, adminId, 'billing.plan_restored', 'plan', plan.id, ctx, { code });
      return updated;
    });
    return this.planView(updated);
  }

  // ── Admin: prices ────────────────────────────────────────────────────────

  /**
   * Set a new price for a plan on a channel. The price in force (same channel,
   * currency and interval) is archived in the same transaction: new
   * subscribers pay the new price, existing ones keep theirs until moved.
   */
  async setPrice(code: string, input: PriceInput, adminId: string, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    if (plan.archivedAt) throw AppError.conflict('Restore the plan before giving it a price');
    try {
      const result = await this.db.$transaction(async (tx) => {
        const previous = await tx.planPrice.findFirst({
          where: {
            planId: plan.id,
            channel: input.channel,
            currency: input.currency,
            interval: input.interval,
            archivedAt: null,
          },
        });
        if (previous)
          await tx.planPrice.update({ where: { id: previous.id }, data: { archivedAt: new Date() } });
        const price = await tx.planPrice.create({
          data: {
            planId: plan.id,
            channel: input.channel,
            currency: input.currency,
            amount: input.amount,
            interval: input.interval,
            taxInclusive: input.taxInclusive ?? false,
            trialDays: input.trialDays ?? 0,
            externalPriceId: input.externalPriceId ?? null,
            createdById: adminId,
          },
        });
        const keepingOld = previous
          ? await tx.subscription.count({
              where: { priceId: previous.id, status: { in: [...LIVE_STATUSES] } },
            })
          : 0;
        await this.audit(tx, adminId, 'billing.price_set', 'plan_price', price.id, ctx, {
          plan: code,
          channel: input.channel,
          currency: input.currency,
          interval: input.interval,
          amount: input.amount.toFixed(2),
          previous: previous ? { id: previous.id, amount: previous.amount.toFixed(2) } : null,
        });
        return { price, previous, keepingOld };
      });
      return {
        price: priceView(result.price),
        replaced: result.previous ? priceView({ ...result.previous, archivedAt: new Date() }) : null,
        /** Subscribers still on the replaced price (they keep it until moved, D-065). */
        subscribersOnPreviousPrice: result.keepingOld,
      };
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('That store price id is already used by another price');
      throw err;
    }
  }

  /** Stop selling on one channel (e.g. remove the iPhone price). Subscribers keep paying it. */
  async archivePrice(priceId: string, adminId: string, ctx: RequestContext) {
    const price = await this.db.planPrice.findUnique({ where: { id: priceId } });
    if (!price) throw AppError.notFound('Price');
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.planPrice.update({
        where: { id: priceId },
        data: { archivedAt: price.archivedAt ?? new Date() },
      });
      await this.audit(tx, adminId, 'billing.price_archived', 'plan_price', priceId, ctx, {});
      return updated;
    });
    return priceView(updated);
  }

  /** Link a price to the store's product/price id once it's set up there. */
  async setExternalPriceId(
    priceId: string,
    externalPriceId: string | null,
    adminId: string,
    ctx: RequestContext,
  ) {
    if (!(await this.db.planPrice.findUnique({ where: { id: priceId } }))) throw AppError.notFound('Price');
    try {
      const updated = await this.db.$transaction(async (tx) => {
        const updated = await tx.planPrice.update({ where: { id: priceId }, data: { externalPriceId } });
        await this.audit(tx, adminId, 'billing.price_linked', 'plan_price', priceId, ctx, {
          externalPriceId,
        });
        return updated;
      });
      return priceView(updated);
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('That store price id is already used by another price');
      throw err;
    }
  }

  // ── Admin: the switch per audience ───────────────────────────────────────

  async getSettings() {
    const rows = await this.db.billingSettings.findMany({
      include: settingsInclude,
    });
    return rows.map(settingsView);
  }

  /**
   * Turn charging on or off for users or businesses, choose the plans they
   * fall back to, and set up the free trial (on/off, length, which plan; a
   * null plan removes trials). Off → everyone gets `planWhenDisabled` at once;
   * nothing else changes (subscriptions stay recorded and apply again when
   * back on). Switching trials off stops NEW trials; running ones finish.
   */
  async updateSettings(
    audience: Audience,
    changes: {
      enabled?: boolean | undefined;
      defaultPlanCode?: string | undefined;
      planWhenDisabledCode?: string | undefined;
      trialEnabled?: boolean | undefined;
      trialDays?: number | undefined;
      trialPlanCode?: string | null | undefined;
    },
    adminId: string,
    ctx: RequestContext,
  ) {
    const current = await this.db.billingSettings.findUnique({ where: { audience } });
    if (!current) throw AppError.notFound('Billing settings');
    const planFor = async (code: string) => {
      const plan = await this.findPlan(code);
      if (plan.audience !== audience) throw AppError.badRequest(`"${code}" is a ${plan.audience} plan`);
      if (plan.archivedAt) throw AppError.badRequest(`"${code}" is archived`);
      return plan.id;
    };
    const data = {
      ...(changes.enabled !== undefined && { enabled: changes.enabled }),
      ...(changes.defaultPlanCode && { defaultPlanId: await planFor(changes.defaultPlanCode) }),
      ...(changes.planWhenDisabledCode && {
        planWhenDisabledId: await planFor(changes.planWhenDisabledCode),
      }),
      ...(changes.trialEnabled !== undefined && { trialEnabled: changes.trialEnabled }),
      ...(changes.trialDays !== undefined && { trialDays: changes.trialDays }),
      ...(changes.trialPlanCode !== undefined && {
        trialPlanId: changes.trialPlanCode === null ? null : await planFor(changes.trialPlanCode),
      }),
      updatedById: adminId,
    };
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.billingSettings.update({
        where: { audience },
        data,
        include: settingsInclude,
      });
      await this.audit(tx, adminId, 'billing.settings_updated', 'billing_settings', null, ctx, {
        audience,
        ...changes,
      });
      return updated;
    });
    return settingsView(updated);
  }

  // ── Admin: costs, fees and the profit calculator ─────────────────────────

  async listCosts() {
    const rows = await this.db.billingCostItem.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return {
      items: rows.map(costView),
      monthlyTotal: rows.reduce((sum, r) => sum.plus(r.monthlyAmount), new Prisma.Decimal(0)).toFixed(2),
      currency: 'USD',
    };
  }

  async addCost(
    input: { name: string; category: string; monthlyAmount: number; notes?: string | undefined },
    adminId: string,
    ctx: RequestContext,
  ) {
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.billingCostItem.create({ data: { ...input, notes: input.notes ?? null } });
      await this.audit(tx, adminId, 'billing.cost_added', 'billing_cost_item', row.id, ctx, {
        name: input.name,
        monthlyAmount: input.monthlyAmount,
      });
      return row;
    });
    return costView(row);
  }

  async updateCost(
    id: string,
    changes: {
      name?: string | undefined;
      category?: string | undefined;
      monthlyAmount?: number | undefined;
      notes?: string | null | undefined;
    },
    adminId: string,
    ctx: RequestContext,
  ) {
    const existing = await this.db.billingCostItem.findFirst({ where: { id, archivedAt: null } });
    if (!existing) throw AppError.notFound('Cost item');
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.billingCostItem.update({ where: { id }, data });
      await this.audit(tx, adminId, 'billing.cost_updated', 'billing_cost_item', id, ctx, {
        old: { monthlyAmount: existing.monthlyAmount.toFixed(2) },
        changes,
      });
      return row;
    });
    return costView(row);
  }

  async removeCost(id: string, adminId: string, ctx: RequestContext) {
    const { count } = await this.db.billingCostItem.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0) throw AppError.notFound('Cost item');
    await this.audit(this.db, adminId, 'billing.cost_removed', 'billing_cost_item', id, ctx, {});
  }

  async listFees() {
    const rows = await this.db.billingChannelFee.findMany({ orderBy: { channel: 'asc' } });
    return rows.map(feeView);
  }

  async setFee(
    channel: Channel,
    input: { percent: number; fixedAmount: number; notes?: string | undefined },
    adminId: string,
    ctx: RequestContext,
  ) {
    const row = await this.db.$transaction(async (tx) => {
      const row = await tx.billingChannelFee.upsert({
        where: { channel },
        create: {
          channel,
          percent: input.percent,
          fixedAmount: input.fixedAmount,
          notes: input.notes ?? null,
        },
        update: {
          percent: input.percent,
          fixedAmount: input.fixedAmount,
          ...(input.notes !== undefined && { notes: input.notes }),
        },
      });
      await this.audit(tx, adminId, 'billing.fee_set', 'billing_channel_fee', null, ctx, {
        channel,
        ...input,
      });
      return row;
    });
    return feeView(row);
  }

  /**
   * Profit per price and in total. Subscriber counts default to the real
   * live subscriptions; pass `subscribers` (by price id) to ask "what if".
   */
  async economics(input: {
    taxPercent?: number | undefined;
    subscribers?: Record<string, number> | undefined;
  }) {
    const [prices, fees, costs, counts] = await Promise.all([
      this.db.planPrice.findMany({
        where: { archivedAt: null },
        include: { plan: true },
        orderBy: [{ plan: { audience: 'asc' } }, { plan: { sortOrder: 'asc' } }],
      }),
      this.db.billingChannelFee.findMany(),
      this.db.billingCostItem.findMany({ where: { archivedAt: null } }),
      this.db.subscription.groupBy({
        by: ['priceId'],
        where: { status: { in: ['active', 'trialing', 'past_due'] }, priceId: { not: null } },
        _count: { _all: true },
      }),
    ]);
    const actual = new Map(counts.map((c) => [c.priceId, c._count._all]));
    return computeEconomics({
      taxPercent: input.taxPercent ?? 0,
      monthlyCosts: costs.reduce((sum, c) => sum + c.monthlyAmount.toNumber(), 0),
      fees: Object.fromEntries(
        fees.map((f) => [
          f.channel,
          { percent: f.percent.toNumber(), fixedAmount: f.fixedAmount.toNumber() },
        ]),
      ),
      prices: prices.map((p) => ({
        priceId: p.id,
        planCode: p.plan.code,
        planName: p.plan.name,
        channel: p.channel,
        currency: p.currency,
        amount: p.amount.toNumber(),
        interval: p.interval,
        taxInclusive: p.taxInclusive,
        subscribers: input.subscribers?.[p.id] ?? actual.get(p.id) ?? 0,
      })),
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async findPlan(code: string) {
    const plan = await this.db.plan.findUnique({ where: { code } });
    if (!plan) throw AppError.notFound('Plan');
    return plan;
  }

  /** Only keys the system knows, with sensible values (so a typo can't silently do nothing). */
  private validateValues(
    audience: Audience,
    limits: Record<string, number | null> | undefined,
    features: Record<string, boolean> | undefined,
  ) {
    const unknownLimits = Object.keys(limits ?? {}).filter((k) => !limitKeysOf(audience).includes(k));
    const unknownFeatures = Object.keys(features ?? {}).filter((k) => !featureKeysOf(audience).includes(k));
    if (unknownLimits.length || unknownFeatures.length) {
      throw new AppError(`Unknown keys for ${audience} plans`, ErrorCodes.VALIDATION_ERROR, 400, {
        details: {
          unknownLimits,
          unknownFeatures,
          knownLimits: limitKeysOf(audience),
          knownFeatures: featureKeysOf(audience),
        },
      });
    }
  }

  private planView(p: PlanRow) {
    return {
      id: p.id,
      code: p.code,
      audience: p.audience,
      name: p.name,
      tagline: p.tagline,
      benefits: p.benefits,
      ...readPlanValues(p.audience, p.limits, p.features),
      isPublic: p.isPublic,
      sortOrder: p.sortOrder,
      archivedAt: p.archivedAt?.toISOString() ?? null,
      prices: p.prices.map(priceView),
    };
  }

  private audit(
    db: Database | Transaction,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string | null,
    ctx: RequestContext,
    newValues: Record<string, unknown>,
  ) {
    return recordAudit(db, {
      userId,
      action,
      resourceType,
      resourceId,
      newValues: JSON.parse(JSON.stringify(newValues)) as Prisma.InputJsonValue,
      ...auditCtx(ctx),
    });
  }
}

function priceView(p: {
  id: string;
  channel: string;
  currency: string;
  amount: Prisma.Decimal;
  interval: string;
  taxInclusive: boolean;
  trialDays: number;
  externalPriceId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    channel: p.channel,
    currency: p.currency,
    amount: p.amount.toFixed(2),
    interval: p.interval,
    taxInclusive: p.taxInclusive,
    trialDays: p.trialDays,
    externalPriceId: p.externalPriceId,
    active: p.archivedAt === null,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

const settingsInclude = { defaultPlan: true, planWhenDisabled: true, trialPlan: true } as const;

function settingsView(s: {
  audience: string;
  enabled: boolean;
  defaultPlan: { code: string; name: string };
  planWhenDisabled: { code: string; name: string };
  trialEnabled: boolean;
  trialDays: number;
  trialPlan: { code: string; name: string } | null;
  updatedAt: Date;
}) {
  return {
    audience: s.audience,
    enabled: s.enabled,
    defaultPlan: { code: s.defaultPlan.code, name: s.defaultPlan.name },
    planWhenDisabled: { code: s.planWhenDisabled.code, name: s.planWhenDisabled.name },
    trial: {
      enabled: s.trialEnabled,
      days: s.trialDays,
      plan: s.trialPlan ? { code: s.trialPlan.code, name: s.trialPlan.name } : null,
    },
    updatedAt: s.updatedAt.toISOString(),
  };
}

function costView(c: {
  id: string;
  name: string;
  category: string;
  monthlyAmount: Prisma.Decimal;
  currency: string;
  notes: string | null;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    monthlyAmount: c.monthlyAmount.toFixed(2),
    currency: c.currency,
    notes: c.notes,
    updatedAt: c.updatedAt.toISOString(),
  };
}

function feeView(f: {
  channel: string;
  percent: Prisma.Decimal;
  fixedAmount: Prisma.Decimal;
  currency: string;
  notes: string | null;
}) {
  return {
    channel: f.channel,
    percent: f.percent.toFixed(2),
    fixedAmount: f.fixedAmount.toFixed(2),
    currency: f.currency,
    notes: f.notes,
  };
}
