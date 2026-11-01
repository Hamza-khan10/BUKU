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

export interface Plan {
  code: string;
  audience: 'user' | 'business';
  name: string;
  archivedAt: string | null;
}

/** Who bills it, in words. */
export const SOURCE: Record<string, string> = {
  manual: 'Given by an admin',
  trial: 'Free trial',
  paddle: 'Paid (Paddle)',
};

export const PLAN_CODE = /^[a-z][a-z0-9_]{1,49}$/;
