import { api } from '@/lib/api/client';

/** The signed-in person's plan, as GET /v1/billing/me describes it. */
export interface MyPlan {
  plan: { code: string; name: string };
  /** subscription | trial | default (no subscription) | billing_off (everyone unlimited for now) */
  source: 'subscription' | 'trial' | 'default' | 'billing_off' | 'fallback';
  billingEnabled: boolean;
  subscription: {
    id: string;
    status: string;
    /** paddle (the website), google_play / app_store (the app), manual (given by BUKU), trial */
    provider: string;
    channel: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  features: Record<string, boolean>;
  usage: Record<string, { used: number; limit: number | null; remaining: number | null }>;
  trial: {
    available: boolean;
    reason: 'billing_off' | 'trials_off' | 'in_trial' | 'already_used' | 'has_subscription' | null;
    days: number | null;
    plan: { code: string; name: string } | null;
    endsAt: string | null;
  };
}

export const PLAN_KEY = ['my-plan'] as const;

export const fetchMyPlan = () => api<MyPlan>('billing/me');

/** Start the free trial (once per account). */
export const startTrial = () => api<MyPlan>('billing/me/trial', { method: 'POST' });

/** Stop a paid plan renewing (it lasts until the end of what's paid), or change one's mind. */
export const stopRenewing = () => api<unknown>('billing/me/subscription/cancel', { method: 'POST' });
export const keepRenewing = () => api<unknown>('billing/me/subscription/undo-cancel', { method: 'POST' });

/** Links into the payment provider's own pages for this subscription. */
export const paymentPages = () =>
  api<{ overview: string; updatePaymentMethod: string | null }>('billing/me/subscription/portal');
