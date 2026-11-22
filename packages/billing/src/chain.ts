import type { BusinessTx } from '@buku/database';
import { ENTITLED } from './entitlements.js';

/**
 * An owner's chain of businesses and the plan it is on (D-146): Network for two to five branches,
 * Enterprise from six. An owner holds up to five businesses (business-service's setting) unless
 * the chain is on Enterprise; a Network chain reaching its sixth celebrates it and asks for
 * Enterprise; an operator's approval moves every branch, and branches added later follow.
 */
export const NETWORK_PLAN = 'business_network';
export const ENTERPRISE_PLAN = 'business_enterprise';

export type ChainStanding = 'enterprise' | 'network' | 'other';

/**
 * What a chain is on, from the live plan of each business its owner holds (null: none). One live
 * Enterprise plan anywhere makes it an Enterprise chain (an operator moved it there); otherwise one
 * live Network plan makes it a Network chain. Read from subscriptions, not entitlements: with
 * billing switched off everyone is entitled to everything, yet a chain is still on the plan it
 * was given.
 */
export function chainStanding(planCodes: readonly (string | null | undefined)[]): ChainStanding {
  if (planCodes.includes(ENTERPRISE_PLAN)) return 'enterprise';
  if (planCodes.includes(NETWORK_PLAN)) return 'network';
  return 'other';
}

/** A business's live subscription on its shard (paid, granted or a trial), with its plan's code. */
export async function liveSubscriptionOnShard(tx: BusinessTx, businessId: bigint, now = new Date()) {
  const sub = await tx.subscription.findFirst({
    where: {
      businessId,
      status: { in: [...ENTITLED] },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: now } }],
    },
    orderBy: { createdAt: 'desc' },
  });
  if (!sub) return null;
  const plan = await tx.plan.findUnique({ where: { id: sub.planId }, select: { code: true } });
  return { ...sub, planCode: plan?.code ?? null };
}
