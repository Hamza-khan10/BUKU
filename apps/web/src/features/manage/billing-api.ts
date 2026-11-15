import type { Pricing } from '@/features/pricing/api';
import { api } from '@/lib/api/client';
import type { BusinessBilling, PlanRequest } from './billing';

/** A business's plan (3.5k): GET for every team role; every change is the owner's (`billing.manage`). */

const base = (id: string) => `businesses/${id}/billing`;

export const billingKey = (id: string) => ['business', id, 'billing'] as const;
export const planRequestsKey = (id: string) => ['business', id, 'billing', 'requests'] as const;
export const businessPlansKey = ['billing', 'plans', 'business', 'web'] as const;

export const fetchBilling = (id: string) => api<BusinessBilling>(base(id));
export const fetchPlanRequests = (id: string) => api<PlanRequest[]>(`${base(id)}/plan-requests`);
/** The plans on offer on the web, the same catalogue as the pricing page. */
export const fetchBusinessPlans = () => api<Pricing>('billing/plans?audience=business&channel=web');

export const startTrial = (id: string) => api<unknown>(`${base(id)}/trial`, { method: 'POST' });
export const askForPlan = (id: string, planCode: string, message: string) =>
  api<PlanRequest>(`${base(id)}/plan-requests`, { method: 'POST', body: { planCode, message } });
export const withdrawRequest = (id: string, requestId: string) =>
  api<PlanRequest>(`${base(id)}/plan-requests/${requestId}/withdraw`, { method: 'POST' });

export interface Checkout {
  transactionId: string;
  checkoutUrl: string;
  plan: { code: string; name: string };
  price: { amount: string; currency: string; interval: 'month' | 'year' };
}
export const checkout = (id: string, planCode: string) =>
  api<Checkout>(`${base(id)}/checkout`, { method: 'POST', body: { planCode } });
export const changePlan = (id: string, planCode: string) =>
  api<unknown>(`${base(id)}/subscription/change`, { method: 'POST', body: { planCode } });
export const cancelPlan = (id: string) => api<unknown>(`${base(id)}/subscription/cancel`, { method: 'POST' });
export const keepPlan = (id: string) =>
  api<unknown>(`${base(id)}/subscription/undo-cancel`, { method: 'POST' });
export const portal = (id: string) =>
  api<{ overview: string; updatePaymentMethod: string | null }>(`${base(id)}/subscription/portal`);
