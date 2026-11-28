/**
 * Enterprise quotes (D-151). Enterprise is priced for each chain (D-146): a price a branch a month
 * by the chain's size (its tier on the rate card), lower for bigger chains; a discount for paying
 * a year or two ahead; a little more when the chain asks, from a size up and up to a limit; never
 * below the tier's floor. The figures are the owner's, kept in the database and typed in the
 * console: none is in this code.
 *
 * One rule on top: adding a branch never lowers the bill. With a price a branch that drops at a
 * tier's start, a chain just below it could pay more in total than one just past it (24 branches
 * at the first tier's price, more than 25 at the second's); its total is held at the next tier's
 * starting total instead.
 *
 * Money is in minor units (paisa, cents), as whole numbers.
 */

export type EnterpriseTerm = 'month' | 'year' | 'two_years';

/** How many months each invoice covers. */
export const TERM_MONTHS: Readonly<Record<EnterpriseTerm, number>> = { month: 1, year: 12, two_years: 24 };

/** A tier on the rate card: from this many branches, the price a branch a month and its floor. */
export interface RateTier {
  fromBranches: number;
  priceMinor: number;
  floorMinor: number;
}

export interface QuoteTerms {
  /** What one branch costs BUKU a month. */
  costPerBranchMinor: number;
  yearlyDiscountPercent: number;
  twoYearDiscountPercent: number;
  /** The most taken off when a chain asks, and the smallest chain that may ask. */
  askedDiscountPercent: number;
  askedDiscountFromBranches: number;
  /** Tax the chain withholds from each payment. */
  withholdingPercent: number;
}

export interface QuoteInput {
  branches: number;
  term: EnterpriseTerm;
  /** What the chain asked off, in percent (0: nothing asked). */
  askedDiscountPercent?: number;
}

export interface EnterpriseQuote {
  ok: true;
  branches: number;
  term: EnterpriseTerm;
  tier: { fromBranches: number; toBranches: number | null; listMinor: number; floorMinor: number };
  discounts: {
    /** Off for paying ahead. */
    termPercent: number;
    asked: number;
    /** What was given of what was asked. */
    given: number;
    /** Why less was given than asked: the chain is too small to ask, or it asked past the most. */
    limitedBy: 'chain_size' | 'most' | null;
  };
  /** A branch a month after the discounts, held at the floor. */
  perBranchMinor: number;
  heldAtFloor: boolean;
  /** The chain a month: what an invoice is worked out from. */
  monthlyMinor: number;
  /** Set when the total was held at a bigger chain's (adding a branch never lowers the bill). */
  heldAtTier: { fromBranches: number; monthlyMinor: number } | null;
  /** A month at the list price, before anything is taken off. */
  listMonthlyMinor: number;
  /** One invoice: a month, a year or two years. */
  invoiceMinor: number;
  /** Of each invoice, withheld by the chain as tax (paid to the government for BUKU). */
  withheldMinor: number;
  costMonthlyMinor: number;
  marginMonthlyMinor: number;
  /** Of the monthly price; null when it's zero. */
  marginPercent: number | null;
  /** The least BUKU takes for this chain a month: every branch at the tier's floor. */
  floorMonthlyMinor: number;
}

export type QuoteOutcome =
  | EnterpriseQuote
  | { ok: false; reason: 'no_rate_card' }
  | { ok: false; reason: 'below_enterprise'; fromBranches: number };

const percentOff = (amount: number, percent: number) => amount * (1 - percent / 100);
const oneDecimal = (n: number) => Math.round(n * 10) / 10;

export function quoteEnterprise(
  rateCard: readonly RateTier[],
  terms: QuoteTerms,
  input: QuoteInput,
): QuoteOutcome {
  const tiers = [...rateCard].sort((a, b) => a.fromBranches - b.fromBranches);
  if (tiers.length === 0) return { ok: false, reason: 'no_rate_card' };
  const branches = Math.floor(input.branches);
  const at = tiers.findLastIndex((t) => t.fromBranches <= branches);
  if (at === -1) return { ok: false, reason: 'below_enterprise', fromBranches: tiers[0]!.fromBranches };
  const tier = tiers[at]!;

  const termPercent =
    input.term === 'year'
      ? terms.yearlyDiscountPercent
      : input.term === 'two_years'
        ? terms.twoYearDiscountPercent
        : 0;
  const asked = Math.max(0, input.askedDiscountPercent ?? 0);
  // Asking is open from a chain's size up, and gives up to the most; ask nothing, get nothing.
  const mayAsk = branches >= terms.askedDiscountFromBranches;
  const given = mayAsk ? Math.min(asked, terms.askedDiscountPercent) : 0;
  const limitedBy = asked > given ? (mayAsk ? 'most' : 'chain_size') : null;

  /** A branch a month in a tier, after the discounts, never under its floor. */
  const perBranch = (t: RateTier) => {
    const price = Math.round(percentOff(percentOff(t.priceMinor, termPercent), given));
    return { price: Math.max(price, t.floorMinor), floored: price < t.floorMinor };
  };
  const here = perBranch(tier);
  let monthlyMinor = here.price * branches;
  let heldAtTier: EnterpriseQuote['heldAtTier'] = null;
  for (const bigger of tiers.slice(at + 1)) {
    const theirs = perBranch(bigger).price * bigger.fromBranches;
    if (theirs < monthlyMinor) {
      monthlyMinor = theirs;
      heldAtTier = { fromBranches: bigger.fromBranches, monthlyMinor: theirs };
    }
  }

  const invoiceMinor = monthlyMinor * TERM_MONTHS[input.term];
  const costMonthlyMinor = terms.costPerBranchMinor * branches;
  const marginMonthlyMinor = monthlyMinor - costMonthlyMinor;
  const next = tiers[at + 1];
  return {
    ok: true,
    branches,
    term: input.term,
    tier: {
      fromBranches: tier.fromBranches,
      toBranches: next ? next.fromBranches - 1 : null,
      listMinor: tier.priceMinor,
      floorMinor: tier.floorMinor,
    },
    discounts: { termPercent, asked, given, limitedBy },
    perBranchMinor: heldAtTier ? Math.round(monthlyMinor / branches) : here.price,
    heldAtFloor: here.floored,
    monthlyMinor,
    heldAtTier,
    listMonthlyMinor: tier.priceMinor * branches,
    invoiceMinor,
    withheldMinor: Math.round((invoiceMinor * terms.withholdingPercent) / 100),
    costMonthlyMinor,
    marginMonthlyMinor,
    marginPercent: monthlyMinor > 0 ? oneDecimal((marginMonthlyMinor / monthlyMinor) * 100) : null,
    floorMonthlyMinor: tier.floorMinor * branches,
  };
}

/**
 * What a deal brings in a month (D-151): its price a branch a month, for every branch the chain
 * has now (the bill follows the chain as branches open and close).
 */
export const dealMonthlyMinor = (pricePerBranchMinor: number, branchesNow: number) =>
  pricePerBranchMinor * Math.max(0, branchesNow);
