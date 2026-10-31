import { recordShardAudit, type DataPlane, type ShardAuditEntry } from '@buku/database';

/**
 * The same step on the admin's own record (D-132). A business keeps its moderation history on its
 * own shard; the admin's record keeps everything that admin did, in one place, so the console's
 * audit log can show a platform admin's work without reading every business. Written after the
 * business's change commits.
 */
export async function onAdminTrail(
  plane: DataPlane,
  adminId: bigint,
  entry: Omit<ShardAuditEntry, 'userId'>,
): Promise<void> {
  await recordShardAudit(await plane.user(adminId), plane.id(), { userId: adminId, ...entry });
}
