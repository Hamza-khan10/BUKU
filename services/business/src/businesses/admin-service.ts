import { AppError, ErrorCodes, pageMeta, type Pagination } from '@buku/common';
import { recordShardAudit, type BusinessTx, type DataPlane, type UserShardClient } from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS, type Topic } from '@buku/kafka';
import { auditCtx, type RequestContext } from '../http/context.js';
import type { LegalService } from '../legal/legal-service.js';
import { verificationChecklist } from '../verification/checklist.js';

export type BusinessStatus = 'pending' | 'verified' | 'suspended' | 'rejected';

/**
 * Platform-admin moderation (super_admin only).
 *
 * Verification state machine — every transition is a single conditional
 * UPDATE ("only if the status is currently X"), so two admins acting at once
 * can never produce an impossible state:
 *
 *   pending   ── verify ──▶ verified
 *   pending   ── reject ──▶ rejected   (owner fixes details → back to pending)
 *   any       ── suspend ─▶ suspended  (hidden from the public, read-only for owner)
 *   suspended ── reinstate ▶ verified (if it was verified) / pending
 *
 * Database v2 (D3c): one business is worked on inside its own transaction; the lists (oldest
 * first, paged) and the lawful export visit every business shard through business-service's
 * cross-business role (DB-020) and merge what each returns. Admin tools are low traffic, so a
 * visit to each shard per page is fine.
 */
export class AdminService {
  constructor(
    private readonly plane: DataPlane,
    private readonly legal: LegalService,
  ) {}

  async list(status: BusinessStatus, page: Pagination) {
    const { plane } = this;
    const take = page.page * page.limit;
    const shards = await plane.acrossBusinesses(async (tx) => {
      const where = { status, deletedAt: null };
      const rows = await tx.business.findMany({
        where,
        take,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], // oldest waiting first
        select: {
          id: true,
          publicId: true,
          slug: true,
          name: true,
          city: true,
          country: true,
          status: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          categoryId: true,
          ownerUserId: true,
          _count: { select: { reports: { where: { status: 'open' } } } },
        },
      });
      const categories = await tx.category.findMany({
        where: { id: { in: [...new Set(rows.map((r) => r.categoryId))] } },
        select: { id: true, name: true },
      });
      const names = new Map(categories.map((c) => [c.id, c.name]));
      return {
        total: await tx.business.count({ where }),
        rows: rows.map((r) => ({ ...r, categoryName: names.get(r.categoryId) ?? null })),
      };
    });
    const rows = shards
      .flatMap((s) => s.rows)
      .sort((a, b) => +a.createdAt - +b.createdAt || (a.id < b.id ? -1 : 1))
      .slice((page.page - 1) * page.limit, take);
    // Contact details stay encrypted; KYB comes in 2.2b.
    const owners = await this.people(rows.map((r) => r.ownerUserId));
    return {
      items: rows.map(({ _count, id: _id, publicId, categoryId: _c, categoryName, ownerUserId, ...b }) => ({
        id: publicId,
        ...b,
        category: { name: categoryName },
        owner: owners.get(ownerUserId) ?? null,
        openReports: _count.reports,
      })),
      meta: pageMeta(
        page.page,
        page.limit,
        shards.reduce((n, s) => n + s.total, 0),
      ),
    };
  }

  async verify(id: bigint, adminId: bigint, ctx: RequestContext) {
    const checklist = await this.plane.inBusiness(id, async (tx) => {
      const exists = await tx.business.count({ where: { id, deletedAt: null } });
      if (!exists) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      return verificationChecklist(tx, this.plane.directory, id);
    });
    if (!checklist.ready) {
      throw new AppError(
        'This business has not provided everything needed for verification',
        ErrorCodes.VERIFICATION_REQUIREMENTS_NOT_MET,
        409,
        {
          details: { missing: checklist.items.filter((i) => !i.met).map((i) => i.key) },
        },
      );
    }
    return this.transition(id, adminId, ctx, {
      from: ['pending'],
      data: { status: 'verified', verifiedAt: new Date(), rejectionReason: null },
      action: 'admin.business_verified',
      event: TOPICS.BUSINESSES_VERIFIED,
    });
  }

  reject(id: bigint, adminId: bigint, reason: string, ctx: RequestContext) {
    return this.transition(id, adminId, ctx, {
      from: ['pending'],
      data: { status: 'rejected', rejectionReason: reason },
      action: 'admin.business_rejected',
      event: TOPICS.BUSINESSES_UPDATED,
      eventData: { changedFields: ['status'] },
    });
  }

  suspend(id: bigint, adminId: bigint, reason: string, ctx: RequestContext) {
    return this.transition(id, adminId, ctx, {
      from: ['pending', 'verified', 'rejected'],
      // The reason is kept in rejection_reason (the "why is my business not live" field).
      data: { status: 'suspended', rejectionReason: reason },
      action: 'admin.business_suspended',
      event: TOPICS.BUSINESSES_SUSPENDED,
    });
  }

  async reinstate(id: bigint, adminId: bigint, ctx: RequestContext) {
    const b = await this.plane.inBusiness(id, (tx) =>
      tx.business.findFirst({ where: { id, deletedAt: null }, select: { verifiedAt: true } }),
    );
    if (!b) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const wasVerified = b.verifiedAt !== null;
    return this.transition(id, adminId, ctx, {
      from: ['suspended'],
      data: { status: wasVerified ? 'verified' : 'pending', rejectionReason: null },
      action: 'admin.business_reinstated',
      event: wasVerified ? TOPICS.BUSINESSES_VERIFIED : TOPICS.BUSINESSES_UPDATED,
    });
  }

  /**
   * Per-country list of businesses with their decrypted legal details, for a
   * LAWFUL request (e.g. a regulator). Requires a request reference and legal
   * basis, both recorded in the audit log with the admin and row count (D-033).
   */
  async exportCountry(
    country: string,
    request: { reference: string; legalBasis: string },
    adminId: bigint,
    ctx: RequestContext,
  ) {
    const { plane } = this;
    const shards = await plane.acrossBusinesses((tx) =>
      tx.business.findMany({
        where: { country, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          publicId: true,
          name: true,
          slug: true,
          status: true,
          verifiedAt: true,
          address: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          phone: true,
          email: true,
          website: true,
          createdAt: true,
          legalProfile: true,
        },
      }),
    );
    const rows = shards.flat().sort((a, b) => +a.createdAt - +b.createdAt);
    // On the admin's own shard: who exported what, why, and how much (the directory keeps no log).
    await recordShardAudit(await plane.user(adminId), plane.id(), {
      userId: adminId,
      action: 'admin.business_export',
      resourceType: 'country',
      newValues: { country, reference: request.reference, legalBasis: request.legalBasis, rows: rows.length },
      ...auditCtx(ctx),
    });
    return {
      country,
      generatedAt: new Date().toISOString(),
      request,
      businesses: rows.map(({ legalProfile, publicId, ...b }) => ({
        id: publicId,
        ...b,
        verified: b.status === 'verified',
        legal: legalProfile ? this.legal.decrypted(legalProfile) : null,
      })),
    };
  }

  async listReports(status: 'open' | 'reviewed' | 'dismissed', page: Pagination) {
    const take = page.page * page.limit;
    const shards = await this.plane.acrossBusinesses(async (tx) => {
      const where = { status };
      return {
        total: await tx.businessReport.count({ where }),
        rows: await tx.businessReport.findMany({
          where,
          take,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            reason: true,
            details: true,
            status: true,
            createdAt: true,
            reviewedAt: true,
            business: { select: { publicId: true, name: true, slug: true, status: true } },
          },
        }),
      };
    });
    const rows = shards
      .flatMap((s) => s.rows)
      .sort((a, b) => +a.createdAt - +b.createdAt || (a.id < b.id ? -1 : 1))
      .slice((page.page - 1) * page.limit, take);
    return {
      items: rows.map(({ id, business: { publicId, ...business }, ...r }) => ({
        id: id.toString(),
        ...r,
        business: { id: publicId, ...business },
      })),
      meta: pageMeta(
        page.page,
        page.limit,
        shards.reduce((n, s) => n + s.total, 0),
      ),
    };
  }

  /** A report, found by its ID in whichever business shard holds it; audited with the business. */
  async resolveReport(
    reportId: bigint,
    adminId: bigint,
    status: 'reviewed' | 'dismissed',
    ctx: RequestContext,
  ) {
    const { plane } = this;
    const resolved = await plane.acrossBusinesses(async (tx) => {
      const { count } = await tx.businessReport.updateMany({
        where: { id: reportId, status: 'open' },
        data: { status, reviewedById: adminId, reviewedAt: new Date() },
      });
      if (count > 0) {
        await recordShardAudit(tx, plane.id(), {
          userId: adminId,
          action: 'admin.report_resolved',
          resourceType: 'business_report',
          resourceId: reportId,
          newValues: { status },
          ...auditCtx(ctx),
        });
      }
      return count;
    });
    if (resolved.every((n) => n === 0)) throw AppError.notFound('Open report');
    return { id: reportId.toString(), status };
  }

  // ── internals ──────────────────────────────────────────────────────────

  /** Owners' public ID and name, read on each one's shard (one query per shard). */
  private async people(userIds: bigint[]) {
    const byShard = new Map<UserShardClient, bigint[]>();
    for (const id of new Set(userIds)) {
      const db = await this.plane.user(id).catch(() => null);
      if (db) byShard.set(db, [...(byShard.get(db) ?? []), id]);
    }
    const found = new Map<bigint, { id: string; name: string }>();
    for (const [db, ids] of byShard) {
      for (const p of await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, publicId: true, name: true },
      }))
        found.set(p.id, { id: p.publicId, name: p.name });
    }
    return found;
  }

  private async transition(
    id: bigint,
    adminId: bigint,
    ctx: RequestContext,
    t: {
      from: BusinessStatus[];
      data: { status: BusinessStatus; verifiedAt?: Date; rejectionReason?: string | null };
      action: string;
      event: Topic;
      eventData?: object;
    },
  ) {
    const { plane } = this;
    return plane.inBusiness(id, async (tx: BusinessTx) => {
      const { count } = await tx.business.updateMany({
        where: { id, deletedAt: null, status: { in: t.from } },
        data: t.data,
      });
      if (count === 0) {
        const exists = await tx.business.findFirst({
          where: { id, deletedAt: null },
          select: { status: true },
        });
        if (!exists) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
        throw new AppError(
          `Cannot change a ${exists.status} business to ${t.data.status}`,
          ErrorCodes.INVALID_TRANSITION,
          409,
        );
      }
      const business = await tx.business.findUniqueOrThrow({ where: { id }, select: { publicId: true } });
      await enqueueShardEvent(
        tx,
        plane.id(),
        createEvent({
          type: t.event,
          source: 'business-service',
          subject: id.toString(),
          data: { businessId: id.toString(), status: t.data.status, ...t.eventData },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'business',
      );
      await recordShardAudit(tx, plane.id(), {
        userId: adminId,
        action: t.action,
        resourceType: 'business',
        resourceId: id,
        newValues: {
          status: t.data.status,
          ...(t.data.rejectionReason && { reason: t.data.rejectionReason }),
        },
        ...auditCtx(ctx),
      });
      return { id: business.publicId, status: t.data.status };
    });
  }
}
