import type { FieldCipher } from '@buku/common';
import { recordAudit, type Database } from '@buku/database';
import { auditCtx } from '../sessions/session-service.js';
import type { RequestContext } from '../http/context.js';
import { CONTEXT } from '../users/user-service.js';

/**
 * The quarterly access review (SOC 2 CC6.2/CC6.3, D-080): who holds platform
 * admin access, when they last signed in, and who should probably lose it
 * (no sign-in for 90 days). Producing it is itself audited, so the review
 * leaves evidence. Business teams are the businesses' own access and are
 * reviewed by them (their member list); here only their size is shown.
 */

const DORMANT_DAYS = 90;

export class AccessReview {
  constructor(private readonly deps: { db: Database; cipher: FieldCipher }) {}

  async generate(adminId: string, ctx: RequestContext, now = new Date()) {
    const admins = await this.deps.db.user.findMany({
      where: { role: 'super_admin' },
      select: {
        id: true,
        name: true,
        emailEncrypted: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
        // Staying signed in counts as activity, not only signing in again.
        refreshTokens: {
          select: { lastUsedAt: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const dormantBefore = new Date(now.getTime() - DORMANT_DAYS * 86_400_000);
    const [owners, members, employeeAccounts] = await Promise.all([
      this.deps.db.user.count({ where: { role: 'business_owner' } }),
      this.deps.db.businessMember.groupBy({
        by: ['role'],
        where: { status: 'active' },
        _count: { _all: true },
      }),
      this.deps.db.user.count({ where: { managedByBusinessId: { not: null } } }),
    ]);
    const report = {
      generatedAt: now.toISOString(),
      platformAdmins: admins.map((a) => {
        const lastActive = [a.lastLoginAt, ...a.refreshTokens.flatMap((t) => [t.lastUsedAt, t.createdAt])]
          .filter((d): d is Date => d !== null)
          .reduce<Date | null>((max, d) => (!max || d > max ? d : max), null);
        return {
          id: a.id,
          name: a.name,
          email: a.emailEncrypted ? this.deps.cipher.decrypt(a.emailEncrypted, CONTEXT.email) : null,
          status: a.status,
          since: a.createdAt.toISOString(),
          lastSignIn: a.lastLoginAt?.toISOString() ?? null,
          /** Signing in or using a session, whichever is later. */
          lastActive: lastActive?.toISOString() ?? null,
          /** Not active for 90 days: remove the access unless there's a reason to keep it. */
          dormant: !lastActive || lastActive < dormantBefore,
        };
      }),
      businessAccess: {
        owners,
        teamMembers: Object.fromEntries(members.map((m) => [m.role, m._count._all])),
        employeeAccounts,
      },
    };
    await recordAudit(this.deps.db, {
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
