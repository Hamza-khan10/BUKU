import {
  dealMonthlyMinor,
  quoteEnterprise,
  TERM_MONTHS,
  type EnterpriseTerm,
  type QuoteTerms,
  type RateTier,
} from '@buku/billing';
import { AppError, ErrorCodes, minorToNumber, toMinor } from '@buku/common';
import { isUniqueViolation, type DataPlane, type DirectoryClient } from '@buku/database';
import type { RequestContext } from './http/context.js';
import { auditByPerson, exponents, money } from './shared.js';

/**
 * Enterprise for operators (D-151): the rate card a chain is quoted from, the quote itself, and the
 * deals agreed, so Enterprise's revenue is counted (a chain's plan is given by an operator and
 * paid outside the stores: its subscriptions carry no price).
 *
 *  • The rate card, per currency: tiers by the number of branches (a price a branch a month and its
 *    floor), and the terms (discounts for paying ahead, the most taken off when a chain asks, what
 *    a branch costs BUKU, the tax a chain withholds). Confidential: in the directory's private
 *    `sales` schema, billing's alone, typed in by an operator.
 *  • A deal is with a chain: every business its owner holds (D-146). Its price is a branch a month,
 *    so what it brings in follows the chain as branches open and close; when the chain has moved
 *    into another tier since it signed, the deal says it's time to quote again.
 *
 * Every change is audited on the operator's shard.
 */

/** BUKU's two price lists (D-137): always shown on the rate card, set or not. */
const CURRENCIES = ['PKR', 'USD'] as const;

export interface TierInput {
  fromBranches: number;
  price: number;
  floor: number;
}
export interface TermsInput {
  costPerBranch: number;
  yearlyDiscountPercent: number;
  twoYearDiscountPercent: number;
  askedDiscountPercent: number;
  askedDiscountFromBranches: number;
  withholdingPercent: number;
}
export interface DealInput {
  businessId: string;
  name: string;
  currency: string;
  term: EnterpriseTerm;
  pricePerBranch: number;
  startsOn: string;
  endsOn?: string | undefined;
  notes?: string | undefined;
}
export interface DealChanges {
  name?: string | undefined;
  term?: EnterpriseTerm | undefined;
  pricePerBranch?: number | undefined;
  endsOn?: string | null | undefined;
  notes?: string | null | undefined;
}

type Exp = (currency: string) => number;
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

export class EnterpriseService {
  constructor(private readonly plane: DataPlane) {}

  private get dir(): DirectoryClient {
    return this.plane.directory;
  }

  // ── The rate card ────────────────────────────────────────────────────────

  async rateCard() {
    const [rates, terms, exp] = await Promise.all([
      this.dir.enterpriseRate.findMany({ orderBy: [{ currency: 'asc' }, { fromBranches: 'asc' }] }),
      this.dir.enterpriseTerms.findMany(),
      exponents(this.dir),
    ]);
    const currencies = [
      ...new Set([...CURRENCIES, ...rates.map((r) => r.currency), ...terms.map((t) => t.currency)]),
    ];
    return {
      currencies: currencies.map((currency) => {
        const tiers = rates.filter((r) => r.currency === currency);
        const t = terms.find((x) => x.currency === currency);
        return {
          currency,
          tiers: tiers.map((r, i) => ({
            fromBranches: r.fromBranches,
            toBranches: tiers[i + 1] ? tiers[i + 1]!.fromBranches - 1 : null,
            price: money(r.priceMinor, currency, exp),
            floor: money(r.floorMinor, currency, exp),
          })),
          terms: t
            ? {
                costPerBranch: money(t.costPerBranchMinor, currency, exp),
                yearlyDiscountPercent: t.yearlyDiscountPercent.toNumber(),
                twoYearDiscountPercent: t.twoYearDiscountPercent.toNumber(),
                askedDiscountPercent: t.askedDiscountPercent.toNumber(),
                askedDiscountFromBranches: t.askedDiscountFromBranches,
                withholdingPercent: t.withholdingPercent.toNumber(),
              }
            : null,
          updatedAt:
            [...tiers.map((r) => r.updatedAt), ...(t ? [t.updatedAt] : [])]
              .sort((a, b) => b.getTime() - a.getTime())[0]
              ?.toISOString() ?? null,
        };
      }),
    };
  }

  /** A currency's whole rate card at once: its tiers replaced, its terms set. */
  async setRateCard(
    currency: string,
    input: { tiers: TierInput[]; terms: TermsInput },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const row = await this.dir.currency.findUnique({ where: { code: currency } });
    if (!row?.active) throw AppError.notFound('Currency');
    const from = input.tiers.map((t) => t.fromBranches);
    if (new Set(from).size !== from.length)
      throw AppError.badRequest('Each tier starts at a different number of branches');
    const bad = input.tiers.find((t) => t.floor > t.price);
    if (bad) throw AppError.badRequest(`The tier from ${bad.fromBranches} has a floor above its price`);
    const tiers = input.tiers.map((t) => ({
      fromBranches: t.fromBranches,
      priceMinor: toMinor(t.price, row.exponent, 'price'),
      floorMinor: toMinor(t.floor, row.exponent, 'floor'),
    }));
    const terms = {
      costPerBranchMinor: toMinor(input.terms.costPerBranch, row.exponent, 'costPerBranch'),
      yearlyDiscountPercent: input.terms.yearlyDiscountPercent,
      twoYearDiscountPercent: input.terms.twoYearDiscountPercent,
      askedDiscountPercent: input.terms.askedDiscountPercent,
      askedDiscountFromBranches: input.terms.askedDiscountFromBranches,
      withholdingPercent: input.terms.withholdingPercent,
      updatedById: adminId,
    };
    await this.dir.$transaction([
      this.dir.enterpriseRate.deleteMany({ where: { currency } }),
      this.dir.enterpriseRate.createMany({
        data: tiers.map((t) => ({ id: this.plane.id(), currency, updatedById: adminId, ...t })),
      }),
      this.dir.enterpriseTerms.upsert({
        where: { currency },
        create: { currency, ...terms },
        update: terms,
      }),
    ]);
    // The figures are the owner's: recorded as what changed, on the operator's own shard.
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'billing.enterprise_rate_card_set',
      resourceType: 'enterprise_rate_card',
      resourceId: null,
      newValues: { currency, tiers: input.tiers.length },
    });
    return this.rateCard();
  }

  /** No more quotes in this currency: its tiers and terms go. Deals keep the price they agreed. */
  async clearRateCard(currency: string, adminId: bigint, ctx: RequestContext) {
    const [rates] = await this.dir.$transaction([
      this.dir.enterpriseRate.deleteMany({ where: { currency } }),
      this.dir.enterpriseTerms.deleteMany({ where: { currency } }),
    ]);
    if (rates.count > 0) {
      await auditByPerson(this.plane, adminId, ctx, {
        action: 'billing.enterprise_rate_card_cleared',
        resourceType: 'enterprise_rate_card',
        resourceId: null,
        newValues: { currency },
      });
    }
    return this.rateCard();
  }

  // ── Quotes ───────────────────────────────────────────────────────────────

  /** What a chain would pay: worked out, nothing saved. */
  async quote(input: {
    currency: string;
    branches: number;
    term: EnterpriseTerm;
    askedDiscountPercent?: number | undefined;
  }) {
    const { tiers, terms, exp } = await this.card(input.currency);
    const q = quoteEnterprise(tiers, terms, input);
    if (!q.ok) {
      throw new AppError(
        q.reason === 'no_rate_card'
          ? `There's no rate card in ${input.currency} yet`
          : `Enterprise starts at ${q.fromBranches} branches`,
        ErrorCodes.CONFLICT,
        409,
        { details: q },
      );
    }
    const m = (minor: number) => money(BigInt(minor), input.currency, exp);
    return {
      currency: input.currency,
      branches: q.branches,
      term: q.term,
      months: TERM_MONTHS[q.term],
      tier: {
        fromBranches: q.tier.fromBranches,
        toBranches: q.tier.toBranches,
        price: m(q.tier.listMinor),
        floor: m(q.tier.floorMinor),
      },
      discounts: q.discounts,
      perBranch: m(q.perBranchMinor),
      heldAtFloor: q.heldAtFloor,
      heldAtTier: q.heldAtTier && {
        fromBranches: q.heldAtTier.fromBranches,
        monthly: m(q.heldAtTier.monthlyMinor),
      },
      monthly: m(q.monthlyMinor),
      listMonthly: m(q.listMonthlyMinor),
      invoice: m(q.invoiceMinor),
      withheld: m(q.withheldMinor),
      costMonthly: m(q.costMonthlyMinor),
      marginMonthly: m(q.marginMonthlyMinor),
      marginPercent: q.marginPercent,
      floorMonthly: m(q.floorMonthlyMinor),
    };
  }

  // ── Deals ────────────────────────────────────────────────────────────────

  /** The deals (live first), each with the chain's branches now, and the month's revenue by currency. */
  async deals(status: 'active' | 'ended' | 'all' = 'all') {
    return this.list(status === 'all' ? {} : { status });
  }

  private async list(where: { status?: string; id?: bigint }) {
    const rows = await this.dir.enterpriseDeal.findMany({
      where,
      orderBy: [{ status: 'asc' }, { startsOn: 'desc' }],
      take: 500,
    });
    const exp = await exponents(this.dir);
    const owners = [...new Set(rows.map((d) => d.ownerUserId))];
    const anchors = [...new Set(rows.map((d) => d.businessId))];
    const branches = new Map<bigint, number>();
    const named = new Map<bigint, { publicId: string; name: string }>();
    if (rows.length > 0) {
      await this.plane.acrossBusinesses(async (tx) => {
        const [counts, found] = await Promise.all([
          tx.business.groupBy({
            by: ['ownerUserId'],
            where: { ownerUserId: { in: owners }, deletedAt: null },
            _count: { _all: true },
          }),
          tx.business.findMany({
            where: { id: { in: anchors } },
            select: { id: true, publicId: true, name: true },
          }),
        ]);
        for (const c of counts)
          branches.set(c.ownerUserId, (branches.get(c.ownerUserId) ?? 0) + c._count._all);
        for (const b of found) named.set(b.id, { publicId: b.publicId, name: b.name });
      });
    }
    const cards = new Map<string, Awaited<ReturnType<EnterpriseService['card']>> | null>();
    for (const currency of new Set(rows.map((d) => d.currency))) {
      cards.set(currency, await this.card(currency).catch(() => null));
    }

    const deals = rows.map((d) => {
      const now = branches.get(d.ownerUserId) ?? 0;
      const monthly = BigInt(dealMonthlyMinor(Number(d.pricePerBranchMinor), now));
      const card = cards.get(d.currency);
      const tierOf = (n: number) => (card ? (card.tiers.findLast((t) => t.fromBranches <= n) ?? null) : null);
      const signedIn = tierOf(d.branchesAtSigning);
      const nowIn = tierOf(now);
      return {
        id: d.id.toString(),
        name: d.name,
        business: named.get(d.businessId) ?? null,
        currency: d.currency,
        term: d.term as EnterpriseTerm,
        pricePerBranch: money(d.pricePerBranchMinor, d.currency, exp),
        branchesAtSigning: d.branchesAtSigning,
        branchesNow: now,
        monthly: money(monthly, d.currency, exp),
        invoice: money(monthly * BigInt(TERM_MONTHS[d.term as EnterpriseTerm]), d.currency, exp),
        /** The chain has moved into another tier since it signed (or below Enterprise): quote again. */
        quoteAgain: d.status === 'active' && card !== null && signedIn?.fromBranches !== nowIn?.fromBranches,
        startsOn: day(d.startsOn),
        endsOn: day(d.endsOn),
        status: d.status as 'active' | 'ended',
        notes: d.notes,
        createdAt: d.createdAt.toISOString(),
        endedAt: d.endedAt?.toISOString() ?? null,
        monthlyMinor: monthly,
      };
    });

    const totals = new Map<string, { monthly: bigint; deals: number; branches: number }>();
    for (const d of deals) {
      if (d.status !== 'active') continue;
      const t = totals.get(d.currency) ?? { monthly: 0n, deals: 0, branches: 0 };
      totals.set(d.currency, {
        monthly: t.monthly + d.monthlyMinor,
        deals: t.deals + 1,
        branches: t.branches + d.branchesNow,
      });
    }
    return {
      deals: deals.map(({ monthlyMinor: _, ...d }) => d),
      /** Live deals' revenue a month, in each currency (not converted). */
      totals: [...totals].map(([currency, t]) => ({
        currency,
        monthly: money(t.monthly, currency, exp),
        deals: t.deals,
        branches: t.branches,
      })),
    };
  }

  async createDeal(input: DealInput, adminId: bigint, ctx: RequestContext) {
    const currency = await this.dir.currency.findUnique({ where: { code: input.currency } });
    if (!currency?.active) throw AppError.notFound('Currency');
    const businessId = await this.plane.idOfPublic('business', input.businessId);
    if (businessId === null) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const business = await this.plane.inBusiness(businessId, (tx) =>
      tx.business.findUnique({ where: { id: businessId }, select: { ownerUserId: true, deletedAt: true } }),
    );
    if (!business || business.deletedAt) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const branchesAtSigning = await this.branchesOf(business.ownerUserId);
    if (input.endsOn && input.endsOn < input.startsOn)
      throw AppError.badRequest('A deal ends on or after the day it starts');
    try {
      const deal = await this.dir.enterpriseDeal.create({
        data: {
          id: this.plane.id(),
          ownerUserId: business.ownerUserId,
          businessId,
          name: input.name,
          currency: input.currency,
          term: input.term,
          pricePerBranchMinor: toMinor(input.pricePerBranch, currency.exponent, 'pricePerBranch'),
          branchesAtSigning,
          startsOn: asDate(input.startsOn),
          endsOn: input.endsOn ? asDate(input.endsOn) : null,
          notes: input.notes ?? null,
          createdById: adminId,
        },
      });
      await auditByPerson(this.plane, adminId, ctx, {
        action: 'billing.enterprise_deal_made',
        resourceType: 'enterprise_deal',
        resourceId: deal.id,
        newValues: {
          business: input.businessId,
          currency: input.currency,
          term: input.term,
          branchesAtSigning,
        },
      });
      return this.dealView(deal.id);
    } catch (err) {
      if (isUniqueViolation(err))
        throw AppError.conflict('This chain already has a live deal: change that one, or end it first');
      throw err;
    }
  }

  async updateDeal(id: bigint, changes: DealChanges, adminId: bigint, ctx: RequestContext) {
    const deal = await this.dir.enterpriseDeal.findUnique({ where: { id } });
    if (!deal) throw AppError.notFound('Deal');
    if (deal.status !== 'active') throw AppError.conflict('An ended deal stays as it was');
    const exp = await exponents(this.dir);
    const endsOn =
      changes.endsOn === undefined ? undefined : changes.endsOn === null ? null : asDate(changes.endsOn);
    if (endsOn && endsOn < deal.startsOn)
      throw AppError.badRequest('A deal ends on or after the day it starts');
    await this.dir.enterpriseDeal.update({
      where: { id },
      data: {
        ...(changes.name !== undefined && { name: changes.name }),
        ...(changes.term !== undefined && { term: changes.term }),
        ...(changes.pricePerBranch !== undefined && {
          pricePerBranchMinor: toMinor(changes.pricePerBranch, exp(deal.currency), 'pricePerBranch'),
        }),
        ...(endsOn !== undefined && { endsOn }),
        ...(changes.notes !== undefined && { notes: changes.notes }),
      },
    });
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'billing.enterprise_deal_changed',
      resourceType: 'enterprise_deal',
      resourceId: id,
      oldValues: {
        term: deal.term,
        pricePerBranch: minorToNumber(deal.pricePerBranchMinor, exp(deal.currency)),
        endsOn: day(deal.endsOn),
      },
      newValues: changes,
    });
    return this.dealView(id);
  }

  async endDeal(id: bigint, adminId: bigint, ctx: RequestContext) {
    const { count } = await this.dir.enterpriseDeal.updateMany({
      where: { id, status: 'active' },
      data: { status: 'ended', endedAt: new Date() },
    });
    if (count === 0) {
      if (!(await this.dir.enterpriseDeal.findUnique({ where: { id } }))) throw AppError.notFound('Deal');
      return this.dealView(id);
    }
    await auditByPerson(this.plane, adminId, ctx, {
      action: 'billing.enterprise_deal_ended',
      resourceType: 'enterprise_deal',
      resourceId: id,
      newValues: {},
    });
    return this.dealView(id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async dealView(id: bigint) {
    const [deal] = (await this.list({ id })).deals;
    if (!deal) throw AppError.notFound('Deal');
    return deal;
  }

  /** The chain's businesses now: every live business the owner holds, on every shard. */
  private async branchesOf(ownerUserId: bigint) {
    const perShard = await this.plane.acrossBusinesses((tx) =>
      tx.business.count({ where: { ownerUserId, deletedAt: null } }),
    );
    return perShard.reduce((sum, n) => sum + n, 0);
  }

  /** A currency's rate card as the quote works with it (minor units, numbers). */
  private async card(currency: string): Promise<{ tiers: RateTier[]; terms: QuoteTerms; exp: Exp }> {
    const [rates, t, exp] = await Promise.all([
      this.dir.enterpriseRate.findMany({ where: { currency }, orderBy: { fromBranches: 'asc' } }),
      this.dir.enterpriseTerms.findUnique({ where: { currency } }),
      exponents(this.dir),
    ]);
    if (rates.length === 0 || !t) {
      throw new AppError(`There's no rate card in ${currency} yet`, ErrorCodes.CONFLICT, 409, {
        details: { ok: false, reason: 'no_rate_card' },
      });
    }
    return {
      tiers: rates.map((r) => ({
        fromBranches: r.fromBranches,
        priceMinor: Number(r.priceMinor),
        floorMinor: Number(r.floorMinor),
      })),
      terms: {
        costPerBranchMinor: Number(t.costPerBranchMinor),
        yearlyDiscountPercent: t.yearlyDiscountPercent.toNumber(),
        twoYearDiscountPercent: t.twoYearDiscountPercent.toNumber(),
        askedDiscountPercent: t.askedDiscountPercent.toNumber(),
        askedDiscountFromBranches: t.askedDiscountFromBranches,
        withholdingPercent: t.withholdingPercent.toNumber(),
      },
      exp,
    };
  }
}
