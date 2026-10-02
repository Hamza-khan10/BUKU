import type { Database } from '@buku/database';

/**
 * For tests: switch billing on for an audience while `fn` runs, and put it
 * back afterwards (billing settings are shared by every test file).
 */
export async function withBilling<T>(
  db: Database,
  audience: 'user' | 'business',
  fn: () => Promise<T>,
): Promise<T> {
  const before = await db.billingSettings.findUniqueOrThrow({ where: { audience } });
  await db.billingSettings.update({ where: { audience }, data: { enabled: true } });
  try {
    return await fn();
  } finally {
    await db.billingSettings.update({ where: { audience }, data: { enabled: before.enabled } });
  }
}

/** Give an account a plan directly (an admin grant), e.g. to lift a limit in a test. */
export async function givePlan(
  db: Database,
  account: { userId: string } | { businessId: string },
  code: string,
): Promise<void> {
  const plan = await db.plan.findUniqueOrThrow({ where: { code } });
  await db.subscription.create({
    data: { planId: plan.id, ...account, provider: 'manual', status: 'active', grantNote: 'test' },
  });
}
