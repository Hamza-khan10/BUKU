/**
 * Grant or remove platform admin access (access-control policy, D-080). The
 * only way to change a platform role: run by an operator with database and
 * Valkey access, with a written reason. It records who ran it and why in the
 * audit log, and ends the person's open sessions at once so the old role
 * stops working immediately (not in up to 15 minutes).
 *
 *   pnpm admin:role --email someone@example.com --role super_admin --reason "Ticket OPS-12: on-call admin"
 *   pnpm admin:role --email someone@example.com --role user --reason "Q4 access review: left the team"
 *
 * Database v2 (D3): the person is found by their email's global handle, changed on their own shard,
 * and the last-admin check counts every shard. Needs DATABASE_URL (auth-service's role; or
 * BUKU_APP_PASSWORD for the local stack), DATABASE_DIRECTORY_URL when the directory isn't on the
 * same server, the cluster settings the registry names (BUKU_DB_CLUSTER_LOCAL_1 locally),
 * REDIS_URL (or VALKEY_PASSWORD) and PII_BLIND_INDEX_KEY. Refuses to remove the last admin.
 */
import { hostname, userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createBlindIndexer, createRedisClient, createRevocationStore, normalizeEmail } from '@buku/common';
import { DataPlane, recordShardAudit } from '@buku/database';

const ROLES = ['user', 'business_owner', 'super_admin'] as const;
type Role = (typeof ROLES)[number];

async function main() {
  const { values } = parseArgs({
    options: { email: { type: 'string' }, role: { type: 'string' }, reason: { type: 'string' } },
  });
  const role = values.role as Role;
  if (!values.email || !ROLES.includes(role) || !values.reason || values.reason.trim().length < 10) {
    throw new Error(
      'usage: --email <address> --role user|business_owner|super_admin --reason "<10+ characters>"',
    );
  }
  const env = process.env;
  const databaseUrl =
    env.DATABASE_URL ??
    `postgresql://buku_app:${encodeURIComponent(env.BUKU_APP_PASSWORD ?? '')}@localhost:5432/buku`;
  const redisUrl =
    env.REDIS_URL ?? `redis://:${encodeURIComponent(env.VALKEY_PASSWORD ?? '')}@localhost:6379/0`;
  if (!env.PII_BLIND_INDEX_KEY) throw new Error('PII_BLIND_INDEX_KEY is required');

  const plane = await DataPlane.start({
    service: 'auth',
    databaseUrl,
    ...(env.DATABASE_DIRECTORY_URL && { directoryUrl: env.DATABASE_DIRECTORY_URL }),
    instance: `admin-set-role:${hostname()}:${process.pid}`,
    poolSize: 1,
  });
  const redis = createRedisClient({ url: redisUrl, connectionName: 'admin-set-role' });
  try {
    const indexer = createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64'));
    const userId = await plane.handles.find(
      'user.email',
      indexer.digest16('users.email', normalizeEmail(values.email)),
    );
    const db = userId === null ? null : await plane.user(userId);
    const user =
      userId === null
        ? null
        : await db!.user.findFirst({
            where: { id: userId, deletedAt: null },
            select: { id: true, name: true, role: true },
          });
    if (!db || !user) throw new Error('No account with that email');
    if (user.role === role) {
      console.log(`${user.name} is already ${role}; nothing changed.`);
      return;
    }
    if (user.role === 'super_admin') {
      const admins = await plane.acrossUsers((shard) =>
        shard.user.count({ where: { role: 'super_admin', status: 'active', deletedAt: null } }),
      );
      if (admins.reduce((n, x) => n + x, 0) <= 1)
        throw new Error('Refusing to remove the last platform admin');
    }
    const operator = env.SUDO_USER ?? userInfo().username;
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role } });
      await recordShardAudit(tx, plane.id(), {
        action: 'user.role_changed',
        resourceType: 'user',
        resourceId: user.id,
        oldValues: { role: user.role },
        newValues: {
          role,
          reason: values.reason!.trim(),
          operator,
          via: 'services/auth/scripts/set-role.ts',
        },
      });
    });
    await createRevocationStore(redis).revokeAllForUser(user.id.toString(), 'role_changed');
    console.log(`✔ ${user.name}: ${user.role} → ${role} (audited; open sessions ended)`);
  } finally {
    await plane.close();
    await redis.quit();
  }
}

main().catch((err: unknown) => {
  console.error(`✘ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
