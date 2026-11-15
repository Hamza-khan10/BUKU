/**
 * A business's plan (3.5k): where it stands, how much of each limit it uses, and what each plan
 * on offer would mean for it. The rules mirror billing-service (2.5, D-119), so a button only
 * shows when the API would accept it; the API still decides.
 */

export type Source = 'subscription' | 'trial' | 'default' | 'billing_off' | 'fallback';
export type Provider = 'paddle' | 'google_play' | 'app_store' | 'manual' | 'trial';

export interface Subscription {
  id: string;
  status: string;
  provider: Provider;
  channel: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export type TrialReason = 'billing_off' | 'trials_off' | 'in_trial' | 'already_used' | 'has_subscription';

export interface TrialOffer {
  available: boolean;
  reason: TrialReason | null;
  days: number | null;
  plan: { code: string; name: string } | null;
  endsAt: string | null;
}

export type RequestStatus = 'pending' | 'approved' | 'declined' | 'withdrawn';

export interface PlanRequest {
  id: string;
  plan: { code: string; name: string };
  message: string;
  status: RequestStatus;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface Usage {
  used: number;
  /** null: no limit. */
  limit: number | null;
  remaining: number | null;
}

/** GET /v1/businesses/:id/billing. */
export interface BusinessBilling {
  plan: { code: string; name: string };
  source: Source;
  billingEnabled: boolean;
  subscription: Subscription | null;
  features: Record<string, boolean>;
  usage: Record<string, Usage>;
  trial: TrialOffer;
  pendingPlanRequest: PlanRequest | null;
}

/** Everyone has everything: BUKU isn't charging businesses (or couldn't read its settings). */
export const everythingIncluded = (b: BusinessBilling) =>
  b.source === 'billing_off' || b.source === 'fallback';

const STORE: Partial<Record<Provider, string>> = { google_play: 'Google Play', app_store: 'the App Store' };

/**
 * Where the business stands, in a title and a sentence. `day` turns a timestamp into the date the
 * business reads (its own calendar).
 */
export function standing(
  b: BusinessBilling,
  day: (iso: string) => string,
): { title: string; detail: string } {
  if (everythingIncluded(b))
    return {
      title: 'Everything is included',
      detail: 'BUKU isn’t charging businesses yet, so every feature is yours, with no limits.',
    };
  const sub = b.subscription;
  const end = sub?.currentPeriodEnd ? day(sub.currentPeriodEnd) : null;
  if (b.source === 'trial')
    return {
      title: `${b.plan.name}, free trial`,
      detail: end
        ? `Free until ${end}. Then you’re back on the free plan unless you choose one; nothing is deleted.`
        : 'Free for now. Then you’re back on the free plan unless you choose one; nothing is deleted.',
    };
  if (b.source === 'default' || !sub)
    return { title: b.plan.name, detail: 'The free plan. Choose a plan when you need more.' };
  if (sub.provider === 'manual')
    return {
      title: `${b.plan.name}, from BUKU`,
      detail: end ? `Given by BUKU, free until ${end}.` : 'Given by BUKU, free, with no end date.',
    };
  const store = STORE[sub.provider];
  if (sub.status === 'past_due')
    return {
      title: b.plan.name,
      detail: store
        ? `The last payment didn’t go through. Update it in ${store} to keep your plan.`
        : 'The last payment didn’t go through. Update your card to keep your plan.',
    };
  if (sub.cancelAtPeriodEnd)
    return {
      title: b.plan.name,
      detail: end ? `Ends on ${end}; you won’t be charged again.` : 'Ends at the end of this period.',
    };
  return {
    title: b.plan.name,
    detail: `${end ? `Renews on ${end}` : 'Renews each period'}${store ? `, through ${store}` : ''}.`,
  };
}

export type Tone = 'ok' | 'wait' | 'danger';

/**
 * One limit as a meter: how full (0–1; null with no limit), its tone (nearly full at 80%, full at
 * the limit, where adding more is refused) and the words for it.
 */
export function meter(u: Usage): { share: number | null; tone: Tone; text: string; state: string | null } {
  if (u.limit === null) return { share: null, tone: 'ok', text: `${u.used}, no limit`, state: null };
  const share = u.limit === 0 ? 1 : Math.min(1, u.used / u.limit);
  const full = u.used >= u.limit;
  return {
    share,
    tone: full ? 'danger' : share >= 0.8 ? 'wait' : 'ok',
    text: `${u.used} of ${u.limit}`,
    state: full ? 'At the limit' : share >= 0.8 ? 'Nearly full' : null,
  };
}

/**
 * What a plan on offer means for this business: the one it's on, one it can buy online, switch to
 * (its plan is paid on the web), or one to change in the app store it pays through. Null: nothing
 * to do (not the owner, billing off, or the free plan).
 */
export type PlanAction = 'current' | 'checkout' | 'change' | 'store';

export function planAction(
  plan: { code: string; free: boolean },
  b: BusinessBilling,
  owner: boolean,
): PlanAction | null {
  if (everythingIncluded(b)) return null;
  if (plan.code === b.plan.code) return 'current';
  if (!owner || plan.free) return null;
  const sub = b.subscription;
  if (sub?.provider === 'paddle') return 'change';
  if (sub?.provider === 'google_play' || sub?.provider === 'app_store') return 'store';
  return 'checkout';
}

/** Why there's no trial to start, for the owner (null: say nothing). */
export const TRIAL_NOTE: Record<TrialReason, string | null> = {
  billing_off: null,
  trials_off: null,
  in_trial: null,
  already_used: 'You’ve used your free trial.',
  has_subscription: null,
};

export const REQUEST_STATUS: Record<RequestStatus, string> = {
  pending: 'Waiting for BUKU',
  approved: 'Approved',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

/**
 * Where a payment may take the browser: this site's own checkout page or Paddle's, over https
 * (or this site in development). Anything else is refused rather than followed.
 */
export function safePaymentUrl(raw: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.origin === origin) return url.href;
  if (url.protocol !== 'https:') return null;
  return url.hostname === 'paddle.com' || url.hostname.endsWith('.paddle.com') ? url.href : null;
}
