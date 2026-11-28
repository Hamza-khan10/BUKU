/**
 * Enterprise for operators (D-151): the rate card, quotes and deals, as billing-service answers
 * them. Amounts are decimal strings in their currency ("4999.00"); the figures are the owner's,
 * typed in here and kept in the database, never in this code.
 */

export type Term = 'month' | 'year' | 'two_years';
export const TERMS: Record<Term, string> = { month: 'Monthly', year: 'Yearly', two_years: 'Every two years' };

export interface Tier {
  fromBranches: number;
  toBranches: number | null;
  price: string;
  floor: string;
}
export interface Terms {
  costPerBranch: string;
  yearlyDiscountPercent: number;
  twoYearDiscountPercent: number;
  askedDiscountPercent: number;
  askedDiscountFromBranches: number;
  withholdingPercent: number;
}
export interface RateCard {
  currencies: { currency: string; tiers: Tier[]; terms: Terms | null; updatedAt: string | null }[];
}

export interface Quote {
  currency: string;
  branches: number;
  term: Term;
  months: number;
  tier: { fromBranches: number; toBranches: number | null; price: string; floor: string };
  discounts: { termPercent: number; asked: number; given: number; limitedBy: 'chain_size' | 'most' | null };
  perBranch: string;
  heldAtFloor: boolean;
  heldAtTier: { fromBranches: number; monthly: string } | null;
  monthly: string;
  listMonthly: string;
  invoice: string;
  withheld: string;
  costMonthly: string;
  marginMonthly: string;
  marginPercent: number | null;
  floorMonthly: string;
}

export interface Deal {
  id: string;
  name: string;
  business: { publicId: string; name: string } | null;
  currency: string;
  term: Term;
  pricePerBranch: string;
  branchesAtSigning: number;
  branchesNow: number;
  monthly: string;
  invoice: string;
  quoteAgain: boolean;
  startsOn: string;
  endsOn: string | null;
  status: 'active' | 'ended';
  notes: string | null;
  createdAt: string;
  endedAt: string | null;
}
export interface Deals {
  deals: Deal[];
  totals: { currency: string; monthly: string; deals: number; branches: number }[];
}

/** "Rs 4,999" or "$29.50": the currency's sign, thousands grouped, decimals only when there are some. */
export function money(amount: string | number, currency: string): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  const digits = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  });
  const sign = n < 0 ? '−' : '';
  if (currency === 'PKR') return `${sign}Rs ${digits}`;
  if (currency === 'USD') return `${sign}$${digits}`;
  return `${sign}${currency} ${digits}`;
}

/** "6 to 24 branches", "100 branches and up". */
export const tierRange = (from: number, to: number | null) =>
  to === null ? `${from} branches and up` : `${from} to ${to} branches`;
