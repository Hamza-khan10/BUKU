/** Billing as the console shows it (billing-service's admin views). */
export interface PlanRequest {
  id: string;
  businessId: string;
  plan: { code: string; name: string };
  message: string;
  status: 'pending' | 'approved' | 'declined' | 'withdrawn';
  decidedAt: string | null;
  decisionNote: string | null;
  subscriptionId: string | null;
  createdAt: string;
  business: { id: string; name: string; slug: string; city: string; country: string };
}

export interface Subscription {
  id: string;
  plan: { code: string; name: string };
  businessId: string;
  businessName?: string;
  provider: string;
  channel: string | null;
  status: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  cancelledAt: string | null;
  grantNote: string | null;
  createdAt: string;
}

export interface Price {
  id: string;
  channel: 'web' | 'ios' | 'android';
  currency: string;
  amount: string;
  interval: 'month' | 'year';
  taxInclusive: boolean;
  trialDays: number;
  externalPriceId: string | null;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: string;
  audience: 'user' | 'business';
  name: string;
  tagline: string | null;
  benefits: string[];
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  isPublic: boolean;
  sortOrder: number;
  archivedAt: string | null;
  prices: Price[];
  subscribers: number;
  usedAs: string[];
}

export interface Settings {
  audience: 'user' | 'business';
  enabled: boolean;
  defaultPlan: { code: string; name: string };
  planWhenDisabled: { code: string; name: string };
  trial: { enabled: boolean; days: number; plan: { code: string; name: string } | null };
}

export const CHANNELS = { web: 'Website (Paddle)', ios: 'iPhone app', android: 'Android app' } as const;

/** Who bills it, in words. */
export const SOURCE: Record<string, string> = {
  manual: 'Given by an admin',
  trial: 'Free trial',
  paddle: 'Paid (Paddle)',
};

export const PLAN_CODE = /^[a-z][a-z0-9_]{1,49}$/;

export interface Cost {
  id: string;
  name: string;
  category: 'infrastructure' | 'messaging' | 'software' | 'other';
  monthlyAmount: string;
  currency: string;
  notes: string | null;
}

export interface Fee {
  channel: 'web' | 'ios' | 'android';
  percent: string;
  fixedAmount: string;
  currency: string;
  notes: string | null;
}

export interface EconomicsRow {
  priceId: string;
  plan: string;
  planName: string;
  channel: 'web' | 'ios' | 'android';
  currency: string;
  interval: 'month' | 'year';
  price: string;
  perSubscriberPerMonth: {
    customerPays: string;
    tax: string;
    channelFee: string;
    net: string;
    keepPercent: number;
  };
  subscribers: number;
  monthlyNet: string;
  breakEvenSubscribers: number | null;
  includedInTotals: boolean;
}

export interface Economics {
  currency: string;
  assumptions: { taxPercent: number; monthlyCosts: string };
  prices: EconomicsRow[];
  totals: {
    subscribers: number;
    customersPayPerMonth: string;
    netRevenuePerMonth: string;
    costsPerMonth: string;
    profitPerMonth: string;
    marginPercent: number | null;
  };
}

export const COST_CATEGORIES = {
  infrastructure: 'Servers and hosting',
  messaging: 'Messages (email, WhatsApp, SMS)',
  software: 'Software and tools',
  other: 'Something else',
} as const;
