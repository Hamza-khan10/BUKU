import { AppError } from '@buku/common';
import type { DataPlane } from '@buku/database';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';

/** One step in an audit trail, as an operator reads it. */
export interface AuditEntry {
  id: string;
  at: string;
  actor: { id: string; name: string } | null;
  action: string;
  target: { type: string; id: string | null; label: string | null } | null;
  /** Why, when the step was given a reason. */
  reason: string | null;
  /** The step's other recorded values (status, key, code…), never the reason twice. */
  details: Record<string, unknown> | null;
  ip: string | null;
  requestId: string | null;
}

/** The kinds of step the console filters by: an action's prefixes. */
export const AUDIT_AREAS = {
  accounts: ['admin.account_', 'admin.sessions_'],
  businesses: ['admin.business_', 'admin.report_', 'admin.document', 'admin.legal_'],
  reviews: ['admin.review_'],
  switches: ['admin.switch_'],
  billing: ['billing.'],
  notifications: ['notifications.'],
  'sign-in': ['auth.', 'mfa.'],
  access: ['access_review.', 'admin.audit_', 'admin.account_trail_'],
} as const;
export type AuditArea = keyof typeof AUDIT_AREAS;

interface Row {
  id: bigint;
  createdAt: Date;
  userId: bigint | null;
  resourceId: bigint | null;
  action: string;
  resourceType: string;
  ipAddress: string | null;
  requestId: string | null;
  oldValues: unknown;
  newValues: unknown;
}

const PAGE_MAX = 100;
const cursorOf = (r: Row) => `${r.createdAt.getTime()}_${r.id}`;

/**
 * The audit log for platform admins (3.6f, D-132). Every person's steps are kept on their own
 * shard (DB-022); an admin's record holds everything that admin did (their own steps, and a copy
 * of each step they took on a business). The activity feed reads, on every user shard, the steps
 * of everyone who is a platform admin now, and any `admin.` step by someone who no longer is, newest
 * first. A person's trail (for an account under investigation) reads their shard; opening one is
 * itself recorded, the feed is not (it is the admins' own work, read by admins).
 */
export class AuditLog {
  constructor(private readonly plane: DataPlane) {}

  async activity(q: {
    days: number;
    limit: number;
    area?: AuditArea | undefined;
    before?: string | undefined;
  }): Promise<{ entries: AuditEntry[]; next: string | null }> {
    const since = new Date(Date.now() - q.days * 86_400_000);
    const before = parseCursor(q.before);
    const limit = Math.min(PAGE_MAX, q.limit);
    const area = q.area ? AUDIT_AREAS[q.area] : null;
    const shards = await this.plane.acrossUsers(async (db) => {
      const admins = await db.user.findMany({ where: { role: 'super_admin' }, select: { id: true } });
      return db.auditLog.findMany({
        where: {
          AND: [
            { createdAt: { gte: since } },
            {
              OR: [
                ...(admins.length ? [{ userId: { in: admins.map((a) => a.id) } }] : []),
                { action: { startsWith: 'admin.' } },
              ],
            },
            ...(area ? [{ OR: area.map((p) => ({ action: { startsWith: p } })) }] : []),
            ...(before
              ? [
                  {
                    OR: [{ createdAt: { lt: before.at } }, { createdAt: before.at, id: { lt: before.id } }],
                  },
                ]
              : []),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
      });
    });
    const rows = (shards.flat() as Row[]).sort(
      (a, b) => +b.createdAt - +a.createdAt || (b.id > a.id ? 1 : b.id < a.id ? -1 : 0),
    );
    const page = rows.slice(0, limit);
    return {
      entries: await this.describe(page),
      next: rows.length > limit ? cursorOf(page[page.length - 1]!) : null,
    };
  }

  /** One person's trail: what they did, and what was done to their account. Recorded. */
  async trail(publicId: string, adminId: bigint, ctx: RequestContext): Promise<AuditEntry[]> {
    const userId = await this.plane.idOfPublic('user', publicId);
    const db = userId === null ? null : await this.plane.user(userId).catch(() => null);
    if (!db || userId === null) throw AppError.notFound('Account');
    const rows = await db.auditLog.findMany({
      where: { OR: [{ userId }, { resourceType: 'user', resourceId: userId }] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    await auditPerson(this.plane, adminId, {
      userId: adminId,
      action: 'admin.account_trail_viewed',
      resourceType: 'user',
      resourceId: userId,
      ...auditCtx(ctx),
    });
    return this.describe(rows);
  }

  /** Rows into entries: people and businesses by their public IDs and names, looked up once. */
  private async describe(rows: Row[]): Promise<AuditEntry[]> {
    const people = new Map<bigint, Promise<{ id: string; name: string } | null>>();
    const person = (id: bigint) => {
      if (!people.has(id))
        people.set(
          id,
          this.plane
            .user(id)
            .then((db) => db.user.findUnique({ where: { id }, select: { publicId: true, name: true } }))
            .then((u) => (u ? { id: u.publicId, name: u.name } : null))
            .catch(() => null),
        );
      return people.get(id)!;
    };
    const businesses = new Map<bigint, Promise<string | null>>();
    const business = (id: bigint) => {
      if (!businesses.has(id))
        businesses.set(
          id,
          this.plane.businessPublicId(id).catch(() => null),
        );
      return businesses.get(id)!;
    };

    return Promise.all(
      rows.map(async (r) => {
        const values = isRecord(r.newValues) ? r.newValues : null;
        const { reason, ...rest } = values ?? {};
        return {
          id: r.id.toString(),
          at: r.createdAt.toISOString(),
          actor: r.userId === null ? null : await person(r.userId),
          action: r.action,
          target: await this.target(r, values, person, business),
          reason: typeof reason === 'string' ? reason : null,
          details: Object.keys(rest).length ? rest : null,
          ip: r.ipAddress,
          requestId: r.requestId,
        };
      }),
    );
  }

  private async target(
    r: Row,
    values: Record<string, unknown> | null,
    person: (id: bigint) => Promise<{ id: string; name: string } | null>,
    business: (id: bigint) => Promise<string | null>,
  ): Promise<AuditEntry['target']> {
    if (r.resourceType === 'emergency_switch') {
      const key = typeof values?.key === 'string' ? values.key : null;
      return { type: 'switch', id: key, label: key };
    }
    // Nothing to point at (the access review, a settings change): no target to show.
    if (r.resourceId === null) return null;
    if (r.resourceType === 'user') {
      // A person's own steps name themselves; only show a target when it's someone else.
      if (r.resourceId === r.userId) return null;
      const p = await person(r.resourceId);
      return { type: 'person', id: p?.id ?? null, label: p?.name ?? null };
    }
    if (r.resourceType === 'business')
      return { type: 'business', id: await business(r.resourceId), label: null };
    const code = typeof values?.code === 'string' ? values.code : null;
    return { type: r.resourceType, id: r.resourceId.toString(), label: code };
  }
}

function parseCursor(raw: string | undefined): { at: Date; id: bigint } | null {
  const m = raw ? /^(\d{1,15})_(\d{1,19})$/.exec(raw) : null;
  return m ? { at: new Date(Number(m[1])), id: BigInt(m[2]!) } : null;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
