import { AppError, ErrorCodes, pageMeta, toSkipTake, type Pagination } from '@buku/common';
import { recordAudit, type BusinessStatus, type Database } from '@buku/database';
import { createEvent, enqueueEvent, TOPICS, type Topic } from '@buku/kafka';
import { auditCtx, type RequestContext } from '../http/context.js';
import type { LegalService } from '../legal/legal-service.js';
import { verificationChecklist } from '../verification/checklist.js';

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
 */
export class AdminService {
  constructor(
    private readonly db: Database,
    private readonly legal: LegalService,
  ) {}

  async list(status: BusinessStatus, page: Pagination) {
    const where = { status, deletedAt: null };
    const [rows, total] = await Promise.all([
      this.db.business.findMany({
        where,
        ...toSkipTake(page),
        orderBy: { createdAt: 'asc' }, // oldest waiting first
        select: {
          id: true,
          slug: true,
          name: true,
          city: true,
          country: true,
          status: true,
          verified: true,
          rejectionReason: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { name: true } },
          owner: { select: { id: true, name: true } }, // contact details stay encrypted; KYB comes in 2.2b
          _count: { select: { reports: { where: { status: 'open' } } } },
        },
      }),
      this.db.business.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, ...b }) => ({ ...b, openReports: _count.reports })),
      meta: pageMeta(page.page, page.limit, total),
    };
  }

  async verify(id: string, adminId: string, ctx: RequestContext) {
    const exists = await this.db.business.count({ where: { id, deletedAt: null } });
    if (!exists) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const checklist = await verificationChecklist(this.db, id);
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
      data: { status: 'verified', verified: true, verifiedAt: new Date(), rejectionReason: null },
      action: 'admin.business_verified',
      event: TOPICS.BUSINESSES_VERIFIED,
    });
  }

  reject(id: string, adminId: string, reason: string, ctx: RequestContext) {
    return this.transition(id, adminId, ctx, {
      from: ['pending'],
      data: { status: 'rejected', verified: false, rejectionReason: reason },
      action: 'admin.business_rejected',
      event: TOPICS.BUSINESSES_UPDATED,
      eventData: { changedFields: ['status'] },
    });
  }

  suspend(id: string, adminId: string, reason: string, ctx: RequestContext) {
    return this.transition(id, adminId, ctx, {
      from: ['pending', 'verified', 'rejected'],
      // The reason is kept in rejection_reason (the "why is my business not live" field).
      data: { status: 'suspended', rejectionReason: reason },
      action: 'admin.business_suspended',
      event: TOPICS.BUSINESSES_SUSPENDED,
    });
  }

  async reinstate(id: string, adminId: string, ctx: RequestContext) {
    const b = await this.db.business.findFirst({
      where: { id, deletedAt: null },
      select: { verifiedAt: true },
    });
    if (!b) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const wasVerified = b.verifiedAt !== null;
    return this.transition(id, adminId, ctx, {
      from: ['suspended'],
      data: { status: wasVerified ? 'verified' : 'pending', verified: wasVerified, rejectionReason: null },
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
    adminId: string,
    ctx: RequestContext,
  ) {
    const rows = await this.db.business.findMany({
      where: { country, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        verified: true,
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
    });
    await recordAudit(this.db, {
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
      businesses: rows.map(({ legalProfile, ...b }) => ({
        ...b,
        legal: legalProfile ? this.legal.decrypted(legalProfile) : null,
      })),
    };
  }

  async listReports(status: 'open' | 'reviewed' | 'dismissed', page: Pagination) {
    const where = { status };
    const [rows, total] = await Promise.all([
      this.db.businessReport.findMany({
        where,
        ...toSkipTake(page),
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          reason: true,
          details: true,
          status: true,
          createdAt: true,
          reviewedAt: true,
          business: { select: { id: true, name: true, slug: true, status: true } },
        },
      }),
      this.db.businessReport.count({ where }),
    ]);
    return { items: rows, meta: pageMeta(page.page, page.limit, total) };
  }

  async resolveReport(
    reportId: string,
    adminId: string,
    status: 'reviewed' | 'dismissed',
    ctx: RequestContext,
  ) {
    const { count } = await this.db.businessReport.updateMany({
      where: { id: reportId, status: 'open' },
      data: { status, reviewedById: adminId, reviewedAt: new Date() },
    });
    if (count === 0) throw AppError.notFound('Open report');
    await recordAudit(this.db, {
      userId: adminId,
      action: 'admin.report_resolved',
      resourceType: 'business_report',
      resourceId: reportId,
      newValues: { status },
      ...auditCtx(ctx),
    });
    return { id: reportId, status };
  }

  private async transition(
    id: string,
    adminId: string,
    ctx: RequestContext,
    t: {
      from: BusinessStatus[];
      data: {
        status: BusinessStatus;
        verified?: boolean;
        verifiedAt?: Date;
        rejectionReason?: string | null;
      };
      action: string;
      event: Topic;
      eventData?: object;
    },
  ) {
    return this.db.$transaction(async (tx) => {
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
      await enqueueEvent(
        tx,
        createEvent({
          type: t.event,
          source: 'business-service',
          subject: id,
          data: { businessId: id, status: t.data.status, ...t.eventData },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'business',
      );
      await recordAudit(tx, {
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
      return { id, status: t.data.status };
    });
  }
}
