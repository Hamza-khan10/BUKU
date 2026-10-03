import { AppError, businessReliability, ErrorCodes } from '@buku/common';
import {
  isUniqueViolation,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { createEvent, enqueueEvent, TOPICS } from '@buku/kafka';
import { findBookableBusiness } from '../businesses.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Reviews (D-077). Only real customers review: their own visit that happened
 * (completed, or checked in and started), within 30 days of it, once. They
 * can change it for 7 days and delete it any time. The business sees the
 * reviewer as "Ayesha K.", can reply once (and change or remove the reply),
 * and can report a review it believes is abusive or fake — only an admin can
 * hide one, and a hidden review stops counting in the rating (database
 * trigger). Phone numbers and emails written into a review are masked.
 */

export const REVIEW_RULES = { windowDays: 30, editDays: 7 } as const;
const DAY = 86_400_000;

export interface RatingsInput {
  overall: number;
  waitTime?: number | undefined;
  staff?: number | undefined;
  cleanliness?: number | undefined;
  value?: number | undefined;
  comment?: string | undefined;
}

export const REPORT_REASONS = ['offensive', 'fake', 'not_a_customer', 'personal_info', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/** Contact details people paste into reviews (phone numbers, emails) are masked. */
export function maskContacts(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[contact removed]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, '').length >= 7 ? '[contact removed]' : m));
}

/** "Ayesha K." — reviewers are never shown in full; deleted accounts are "A customer". */
export function reviewerName(name: string, deleted: boolean): string {
  if (deleted) return 'A customer';
  const [first, ...rest] = name.trim().split(/\s+/);
  const last = rest.at(-1);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : (first ?? 'A customer');
}

const reviewInclude = {
  appointment: {
    select: {
      startAt: true,
      service: { select: { name: true } },
      staff: { select: { displayName: true } },
    },
  },
  user: { select: { name: true, deletedAt: true } },
} as const;

type ReviewRow = Awaited<ReturnType<Database['review']['findFirstOrThrow']>> & {
  appointment: { startAt: Date; service: { name: string }; staff: { displayName: string } | null };
  user: { name: string; deletedAt: Date | null };
};

export class ReviewService {
  constructor(private readonly db: Database) {}

  // ── The customer ──────────────────────────────────────────────────────────

  async create(
    userId: string,
    appointmentId: string,
    input: RatingsInput,
    ctx: RequestContext,
    now = new Date(),
  ) {
    const a = await this.db.appointment.findFirst({
      where: { id: appointmentId, userId },
      select: { id: true, businessId: true, status: true, startAt: true, checkedInAt: true },
    });
    if (!a) throw AppError.notFound('Appointment');
    const visited =
      a.status === 'completed' || (a.status === 'confirmed' && a.checkedInAt !== null && a.startAt <= now);
    if (!visited) {
      throw new AppError('You can review a visit once it has happened', ErrorCodes.REVIEW_NOT_ALLOWED, 422);
    }
    if (now.getTime() - a.startAt.getTime() > REVIEW_RULES.windowDays * DAY) {
      throw new AppError(
        `Reviews can be left up to ${REVIEW_RULES.windowDays} days after a visit`,
        ErrorCodes.REVIEW_NOT_ALLOWED,
        422,
      );
    }
    try {
      const review = await this.db.$transaction(async (tx) => {
        const review = await tx.review.create({
          data: { appointmentId: a.id, userId, businessId: a.businessId, ...ratings(input) },
          include: reviewInclude,
        });
        await this.audit(tx, userId, 'review.created', review.id, ctx, { overall: input.overall });
        await this.event(tx, TOPICS.REVIEWS_CREATED, review.id, {
          reviewId: review.id,
          appointmentId: a.id,
          businessId: a.businessId,
          overall: input.overall,
        });
        return review;
      });
      return this.mineView(review, now);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('You already reviewed this visit; edit it instead', ErrorCodes.REVIEW_EXISTS);
      }
      throw err;
    }
  }

  async update(
    userId: string,
    appointmentId: string,
    input: RatingsInput,
    ctx: RequestContext,
    now = new Date(),
  ) {
    const current = await this.ownReview(userId, appointmentId);
    if (now.getTime() - current.createdAt.getTime() > REVIEW_RULES.editDays * DAY) {
      throw new AppError(
        `Reviews can be changed for ${REVIEW_RULES.editDays} days after posting`,
        ErrorCodes.REVIEW_LOCKED,
        409,
      );
    }
    const review = await this.db.$transaction(async (tx) => {
      const review = await tx.review.update({
        where: { id: current.id },
        data: { ...ratings(input), editedAt: now },
        include: reviewInclude,
      });
      await this.audit(tx, userId, 'review.edited', review.id, ctx, {
        overall: { from: current.overallRating, to: input.overall },
      });
      return review;
    });
    return this.mineView(review, now);
  }

  /** Always allowed: it's their words. The rating is recalculated by the database. */
  async remove(userId: string, appointmentId: string, ctx: RequestContext) {
    const current = await this.ownReview(userId, appointmentId);
    await this.db.$transaction(async (tx) => {
      await tx.review.delete({ where: { id: current.id } });
      await this.audit(tx, userId, 'review.deleted', current.id, ctx);
    });
  }

  async mine(userId: string, page: number, limit: number) {
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.db.review.findMany({
        where,
        include: { ...reviewInclude, business: { select: { id: true, slug: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.review.count({ where }),
    ]);
    const now = new Date();
    return {
      items: rows.map((r) => ({
        ...this.mineView(r, now),
        business: r.business,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // ── Everyone ──────────────────────────────────────────────────────────────

  async forBusiness(
    idOrSlug: string,
    query: {
      sort: 'recent' | 'highest' | 'lowest';
      rating?: number | undefined;
      withComment?: boolean | undefined;
      page: number;
      limit: number;
    },
  ) {
    const business = await findBookableBusiness(this.db, idOrSlug);
    const where = {
      businessId: business.id,
      isVisible: true,
      ...(query.rating && { overallRating: query.rating }),
      ...(query.withComment && { comment: { not: null } }),
    };
    const orderBy =
      query.sort === 'highest'
        ? [{ overallRating: 'desc' as const }, { createdAt: 'desc' as const }]
        : query.sort === 'lowest'
          ? [{ overallRating: 'asc' as const }, { createdAt: 'desc' as const }]
          : [{ createdAt: 'desc' as const }];
    const [rows, total, summary] = await Promise.all([
      this.db.review.findMany({
        where,
        include: reviewInclude,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.db.review.count({ where }),
      this.summary(business.id),
    ]);
    return {
      items: rows.map((r) => publicView(r)),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        summary,
      },
    };
  }

  /** The rating, how it's spread, the detail ratings, and the business's reliability. */
  async summary(businessId: string) {
    const [business, byStar, details, stats] = await Promise.all([
      this.db.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { avgRating: true, reviewCount: true },
      }),
      this.db.review.groupBy({
        by: ['overallRating'],
        where: { businessId, isVisible: true },
        _count: { _all: true },
      }),
      this.db.review.aggregate({
        where: { businessId, isVisible: true },
        _avg: { waitTimeRating: true, staffRating: true, cleanlinessRating: true, valueRating: true },
      }),
      this.db.businessSearchStats.findUnique({ where: { businessId } }),
    ]);
    const round1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
    return {
      average: business.avgRating.toNumber(),
      count: business.reviewCount,
      stars: Object.fromEntries(
        [5, 4, 3, 2, 1].map((s) => [s, byStar.find((b) => b.overallRating === s)?._count._all ?? 0]),
      ),
      details: {
        waitTime: round1(details._avg.waitTimeRating),
        staff: round1(details._avg.staffRating),
        cleanliness: round1(details._avg.cleanlinessRating),
        value: round1(details._avg.valueRating),
      },
      reliability: stats ? businessReliability(stats.kept90d, stats.businessCancels90d) : null,
    };
  }

  // ── The business ──────────────────────────────────────────────────────────

  async respond(businessId: string, reviewId: string, actorId: string, text: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, actorId, 'reviews.respond');
    const review = await this.businessReview(businessId, reviewId);
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.review.update({
        where: { id: review.id },
        data: { ownerResponse: maskContacts(text), ownerRespondedAt: new Date() },
        include: reviewInclude,
      });
      await this.audit(tx, actorId, 'review.responded', review.id, ctx, {
        businessId,
        replaced: review.ownerResponse !== null,
      });
      // The reviewer hears about the first reply only (not every edit of it).
      if (review.ownerResponse === null) {
        await this.event(tx, TOPICS.REVIEWS_RESPONDED, review.id, {
          reviewId: review.id,
          appointmentId: review.appointmentId,
          businessId,
          userId: review.userId,
        });
      }
      return updated;
    });
    return publicView(updated);
  }

  async removeResponse(businessId: string, reviewId: string, actorId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, actorId, 'reviews.respond');
    const review = await this.businessReview(businessId, reviewId);
    await this.db.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: review.id },
        data: { ownerResponse: null, ownerRespondedAt: null },
      });
      await this.audit(tx, actorId, 'review.response_removed', review.id, ctx, { businessId });
    });
  }

  /** Report for an admin to look at. The review stays up until an admin decides. */
  async report(
    businessId: string,
    reviewId: string,
    actorId: string,
    input: { reason: ReportReason; note?: string | undefined },
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'reviews.respond');
    const review = await this.businessReview(businessId, reviewId);
    if (review.isFlagged) throw AppError.conflict('Already reported', ErrorCodes.ALREADY_REPORTED);
    const reason = `${input.reason}${input.note ? `: ${input.note}` : ''}`.slice(0, 200);
    await this.db.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: review.id },
        data: { isFlagged: true, flagReason: reason, flaggedAt: new Date(), flaggedById: actorId },
      });
      await this.audit(tx, actorId, 'review.reported', review.id, ctx, { businessId, reason: input.reason });
    });
  }

  // ── Platform admins ───────────────────────────────────────────────────────

  async reported(page: number, limit: number) {
    const where = { isFlagged: true };
    const [rows, total] = await Promise.all([
      this.db.review.findMany({
        where,
        include: { ...reviewInclude, business: { select: { id: true, slug: true, name: true } } },
        orderBy: { flaggedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.review.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        ...publicView(r),
        business: r.business,
        visible: r.isVisible,
        report: { reason: r.flagReason, at: r.flaggedAt?.toISOString() ?? null },
        hidden: r.hiddenAt ? { at: r.hiddenAt.toISOString(), reason: r.hiddenReason } : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /** Hide (stays stored, stops counting) or put back; either way the report is settled. */
  async moderate(
    reviewId: string,
    adminId: string,
    decision: { action: 'hide'; reason: string } | { action: 'keep' } | { action: 'restore' },
    ctx: RequestContext,
  ) {
    const review = await this.db.review.findUnique({ where: { id: reviewId } });
    if (!review) throw AppError.notFound('Review');
    await this.db.$transaction(async (tx) => {
      await tx.review.update({
        where: { id: reviewId },
        data:
          decision.action === 'hide'
            ? { isVisible: false, hiddenAt: new Date(), hiddenReason: decision.reason, isFlagged: false }
            : decision.action === 'restore'
              ? { isVisible: true, hiddenAt: null, hiddenReason: null, isFlagged: false }
              : { isFlagged: false },
      });
      await this.audit(
        tx,
        adminId,
        `review.${decision.action === 'keep' ? 'kept' : decision.action === 'hide' ? 'hidden' : 'restored'}`,
        reviewId,
        ctx,
        {
          businessId: review.businessId,
          ...(decision.action === 'hide' && { reason: decision.reason }),
        },
      );
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async ownReview(userId: string, appointmentId: string) {
    const review = await this.db.review.findFirst({ where: { appointmentId, userId } });
    if (!review) throw AppError.notFound('Review');
    return review;
  }

  /** Reviews of other businesses look missing. */
  private async businessReview(businessId: string, reviewId: string) {
    const review = await this.db.review.findFirst({ where: { id: reviewId, businessId } });
    if (!review) throw AppError.notFound('Review');
    return review;
  }

  private mineView(r: ReviewRow, now: Date) {
    return {
      ...publicView(r),
      appointmentId: r.appointmentId,
      visible: r.isVisible,
      editableUntil: new Date(r.createdAt.getTime() + REVIEW_RULES.editDays * DAY).toISOString(),
      canEdit: now.getTime() - r.createdAt.getTime() <= REVIEW_RULES.editDays * DAY,
    };
  }

  private audit(
    tx: Transaction,
    userId: string,
    action: string,
    reviewId: string,
    ctx: RequestContext,
    values?: Record<string, unknown>,
  ) {
    return recordAudit(tx, {
      userId,
      action,
      resourceType: 'review',
      resourceId: reviewId,
      ...(values && { newValues: values as never }),
      ...auditCtx(ctx),
    });
  }

  private event(tx: Transaction, type: (typeof TOPICS)[keyof typeof TOPICS], reviewId: string, data: object) {
    return enqueueEvent(
      tx,
      createEvent({ type, source: 'booking-service', subject: reviewId, data }),
      'review',
    );
  }
}

function ratings(input: RatingsInput) {
  return {
    overallRating: input.overall,
    waitTimeRating: input.waitTime ?? null,
    staffRating: input.staff ?? null,
    cleanlinessRating: input.cleanliness ?? null,
    valueRating: input.value ?? null,
    comment: input.comment ? maskContacts(input.comment) : null,
  };
}

/** What anyone may see. Built field by field: no user ids, no contact details. */
function publicView(r: ReviewRow) {
  return {
    id: r.id,
    rating: {
      overall: r.overallRating,
      waitTime: r.waitTimeRating,
      staff: r.staffRating,
      cleanliness: r.cleanlinessRating,
      value: r.valueRating,
    },
    comment: r.comment,
    author: reviewerName(r.user.name, r.user.deletedAt !== null),
    service: r.appointment.service.name,
    staff: r.appointment.staff?.displayName ?? null,
    /** Month of the visit only ("2026-10"): enough to judge, not a timestamp of someone's day. */
    visitedIn: r.appointment.startAt.toISOString().slice(0, 7),
    createdAt: r.createdAt.toISOString(),
    edited: r.editedAt !== null,
    response: r.ownerResponse
      ? { text: r.ownerResponse, at: r.ownerRespondedAt?.toISOString() ?? null }
      : null,
  };
}
