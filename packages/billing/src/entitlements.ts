import { AppError, ErrorCodes, logger } from '@buku/common';
import type { BusinessTx, Database, DirectoryClient, Transaction } from '@buku/database';
import {
  FEATURE_KEYS,
  featureKeysOf,
  LIMIT_KEYS,
  limitKeysOf,
  readPlanValues,
  type Audience,
  type BusinessFeature,
  type BusinessLimit,
  type KeyInfo,
} from './registry.js';

/**
 * What a user or a business may do right now (D-065). Every service asks
 * here before creating something a plan limits; nothing else decides.
 *
 *   billing switched off for the audience  → the "billing off" plan (unlimited)
 *   a live subscription or free trial      → its plan (even if since archived)
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
  /** trial: a free trial of a paid plan; subscription: paid or granted by an admin. */
  source: 'subscription' | 'trial' | 'default' | 'billing_off' | 'fallback';
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
    return fromPlan(audience, sub.plan, sub.provider === 'trial' ? 'trial' : 'subscription', true, {
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
export function assertWithinLimit(e: Entitlements, key: string, used: number, message?: string): void {
  const max = e.limits[key];
  if (max === null || max === undefined || used < max) return;
  throw new AppError(
    message ??
      `Your ${e.plan.name} plan includes ${max} ${max === 1 ? oneOf(e.audience, key) : labelOf(e.audience, key).toLowerCase()}; upgrade to add more`,
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
 * Shown on the account only: customers are never limited (D-101).
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

function oneOf(audience: Audience, key: string): string {
  const info = (LIMIT_KEYS[audience] as Record<string, KeyInfo>)[key];
  return info?.one ?? labelOf(audience, key).toLowerCase();
}

function labelOf(audience: Audience, key: string): string {
  const limits = LIMIT_KEYS[audience] as Record<string, KeyInfo>;
  const features = FEATURE_KEYS[audience] as Record<string, KeyInfo>;
  return (limits[key] ?? features[key])?.label ?? key;
}

/**
 * Serialize limit checks for one account and one thing inside a transaction:
 * two parallel requests can't both see "one left" and both create. Released
 * when the transaction ends.
 */
export async function lockForLimit(
  tx: { $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number> },
  scope: string,
  id: string,
): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`limit:${scope}:${id}`}, 0))`;
}

/** Business limit check inside the creating transaction (locked per business and limit). */
export async function assertBusinessLimit(
  tx: Transaction,
  businessId: string,
  key: BusinessLimit,
  count: () => Promise<number>,
): Promise<void> {
  await lockForLimit(tx, key, businessId);
  const e = await entitlementsOf(tx, { businessId });
  if (e.limits[key] === null || e.limits[key] === undefined) return;
  assertWithinLimit(e, key, await count());
}

export async function assertBusinessFeature(
  db: Database | Transaction,
  businessId: string,
  key: BusinessFeature,
): Promise<void> {
  assertFeature(await entitlementsOf(db, { businessId }), key);
}

// ── Database v2 (D3) ───────────────────────────────────────────────────────

/**
 * A business's entitlements on database v2: the same rules as `entitlementsOf`, read on the
 * business's own shard — its subscriptions, and the plans and billing settings replicated there
 * from the directory (DB-015). Call it in the business's transaction (`DataPlane.inBusiness`).
 * A plan not copied yet (replication catching up) counts as unlimited, never as a refusal.
 */
export async function businessEntitlementsOnShard(
  tx: BusinessTx,
  businessId: bigint,
  now = new Date(),
): Promise<Entitlements> {
  const audience: Audience = 'business';
  const settings = await tx.billingSettings.findUnique({ where: { audience } });
  if (!settings) {
    logger.warn({ audience }, 'billing settings missing on the shard: treating everyone as unlimited');
    return unlimited(audience);
  }
  const planOf = async (id: bigint) => {
    const plan = await tx.plan.findUnique({ where: { id } });
    if (!plan) logger.warn({ planId: id.toString() }, 'plan missing on the shard: treating it as unlimited');
    return plan && { ...plan, id: plan.id.toString() };
  };

  if (!settings.enabled) {
    const plan = await planOf(settings.planWhenDisabledId);
    return plan ? fromPlan(audience, plan, 'billing_off', false, null) : unlimited(audience);
  }

  const sub = await tx.subscription.findFirst({
    where: {
      businessId,
      status: { in: [...ENTITLED] },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  const subscribed = sub && (await planOf(sub.planId));
  if (sub && subscribed?.audience === audience) {
    return fromPlan(audience, subscribed, sub.provider === 'trial' ? 'trial' : 'subscription', true, {
      id: sub.id.toString(),
      status: sub.status,
      provider: sub.provider,
      channel: sub.channel,
      currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    });
  }
  const plan = await planOf(settings.defaultPlanId);
  return plan ? fromPlan(audience, plan, 'default', true, null) : unlimited(audience);
}

/**
 * A customer's entitlements on database v2: customers are free (D-101), so there are no customer
 * subscriptions. Everyone gets the plan the directory's settings give customers — the "billing
 * off" plan, since charging customers can't be switched on any more.
 */
export async function customerEntitlements(directory: DirectoryClient): Promise<Entitlements> {
  const audience: Audience = 'user';
  const settings = await directory.billingSettings.findUnique({
    where: { audience },
    include: { defaultPlan: true, planWhenDisabled: true },
  });
  if (!settings) {
    logger.warn({ audience }, 'billing settings missing: treating everyone as unlimited');
    return unlimited(audience);
  }
  const plan = settings.enabled ? settings.defaultPlan : settings.planWhenDisabled;
  return fromPlan(
    audience,
    { ...plan, id: plan.id.toString() },
    settings.enabled ? 'default' : 'billing_off',
    settings.enabled,
    null,
  );
}

/**
 * `assertBusinessLimit` on database v2, inside the creating transaction on the business's shard:
 * locked per business and limit there (a business never changes shard, so the lock is the only one).
 */
export async function assertBusinessLimitOnShard(
  tx: BusinessTx,
  businessId: bigint,
  key: BusinessLimit,
  count: () => Promise<number>,
): Promise<void> {
  await lockForLimit(tx, key, businessId.toString());
  const e = await businessEntitlementsOnShard(tx, businessId);
  if (e.limits[key] === null || e.limits[key] === undefined) return;
  assertWithinLimit(e, key, await count());
}
