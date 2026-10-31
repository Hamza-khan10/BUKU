import { recordShardAudit, type DataPlane, type ShardAuditEntry } from '@buku/database';
import type { RequestContext } from './http/context.js';

/** The request's who-and-where, as audit entries take it. */
export function auditCtx(ctx: RequestContext) {
  return { ipAddress: ctx.ip, userAgent: ctx.userAgent, requestId: ctx.requestId };
}

/**
 * An audit entry on a person's own shard, outside any transaction (DB-022): what they did, kept
 * with the rest of their account, so "download my data" and erasure find it there.
 */
export async function auditPerson(plane: DataPlane, userId: bigint, entry: ShardAuditEntry): Promise<void> {
  await recordShardAudit(await plane.user(userId), plane.id(), entry);
}
