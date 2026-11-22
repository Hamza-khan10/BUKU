/**
 * BUKU's plans for businesses at launch (D-137): what the public pricing page shows. Two price
 * lists: Pakistan in rupees, everywhere else in US dollars (a price that suits Lahore would be a
 * giveaway in London, and London's would shut Lahore out). Every price is per branch, per month;
 * a year costs ten months. People who book never pay (D-101).
 *
 * The limits are the plan catalog's (reference.plans), with one change at launch: Starter gets the
 * walk-in queue, BUKU's way in for barbers and clinics. Before billing is switched on, the catalog
 * takes these plans and prices (a migration), so checkout charges exactly what this page says.
 */

export type Currency = 'PKR' | 'USD';
export const CURRENCIES: readonly Currency[] = ['PKR', 'USD'];

/** Rupees for visitors in Pakistan, dollars for everyone else (they can switch). */
export function currencyFor(country: string | null | undefined): Currency {
  return country?.trim().toUpperCase() === 'PK' ? 'PKR' : 'USD';
}

export type PlanId = 'starter' | 'essential' | 'professional' | 'network';

export interface LaunchPlan {
  id: PlanId;
  name: string;
  /** Who it's for, in a few words. */
  forWhom: string;
  /** Per branch, per month. */
  monthly: Record<Currency, number>;
  /** The price is per branch, and the plan starts at two (Network). */
  perBranch?: true;
  /** What it adds over the plan before it (the first plan lists its own). */
  includes: string[];
  /** The one to suggest (and the one every business tries for 30 days). */
  suggested?: true;
}

export const LAUNCH_PLANS: readonly LaunchPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    forWhom: 'For a one-chair shop or a solo practice',
    monthly: { PKR: 0, USD: 0 },
    includes: [
      'Bookings from your real availability',
      'Your walk-in queue, with a live display',
      'Check-in by code or QR',
      'Reminders for your customers',
      'Your own page, and reviews from real visits',
      '1 team login, 2 bookable staff',
    ],
  },
  {
    id: 'essential',
    name: 'Essential',
    forWhom: 'For barbers, clinics and local shops',
    monthly: { PKR: 2499, USD: 15 },
    includes: [
      '3 team logins, 5 bookable staff',
      '30 services, 10 photos',
      'Staff photos on your page',
      'Approve bookings by hand',
    ],
  },
  {
    id: 'professional',
    name: 'Professional',
    forWhom: 'For growing teams and busy practices',
    monthly: { PKR: 5999, USD: 35 },
    includes: ['15 team logins, 25 bookable staff', '100 services, 30 photos', 'Priority support'],
    suggested: true,
  },
  {
    id: 'network',
    name: 'Network',
    // Up to five: from six, Enterprise (D-146).
    forWhom: 'For two to five branches',
    monthly: { PKR: 4999, USD: 29 },
    perBranch: true,
    // Its first line, what each branch saves against Professional, is worked out from the prices.
    includes: ['One account for all your branches', 'Each branch with its own hours, team and queue'],
  },
];

/**
 * Enterprise: from 6 branches, where Network stops (D-146). Everything unlimited, priced a branch by
 * size tier, starting at Network's price and lower a branch for bigger chains; a discount only when
 * a chain asks, never below the tier's floor. The figures live in the owner's private pricing
 * guide, not in this public repository.
 */
export const ENTERPRISE = {
  fromBranches: 6,
  includes: [
    'Unlimited team logins, staff, services and photos',
    'Help to set up every branch',
    'A named contact at BUKU',
  ],
};

/**
 * The early-access branch answer where Enterprise begins ("10-20"): the form's options are split at
 * Enterprise's line, so "Talk to us" opens it on the first answer that is Enterprise.
 */
export function enterpriseBranchAnswer<T extends string>(answers: readonly T[]): T | undefined {
  return answers.find((a) => Number.parseInt(a, 10) === ENTERPRISE.fromBranches);
}

export const TRIAL_DAYS = 30;
/** A year costs this many months. */
export const MONTHS_PER_YEAR_PAID = 10;

export type Period = 'month' | 'year';

/**
 * A price as the page shows it: what a month costs on the chosen period (a year's price over 12,
 * rounded the way people round: whole rupees, whole dollars), and what's actually billed.
 */
export function priceFor(plan: LaunchPlan, currency: Currency, period: Period) {
  const month = plan.monthly[currency];
  if (period === 'month') return { perMonth: month, billed: month };
  const year = month * MONTHS_PER_YEAR_PAID;
  return { perMonth: Math.round(year / 12), billed: year };
}

/**
 * "Rs 2,499" or "$15": written out by hand, the same on the server and in every browser (the
 * browsers' own currency formats differ, and the page must look the same before and after it
 * comes to life).
 */
export function money(amount: number, currency: Currency): string {
  const digits = String(Math.round(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return currency === 'PKR' ? `Rs ${digits}` : `$${digits}`;
}

/** The plan comparison: rows of what each plan has (true / false / a number or words). */
export interface ComparisonRow {
  label: string;
  values: Record<PlanId | 'enterprise', boolean | string>;
}

const all = (value: boolean | string) => ({
  starter: value,
  essential: value,
  professional: value,
  network: value,
  enterprise: value,
});

export const COMPARISON: readonly { group: string; rows: ComparisonRow[] }[] = [
  {
    group: 'Every day',
    rows: [
      { label: 'Bookings from your real availability', values: all(true) },
      { label: 'Walk-in queue with a live display', values: all(true) },
      { label: 'Check-in by code or QR', values: all(true) },
      { label: 'Reminders for your customers', values: all(true) },
      { label: 'Your own page, reviews from real visits', values: all(true) },
      { label: 'No-shows and late cancellations, in numbers', values: all(true) },
    ],
  },
  {
    group: 'Your team and your page',
    rows: [
      {
        label: 'Team logins',
        values: {
          starter: '1',
          essential: '3',
          professional: '15',
          network: '15 a branch',
          enterprise: 'Unlimited',
        },
      },
      {
        label: 'Bookable staff',
        values: {
          starter: '2',
          essential: '5',
          professional: '25',
          network: '25 a branch',
          enterprise: 'Unlimited',
        },
      },
      {
        label: 'Services',
        values: {
          starter: '10',
          essential: '30',
          professional: '100',
          network: '100 a branch',
          enterprise: 'Unlimited',
        },
      },
      {
        label: 'Photos',
        values: {
          starter: '5',
          essential: '10',
          professional: '30',
          network: '30 a branch',
          enterprise: 'Unlimited',
        },
      },
      { label: 'Staff photos', values: { ...all(true), starter: false } },
      { label: 'Approve bookings by hand', values: { ...all(true), starter: false } },
    ],
  },
  {
    group: 'Help',
    rows: [
      { label: 'Help by email', values: all(true) },
      { label: 'Priority support', values: { ...all(true), starter: false, essential: false } },
      {
        label: 'Help to set up every branch, a named contact',
        values: { ...all(false), enterprise: true },
      },
    ],
  },
];
