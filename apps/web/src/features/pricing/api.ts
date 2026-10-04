import 'server-only';
import { getPublic } from '@/lib/api/public';

/** The public plan catalog (GET /v1/billing/plans): every price and limit comes from here. */

export interface Price {
  id: string;
  amount: string;
  currency: string;
  interval: 'month' | 'year';
  taxInclusive: boolean;
  trialDays: number;
}

export interface Plan {
  code: string;
  name: string;
  tagline: string | null;
  benefits: string[];
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  prices: Price[];
  free: boolean;
}

export interface Pricing {
  audience: 'user' | 'business';
  channel: 'web' | 'android' | 'ios';
  currency: string;
  /** False while paid plans are switched off: everyone has everything. */
  billingEnabled: boolean;
  defaultPlan: string | null;
  trial: { days: number; plan: { code: string; name: string } } | null;
  comparison: {
    limits: { key: string; label: string; description: string }[];
    features: { key: string; label: string; description: string }[];
  };
  plans: Plan[];
}

export async function pricing(audience: Pricing['audience'], channel: Pricing['channel'] = 'web') {
  return (await getPublic<Pricing>('/v1/billing/plans', { revalidate: 300, query: { audience, channel } }))
    .data;
}
