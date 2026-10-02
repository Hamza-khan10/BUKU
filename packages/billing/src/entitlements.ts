import { AppError, ErrorCodes, logger } from '@buku/common';
import type { Database, Transaction } from '@buku/database';
import {
  FEATURE_KEYS,
  featureKeysOf,
  LIMIT_KEYS,
  limitKeysOf,
  readPlanValues,
  type Audience,
  type KeyInfo,
} from './registry.js';

/**
 * What a user or a business may do right now (D-065). Every service asks
 * here before creating something a plan limits; nothing else decides.
 *
 *   billing switched off for the audience  → the "billing off" plan (unlimited)
 *   a live subscription                    → its plan (even if since archived)
 *   otherwise                              → the audience's default plan (Free)
 *   billing settings missing or broken     → unlimited, and a warning in the logs
 *
 * So turning billing off, archiving a plan or deleting prices never breaks a
 * request — at worst everyone is unlimited. Limits only stop NEW things being
 * created; nothing that already exists is ever removed by a downgrade.
 */

export type Account = { userId: string } | { businessId: string };

export interface Entitlements {
  audience: Audience;
  plan: { id: string | null; code: string; name: string };
  source: 'subscription' | 'default' | 'billing_off' | 'fallback';
  billingEnabled: boolean;
  /** null = unlimited */
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
  subscription: {
    id: string;
    status: string;
    provider: string;
    channel: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
}

/** Statuses that still give access (past_due: the store is retrying the payment). */
const ENTITLED = ['active', 'trialing', 'past_due'] as const;

export async function entitlementsOf(
  db: Database | Transaction,
  account: Account,
  now = new Date(),
): Promise<Entitlements> {
  const audience: Audience = 'userId' in account ? 'user' : 'business';
  const settings = await db.billingSettings.findUnique({
    where: { audience },
    include: { defaultPlan: true, planWhenDisabled: true },
  });
  if (!settings) {
    logger.warn({ audience }, 'billing settings missing: treating everyone as unlimited');
    return unlimited(audience);
  }

  if (!settings.enabled) return fromPlan(audience, settings.planWhenDisabled, 'billing_off', false, null);

  const sub = await db.subscription.findFirst({
    where: {
      ...('userId' in account ? { userId: account.userId } : { businessId: account.businessId }),
      status: { in: [...ENTITLED] },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
    },
    include: { plan: true },
    orderBy: { createdAt: 'desc' },
  });
  if (sub && sub.plan.audience === audience) {
    return fromPlan(audience, sub.plan, 'subscription', true, {
      id: sub.id,
      status: sub.status,
      provider: sub.provider,
      channel: sub.channel,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
  }
  return fromPlan(audience, settings.defaultPlan, 'default', true, null);
}

/** Refuse creating one more of `key` when `used` already reaches the plan's limit. */
export function assertWithinLimit(e: Entitlements, key: string, used: number): void {
  const max = e.limits[key];
  if (max === null || max === undefined || used < max) return;
  throw new AppError(
    `Your ${e.plan.name} plan includes ${max} ${labelOf(e.audience, key).toLowerCase()}; upgrade to add more`,
    ErrorCodes.PLAN_LIMIT_REACHED,
    409,
    { details: { limit: key, max, used, plan: e.plan.code } },
  );
}

export function assertFeature(e: Entitlements, key: string): void {
  if (e.features[key]) return;
  throw new AppError(
    `${labelOf(e.audience, key)} isn’t included in your ${e.plan.name} plan`,
    ErrorCodes.PLAN_FEATURE_UNAVAILABLE,
    403,
    { details: { feature: key, plan: e.plan.code } },
  );
}

/**
 * A customer's "visits": appointments and queue tickets that are live,
 * completed or missed. Cancelled, declined, rescheduled-away and left ones
 * don't count — the customer didn't get (or block) a service with them.
 */
export async function countVisits(db: Database | Transaction, userId: string): Promise<number> {
  const [appointments, tickets] = await Promise.all([
    db.appointment.count({
      where: { userId, status: { in: ['pending', 'confirmed', 'completed', 'no_show'] } },
    }),
    db.queueEntry.count({
      where: { userId, status: { in: ['waiting', 'called', 'serving', 'completed', 'no_show'] } },
    }),
  ]);
  return appointments + tickets;
}

// ── internals ──────────────────────────────────────────────────────────────

function fromPlan(
  audience: Audience,
  plan: { id: string; code: string; name: string; limits: unknown; features: unknown },
  source: Entitlements['source'],
  billingEnabled: boolean,
  subscription: Entitlements['subscription'],
): Entitlements {
  return {
    audience,
    plan: { id: plan.id, code: plan.code, name: plan.name },
    source,
    billingEnabled,
    ...readPlanValues(audience, plan.limits, plan.features),
    subscription,
  };
}

function unlimited(audience: Audience): Entitlements {
  return {
    audience,
    plan: { id: null, code: 'unlimited', name: 'Unlimited' },
    source: 'fallback',
    billingEnabled: false,
    limits: Object.fromEntries(limitKeysOf(audience).map((k) => [k, null])),
    features: Object.fromEntries(featureKeysOf(audience).map((k) => [k, true])),
    subscription: null,
  };
}

function labelOf(audience: Audience, key: string): string {
  const limits = LIMIT_KEYS[audience] as Record<string, KeyInfo>;
  const features = FEATURE_KEYS[audience] as Record<string, KeyInfo>;
  return (limits[key] ?? features[key])?.label ?? key;
}
