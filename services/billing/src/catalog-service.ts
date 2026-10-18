import {
  computeEconomics,
  describeKeys,
  launchedFeatureKeysOf,
  featureKeysOf,
  limitKeysOf,
  readPlanValues,
  type Audience,
} from '@buku/billing';
import { AppError, ErrorCodes, minorToNumber, toMinor } from '@buku/common';
import { isUniqueViolation, type DataPlane, type Directory, type DirectoryClient } from '@buku/database';
import type { RequestContext } from './http/context.js';
import { auditByPerson, exponents, LIVE, money } from './shared.js';

/**
 * The catalog (D-065): plans, prices, the on/off switch per audience, running
 * costs and channel fees. Everything is data that platform admins change at
 * any time; every change is audited.
 *
 *  • Prices are never edited: a new price replaces the one in force (which is
 *    archived) so existing subscribers keep the price they agreed to.
 *  • Plans are archived, never deleted: hidden and not for sale, while current
 *    subscribers keep them. A plan an audience falls back to can't be archived.
 *
 * Database v2 (D3g): the catalog is reference data on the directory, edited only by
 * billing-service and copied to every business shard by replication (DB-015), where plan limits
 * are read. Amounts are in minor units of their currency (DB-009). Subscriber counts come from
 * every business shard; the audit entry from the admin's own shard.
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

/** Running costs and channel fees are kept in US dollars. */
const USD = 'USD';
const planInclude = {
  prices: { orderBy: [{ archivedAt: 'asc' as const }, { createdAt: 'desc' as const }] },
} satisfies Directory.Prisma.PlanInclude;
type PlanRow = Directory.Prisma.PlanGetPayload<{ include: typeof planInclude }>;
type PriceRow = PlanRow['prices'][number];

/** A plan's values as advertised: only features BUKU offers today (registry `launched`). */
function advertised(audience: Audience, values: ReturnType<typeof readPlanValues>) {
  const launched = new Set(launchedFeatureKeysOf(audience));
  return {
    limits: values.limits,
    features: Object.fromEntries(Object.entries(values.features).filter(([k]) => launched.has(k))),
  };
}

export class CatalogService {
  constructor(private readonly plane: DataPlane) {}

  private get dir(): DirectoryClient {
    return this.plane.directory;
  }

  // ── Public: the pricing page ─────────────────────────────────────────────

  /**
   * Plans on sale for an audience, with the price on one channel, their
   * benefits and a comparison of limits and features — everything the
   * pricing page needs to show what each plan gives.
   */
  async pricing(audience: Audience, channel: Channel, currency: string) {
    const settings = await this.dir.billingSettings.findUnique({
      where: { audience },
      include: { defaultPlan: true, trialPlan: true },
    });
    const plans = await this.dir.plan.findMany({
      where: { audience, isPublic: true, archivedAt: null },
      orderBy: { sortOrder: 'asc' },
      include: { prices: { where: { archivedAt: null, channel, currency } } },
    });
    const exp = await exponents(this.dir);
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
          ...advertised(audience, readPlanValues(audience, p.limits, p.features)),
          prices: p.prices.map((x) => ({
            id: x.id.toString(),
            amount: money(x.amountMinor, x.currency, exp),
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
    const plans = await this.dir.plan.findMany({
      orderBy: [{ audience: 'asc' }, { sortOrder: 'asc' }],
      include: planInclude,
    });
    const settings = await this.dir.billingSettings.findMany();
    const subscribers = await this.liveCounts('planId');
    const exp = await exponents(this.dir);
    return plans.map((p) => ({
      ...planView(p, exp),
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

  async createPlan(input: PlanInput, adminId: bigint, ctx: RequestContext) {
    this.validateValues(input.audience, input.limits, input.features);
    try {
      const plan = await this.dir.plan.create({
        data: {
          id: this.plane.id(),
          code: input.code,
          audience: input.audience,
          name: input.name,
          tagline: input.tagline ?? null,
          benefits: input.benefits ?? [],
          limits: input.limits ?? {},
          features: input.features ?? {},
          isPublic: input.isPublic ?? true,
          sortOrder: input.sortOrder ?? 0,
        },
        include: planInclude,
      });
      await this.audit(adminId, 'billing.plan_created', 'plan', plan.id, ctx, { code: plan.code });
      return planView(plan, await exponents(this.dir));
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict(`A plan with code "${input.code}" already exists`);
      throw err;
    }
  }

  /** Limits and features merge: keys given are set (null = unlimited), others stay. */
  async updatePlan(
    code: string,
    changes: Partial<Omit<PlanInput, 'code' | 'audience'>>,
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const plan = await this.findPlan(code);
    this.validateValues(plan.audience as Audience, changes.limits, changes.features);
    const updated = await this.dir.plan.update({
      where: { id: plan.id },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.tagline !== undefined && { tagline: changes.tagline }),
        ...(changes.benefits !== undefined && { benefits: changes.benefits }),
        ...(changes.isPublic !== undefined && { isPublic: changes.isPublic }),
        ...(changes.sortOrder !== undefined && { sortOrder: changes.sortOrder }),
        ...(changes.limits && {
          limits: { ...(plan.limits as object), ...changes.limits },
        }),
        ...(changes.features && {
          features: { ...(plan.features as object), ...changes.features },
        }),
      },
      include: planInclude,
    });
    await this.audit(adminId, 'billing.plan_updated', 'plan', plan.id, ctx, {
      code,
      old: { limits: plan.limits, features: plan.features, name: plan.name, isPublic: plan.isPublic },
      changes,
    });
    return planView(updated, await exponents(this.dir));
  }

  /** Stop selling a plan. Subscribers keep it until moved; the audience's fallback plans can't be archived. */
  async archivePlan(code: string, adminId: bigint, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    const usedBy = await this.dir.billingSettings.findFirst({
      where: { OR: [{ defaultPlanId: plan.id }, { planWhenDisabledId: plan.id }, { trialPlanId: plan.id }] },
    });
    if (usedBy) {
      const role = usedBy.trialPlanId === plan.id ? 'free-trial' : 'fallback';
      throw AppError.conflict(
        `"${code}" is the ${usedBy.audience}s’ ${role} plan; choose another one in the billing settings first`,
      );
    }
    const updated = await this.dir.plan.update({
      where: { id: plan.id },
      data: { archivedAt: plan.archivedAt ?? new Date() },
      include: planInclude,
    });
    await this.audit(adminId, 'billing.plan_archived', 'plan', plan.id, ctx, { code });
    return planView(updated, await exponents(this.dir));
  }

  async restorePlan(code: string, adminId: bigint, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    const updated = await this.dir.plan.update({
      where: { id: plan.id },
      data: { archivedAt: null },
      include: planInclude,
    });
    await this.audit(adminId, 'billing.plan_restored', 'plan', plan.id, ctx, { code });
    return planView(updated, await exponents(this.dir));
  }

  // ── Admin: prices ────────────────────────────────────────────────────────

  /**
   * Set a new price for a plan on a channel. The price in force (same channel,
   * currency and interval) is archived in the same transaction: new
   * subscribers pay the new price, existing ones keep theirs until moved.
   */
  async setPrice(code: string, input: PriceInput, adminId: bigint, ctx: RequestContext) {
    const plan = await this.findPlan(code);
    if (plan.archivedAt) throw AppError.conflict('Restore the plan before giving it a price');
    const exp = await exponents(this.dir);
    const currency = await this.dir.currency.findUnique({ where: { code: input.currency } });
    if (!currency?.active) throw AppError.badRequest(`Unknown currency "${input.currency}"`);
    const amountMinor = toMinor(input.amount, currency.exponent, 'amount');
    try {
      const { price, previous } = await this.dir.$transaction(async (tx) => {
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
            id: this.plane.id(),
            planId: plan.id,
            channel: input.channel,
            currency: input.currency,
            amountMinor,
            interval: input.interval,
            taxInclusive: input.taxInclusive ?? false,
            trialDays: input.trialDays ?? 0,
            externalPriceId: input.externalPriceId ?? null,
            createdById: adminId,
          },
        });
        return { price, previous };
      });
      const keepingOld = previous ? ((await this.liveCounts('priceId')).get(previous.id) ?? 0) : 0;
      await this.audit(adminId, 'billing.price_set', 'plan_price', price.id, ctx, {
        plan: code,
        channel: input.channel,
        currency: input.currency,
        interval: input.interval,
        amount: money(price.amountMinor, price.currency, exp),
        previous: previous
          ? { id: previous.id.toString(), amount: money(previous.amountMinor, previous.currency, exp) }
          : null,
      });
      return {
        price: priceView(price, exp),
        replaced: previous ? priceView({ ...previous, archivedAt: new Date() }, exp) : null,
        /** Subscribers still on the replaced price (they keep it until moved, D-065). */
        subscribersOnPreviousPrice: keepingOld,
      };
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('That store price id is already used by another price');
      throw err;
    }
  }

  /** Stop selling on one channel (e.g. remove the iPhone price). Subscribers keep paying it. */
  async archivePrice(priceId: bigint, adminId: bigint, ctx: RequestContext) {
    const price = await this.dir.planPrice.findUnique({ where: { id: priceId } });
    if (!price) throw AppError.notFound('Price');
    const updated = await this.dir.planPrice.update({
      where: { id: priceId },
      data: { archivedAt: price.archivedAt ?? new Date() },
    });
    await this.audit(adminId, 'billing.price_archived', 'plan_price', priceId, ctx, {});
    return priceView(updated, await exponents(this.dir));
  }

  /** Link a price to the store's product/price id once it's set up there. */
  async setExternalPriceId(
    priceId: bigint,
    externalPriceId: string | null,
    adminId: bigint,
    ctx: RequestContext,
  ) {
    if (!(await this.dir.planPrice.findUnique({ where: { id: priceId } }))) throw AppError.notFound('Price');
    try {
      const updated = await this.dir.planPrice.update({ where: { id: priceId }, data: { externalPriceId } });
      await this.audit(adminId, 'billing.price_linked', 'plan_price', priceId, ctx, { externalPriceId });
      return priceView(updated, await exponents(this.dir));
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('That store price id is already used by another price');
      throw err;
    }
  }

  // ── Admin: the switch per audience ───────────────────────────────────────

  async getSettings() {
    const rows = await this.dir.billingSettings.findMany({ include: settingsInclude });
    return rows.map(settingsView);
  }

  /**
   * Turn charging on or off for users or businesses, choose the plans they
   * fall back to, and set up the free trial (on/off, length, which plan; a
   * null plan removes trials). Off → everyone gets `planWhenDisabled` at once;
   * nothing else changes (subscriptions stay recorded and apply again when
   * back on). Switching trials off stops NEW trials; running ones finish.
   * Business shards follow within moments, by replication.
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
    adminId: bigint,
    ctx: RequestContext,
  ) {
    // Customers use BUKU for free (D-101): nothing about them is limited any more, so a plan
    // or a trial would sell nothing. Charging them again needs a new release, not a switch.
    if (audience === 'user' && (changes.enabled === true || changes.trialEnabled === true)) {
      throw AppError.conflict('Customers use BUKU for free; charging them can’t be switched on');
    }
    const current = await this.dir.billingSettings.findUnique({ where: { audience } });
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
    const updated = await this.dir.billingSettings.update({
      where: { audience },
      data,
      include: settingsInclude,
    });
    await this.audit(adminId, 'billing.settings_updated', 'billing_settings', null, ctx, {
      audience,
      ...changes,
    });
    return settingsView(updated);
  }

  // ── Admin: costs, fees and the profit calculator ─────────────────────────

  async listCosts() {
    const rows = await this.dir.billingCostItem.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    const exp = await exponents(this.dir);
    return {
      items: rows.map((r) => costView(r, exp)),
      monthlyTotal: money(
        rows.reduce((sum, r) => sum + r.monthlyMinor, 0n),
        USD,
        exp,
      ),
      currency: USD,
    };
  }

  async addCost(
    input: { name: string; category: string; monthlyAmount: number; notes?: string | undefined },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const exp = await exponents(this.dir);
    const row = await this.dir.billingCostItem.create({
      data: {
        id: this.plane.id(),
        name: input.name,
        category: input.category,
        monthlyMinor: toMinor(input.monthlyAmount, exp(USD), 'monthlyAmount'),
        notes: input.notes ?? null,
      },
    });
    await this.audit(adminId, 'billing.cost_added', 'billing_cost_item', row.id, ctx, {
      name: input.name,
      monthlyAmount: input.monthlyAmount,
    });
    return costView(row, exp);
  }

  async updateCost(
    id: bigint,
    changes: {
      name?: string | undefined;
      category?: string | undefined;
      monthlyAmount?: number | undefined;
      notes?: string | null | undefined;
    },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const existing = await this.dir.billingCostItem.findFirst({ where: { id, archivedAt: null } });
    if (!existing) throw AppError.notFound('Cost item');
    const exp = await exponents(this.dir);
    const { monthlyAmount, ...rest } = changes;
    const data = {
      ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
      ...(monthlyAmount !== undefined && { monthlyMinor: toMinor(monthlyAmount, exp(USD), 'monthlyAmount') }),
    };
    const row = await this.dir.billingCostItem.update({ where: { id }, data });
    await this.audit(adminId, 'billing.cost_updated', 'billing_cost_item', id, ctx, {
      old: { monthlyAmount: money(existing.monthlyMinor, USD, exp) },
      changes,
    });
    return costView(row, exp);
  }

  async removeCost(id: bigint, adminId: bigint, ctx: RequestContext) {
    const { count } = await this.dir.billingCostItem.updateMany({
      where: { id, archivedAt: null },
      data: { archivedAt: new Date() },
    });
    if (count === 0) throw AppError.notFound('Cost item');
    await this.audit(adminId, 'billing.cost_removed', 'billing_cost_item', id, ctx, {});
  }

  async listFees() {
    const rows = await this.dir.billingChannelFee.findMany({ orderBy: { channel: 'asc' } });
    const exp = await exponents(this.dir);
    return rows.map((r) => feeView(r, exp));
  }

  async setFee(
    channel: Channel,
    input: { percent: number; fixedAmount: number; notes?: string | undefined },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const exp = await exponents(this.dir);
    const fixedMinor = toMinor(input.fixedAmount, exp(USD), 'fixedAmount');
    const row = await this.dir.billingChannelFee.upsert({
      where: { channel },
      create: { channel, percent: input.percent, fixedMinor, notes: input.notes ?? null },
      update: {
        percent: input.percent,
        fixedMinor,
        ...(input.notes !== undefined && { notes: input.notes }),
      },
    });
    await this.audit(adminId, 'billing.fee_set', 'billing_channel_fee', null, ctx, { channel, ...input });
    return feeView(row, exp);
  }

  /**
   * Profit per price and in total. Subscriber counts default to the real
   * live subscriptions (on every business shard); pass `subscribers` (by price
   * id) to ask "what if".
   */
  async economics(input: {
    taxPercent?: number | undefined;
    subscribers?: Record<string, number> | undefined;
  }) {
    const prices = await this.dir.planPrice.findMany({
      where: { archivedAt: null },
      include: { plan: true },
      orderBy: [{ plan: { audience: 'asc' } }, { plan: { sortOrder: 'asc' } }],
    });
    const fees = await this.dir.billingChannelFee.findMany();
    const costs = await this.dir.billingCostItem.findMany({ where: { archivedAt: null } });
    const actual = await this.liveCounts('priceId', ['active', 'trialing', 'past_due']);
    const exp = await exponents(this.dir);
    return computeEconomics({
      taxPercent: input.taxPercent ?? 0,
      monthlyCosts: costs.reduce((sum, c) => sum + minorToNumber(c.monthlyMinor, exp(c.currency)), 0),
      fees: Object.fromEntries(
        fees.map((f) => [
          f.channel,
          { percent: f.percent.toNumber(), fixedAmount: minorToNumber(f.fixedMinor, exp(f.currency)) },
        ]),
      ),
      prices: prices.map((p) => ({
        priceId: p.id.toString(),
        planCode: p.plan.code,
        planName: p.plan.name,
        channel: p.channel,
        currency: p.currency,
        amount: minorToNumber(p.amountMinor, exp(p.currency)),
        interval: p.interval as Interval,
        taxInclusive: p.taxInclusive,
        subscribers: input.subscribers?.[p.id.toString()] ?? actual.get(p.id) ?? 0,
      })),
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async findPlan(code: string) {
    const plan = await this.dir.plan.findUnique({ where: { code } });
    if (!plan) throw AppError.notFound('Plan');
    return plan;
  }

  /** Live subscriptions per plan or price, counted on every business shard. */
  private async liveCounts(
    by: 'planId' | 'priceId',
    statuses: readonly string[] = LIVE,
  ): Promise<Map<bigint, number>> {
    const counts = new Map<bigint, number>();
    await this.plane.acrossBusinesses(async (tx) => {
      const rows = await tx.subscription.groupBy({
        by: [by],
        where: { status: { in: [...statuses] } },
        _count: { _all: true },
      });
      for (const r of rows) {
        const key = r[by];
        if (key !== null) counts.set(key, (counts.get(key) ?? 0) + r._count._all);
      }
    });
    return counts;
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

  private audit(
    adminId: bigint,
    action: string,
    resourceType: string,
    resourceId: bigint | null,
    ctx: RequestContext,
    newValues: Record<string, unknown>,
  ) {
    return auditByPerson(this.plane, adminId, ctx, { action, resourceType, resourceId, newValues });
  }
}

function planView(p: PlanRow, exp: (currency: string) => number) {
  return {
    id: p.id.toString(),
    code: p.code,
    audience: p.audience,
    name: p.name,
    tagline: p.tagline,
    benefits: p.benefits,
    ...readPlanValues(p.audience as Audience, p.limits, p.features),
    isPublic: p.isPublic,
    sortOrder: p.sortOrder,
    archivedAt: p.archivedAt?.toISOString() ?? null,
    prices: p.prices.map((x) => priceView(x, exp)),
  };
}

function priceView(p: PriceRow, exp: (currency: string) => number) {
  return {
    id: p.id.toString(),
    channel: p.channel,
    currency: p.currency,
    amount: money(p.amountMinor, p.currency, exp),
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

function costView(
  c: {
    id: bigint;
    name: string;
    category: string;
    monthlyMinor: bigint;
    currency: string;
    notes: string | null;
    updatedAt: Date;
  },
  exp: (currency: string) => number,
) {
  return {
    id: c.id.toString(),
    name: c.name,
    category: c.category,
    monthlyAmount: money(c.monthlyMinor, c.currency, exp),
    currency: c.currency,
    notes: c.notes,
    updatedAt: c.updatedAt.toISOString(),
  };
}

function feeView(
  f: {
    channel: string;
    percent: Directory.Prisma.Decimal;
    fixedMinor: bigint;
    currency: string;
    notes: string | null;
  },
  exp: (currency: string) => number,
) {
  return {
    channel: f.channel,
    percent: f.percent.toFixed(2),
    fixedAmount: money(f.fixedMinor, f.currency, exp),
    currency: f.currency,
    notes: f.notes,
  };
}
