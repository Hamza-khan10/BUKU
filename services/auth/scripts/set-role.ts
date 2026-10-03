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
 * Needs DATABASE_URL (or BUKU_APP_PASSWORD for the local stack), REDIS_URL (or
 * VALKEY_PASSWORD) and PII_BLIND_INDEX_KEY. Refuses to remove the last admin.
 */
import { userInfo } from 'node:os';
import { parseArgs } from 'node:util';
import { createBlindIndexer, createRedisClient, createRevocationStore, normalizeEmail } from '@buku/common';
import { createDatabaseClient, recordAudit } from '@buku/database';

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

  const db = createDatabaseClient({ url: databaseUrl, applicationName: 'admin-set-role', maxConnections: 1 });
  const redis = createRedisClient({ url: redisUrl, connectionName: 'admin-set-role' });
  try {
    const indexer = createBlindIndexer(Buffer.from(env.PII_BLIND_INDEX_KEY, 'base64'));
    const user = await db.user.findUnique({
      where: { emailHash: indexer.hash('users.email', normalizeEmail(values.email)) },
      select: { id: true, name: true, role: true },
    });
    if (!user) throw new Error('No account with that email');
    if (user.role === role) {
      console.log(`${user.name} is already ${role}; nothing changed.`);
      return;
    }
    if (user.role === 'super_admin') {
      const admins = await db.user.count({ where: { role: 'super_admin', status: 'active' } });
      if (admins <= 1) throw new Error('Refusing to remove the last platform admin');
    }
    const operator = env.SUDO_USER ?? userInfo().username;
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { role } });
      await recordAudit(tx, {
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
    await createRevocationStore(redis).revokeAllForUser(user.id, 'role_changed');
    console.log(`✔ ${user.name}: ${user.role} → ${role} (audited; open sessions ended)`);
  } finally {
    await db.$disconnect();
    await redis.quit();
  }
}

main().catch((err: unknown) => {
  console.error(`✘ ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
