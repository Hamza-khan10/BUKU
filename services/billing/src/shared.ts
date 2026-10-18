import { formatMinor } from '@buku/common';
import { recordShardAudit, type DataPlane, type DirectoryClient, type ShardAuditEntry } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';

/**
 * What billing-service's parts share on database v2 (D3g): the catalog is reference data on the
 * directory (DB-015), subscriptions and plan requests live on each business's shard, and money is
 * kept in minor units (DB-009) and shown with as many decimals as the currency has.
 */

/** Statuses that keep a subscription live (one per business at a time). */
export const LIVE = ['active', 'trialing', 'past_due', 'paused'] as const;

/** A currency's decimals, from the directory's reference data; read once per call. */
export async function exponents(directory: DirectoryClient): Promise<(currency: string) => number> {
  const rows = await directory.currency.findMany({ select: { code: true, exponent: true } });
  const of = new Map(rows.map((r) => [r.code, r.exponent]));
  return (currency) => of.get(currency) ?? 2;
}

/** "9.99" in the currency's decimals. */
export const money = (minor: bigint, currency: string, exp: (currency: string) => number) =>
  formatMinor(minor, exp(currency));

/**
 * An admin's (or a person's) action in the audit log on their own shard: the directory keeps no
 * audit log, and a change there can't share a transaction with a shard.
 */
export async function auditByPerson(
  plane: DataPlane,
  actorId: bigint,
  ctx: RequestContext | null,
  entry: Omit<ShardAuditEntry, 'userId'>,
): Promise<void> {
  await recordShardAudit(await plane.user(actorId), plane.id(), {
    userId: actorId,
    ...entry,
    ...(ctx && auditCtx(ctx)),
  });
}
