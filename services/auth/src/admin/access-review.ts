import type { FieldCipher } from '@buku/common';
import type { DataPlane } from '@buku/database';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import { CONTEXT } from '../users/user-service.js';

/**
 * The quarterly access review (SOC 2 CC6.2/CC6.3, D-080): who holds platform
 * admin access, when they last signed in, and who should probably lose it
 * (no sign-in for 90 days). Producing it is itself audited, so the review
 * leaves evidence. Business teams are the businesses' own access and are
 * reviewed by them (their member list); here only their size is shown.
 * Database v2 (D3): every user shard is read, and every business shard for the team sizes.
 */

const DORMANT_DAYS = 90;

export class AccessReview {
  constructor(private readonly deps: { plane: DataPlane; cipher: FieldCipher }) {}

  async generate(adminId: bigint, ctx: RequestContext, now = new Date()) {
    const { plane } = this.deps;
    const shards = await plane.acrossUsers(async (db) => {
      const live = { deletedAt: null };
      const [admins, owners, employeeAccounts] = await Promise.all([
        db.user.findMany({
          where: { role: 'super_admin', ...live },
          select: {
            publicId: true,
            name: true,
            emailEnc: true,
            status: true,
            createdAt: true,
            lastLoginAt: true,
            mfa: { select: { confirmedAt: true } },
            // Staying signed in counts as activity, not only signing in again.
            refreshTokens: {
              select: { lastUsedAt: true, createdAt: true },
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
          orderBy: { createdAt: 'asc' },
        }),
        db.user.count({ where: { role: 'business_owner', ...live } }),
        db.user.count({ where: { managedByBusinessId: { not: null }, ...live } }),
      ]);
      return { admins, owners, employeeAccounts };
    });
    const teams = await plane.acrossBusinesses((tx) =>
      tx.businessMember.groupBy({ by: ['role'], where: { status: 'active' }, _count: { _all: true } }),
    );
    const teamMembers: Record<string, number> = {};
    for (const group of teams.flat())
      teamMembers[group.role] = (teamMembers[group.role] ?? 0) + group._count._all;

    const admins = shards.flatMap((s) => s.admins).sort((a, b) => +a.createdAt - +b.createdAt);
    const dormantBefore = new Date(now.getTime() - DORMANT_DAYS * 86_400_000);
    const report = {
      generatedAt: now.toISOString(),
      platformAdmins: admins.map((a) => {
        const lastActive = [a.lastLoginAt, ...a.refreshTokens.flatMap((t) => [t.lastUsedAt, t.createdAt])]
          .filter((d): d is Date => d !== null)
          .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
        return {
          id: a.publicId,
          name: a.name,
          email: a.emailEnc ? this.deps.cipher.decryptBytes(a.emailEnc, CONTEXT.email) : null,
          status: a.status,
          since: a.createdAt.toISOString(),
          lastSignIn: a.lastLoginAt?.toISOString() ?? null,
          /** Signing in or using a session, whichever is later. */
          lastActive: lastActive?.toISOString() ?? null,
          /** Two-step sign-in set up (admins can't use admin tools without it). */
          mfa: Boolean(a.mfa?.confirmedAt),
          /** Not active for 90 days: remove the access unless there's a reason to keep it. */
          dormant: !lastActive || lastActive < dormantBefore,
        };
      }),
      businessAccess: {
        owners: shards.reduce((n, s) => n + s.owners, 0),
        teamMembers,
        employeeAccounts: shards.reduce((n, s) => n + s.employeeAccounts, 0),
      },
    };
    await auditPerson(plane, adminId, {
      userId: adminId,
      action: 'access_review.generated',
      resourceType: 'system',
      newValues: {
        platformAdmins: admins.length,
        dormant: report.platformAdmins.filter((a) => a.dormant).length,
      },
      ...auditCtx(ctx),
    });
    return report;
  }
}
