import { AppError, businessReliability, ErrorCodes, type Actor } from '@buku/common';
import {
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import { findBookableBusiness } from '../businesses.js';
import { auditCtx, type RequestContext } from '../http/context.js';
import { announceListing } from '../listing.js';

/**
 * Reviews (D-077). Only real customers review: their own visit that happened
 * (completed, or checked in and started), within 30 days of it, once. They
 * can change it for 7 days and delete it any time. The business sees the
 * reviewer as "Ayesha K.", can reply once (and change or remove the reply),
 * and can report a review it believes is abusive or fake — only an admin can
 * hide one, and a hidden review stops counting in the rating (database
 * trigger). Phone numbers and emails written into a review are masked.
 *
 * Database v2 (D3d): a review lives with its business; the reviewer's name is read on their own
 * shard when shown; "my reviews" visits only the shards of businesses the person went to.
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

type Review = BusinessShard.Review;
/** What a review is shown with: the visit it is about, and who wrote it. */
interface Context {
  visits: Map<bigint, { publicId: string; startAt: Date; service: string; staff: string | null }>;
  authors: Map<bigint, { name: string; deleted: boolean }>;
}

export class ReviewService {
  constructor(private readonly plane: DataPlane) {}

  // ── The customer ──────────────────────────────────────────────────────────

  async create(
    userId: bigint,
    appointmentPublicId: string,
    input: RatingsInput,
    ctx: RequestContext,
    now = new Date(),
  ) {
    const { plane } = this;
    const { businessId, appointmentId } = await this.myVisit(userId, appointmentPublicId);
    try {
      const review = await plane.inBusiness(businessId, async (tx) => {
        const a = await visitOf(tx, appointmentId);
        if (!a || a.userId !== userId) throw AppError.notFound('Appointment');
        const visited =
          a.status === 'completed' ||
          (a.status === 'confirmed' && a.checkedInAt !== null && a.startAt <= now);
        if (!visited) {
          throw new AppError(
            'You can review a visit once it has happened',
            ErrorCodes.REVIEW_NOT_ALLOWED,
            422,
          );
        }
        if (now.getTime() - a.startAt.getTime() > REVIEW_RULES.windowDays * DAY) {
          throw new AppError(
            `Reviews can be left up to ${REVIEW_RULES.windowDays} days after a visit`,
            ErrorCodes.REVIEW_NOT_ALLOWED,
            422,
          );
        }
        const review = await tx.review.create({
          data: {
            id: plane.id(),
            appointmentId: a.id,
            appointmentStartAt: a.startAt,
            userId,
            businessId,
            ...ratings(input),
          },
        });
        await this.audit(tx, userId, 'review.created', review.id, ctx, { overall: input.overall });
        await this.event(tx, TOPICS.REVIEWS_CREATED, review.id, {
          reviewId: review.id.toString(),
          appointmentId: a.id.toString(),
          businessId: businessId.toString(),
          overall: input.overall,
        });
        await announceListing(tx, plane, businessId, 'rating');
        return review;
      });
      return this.mineView(review, await this.context(businessId, [review]), now);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw AppError.conflict('You already reviewed this visit; edit it instead', ErrorCodes.REVIEW_EXISTS);
      }
      throw err;
    }
  }

  async update(
    userId: bigint,
    appointmentPublicId: string,
    input: RatingsInput,
    ctx: RequestContext,
    now = new Date(),
  ) {
    const { businessId, appointmentId } = await this.myVisit(userId, appointmentPublicId);
    const review = await this.plane.inBusiness(businessId, async (tx) => {
      const current = await ownReview(tx, userId, appointmentId);
      if (now.getTime() - current.createdAt.getTime() > REVIEW_RULES.editDays * DAY) {
        throw new AppError(
          `Reviews can be changed for ${REVIEW_RULES.editDays} days after posting`,
          ErrorCodes.REVIEW_LOCKED,
          409,
        );
      }
      const review = await tx.review.update({
        where: { id: current.id },
        data: { ...ratings(input), editedAt: now },
      });
      await this.audit(tx, userId, 'review.edited', review.id, ctx, {
        overall: { from: current.overallRating, to: input.overall },
      });
      await announceListing(tx, this.plane, businessId, 'rating');
      return review;
    });
    return this.mineView(review, await this.context(businessId, [review]), now);
  }

  /** Always allowed: it's their words. The rating is recalculated by the database. */
  async remove(userId: bigint, appointmentPublicId: string, ctx: RequestContext) {
    const { businessId, appointmentId } = await this.myVisit(userId, appointmentPublicId);
    await this.plane.inBusiness(businessId, async (tx) => {
      const current = await ownReview(tx, userId, appointmentId);
      await tx.review.delete({ where: { id: current.id } });
      await this.audit(tx, userId, 'review.deleted', current.id, ctx);
      await announceListing(tx, this.plane, businessId, 'rating');
    });
  }

  /** My reviews, newest first, from the businesses I went to (my own list says which). */
  async mine(userId: bigint, page: number, limit: number) {
    const visited = await (
      await this.plane.user(userId)
    ).userAppointment.findMany({ where: { userId }, distinct: ['businessId'], select: { businessId: true } });
    const found = await this.plane.atBusinesses(
      visited.map((v) => v.businessId),
      async (tx, businessIds) => {
        const reviews = await tx.review.findMany({
          where: { userId, businessId: { in: businessIds } },
          include: { business: { select: { publicId: true, slug: true, name: true } } },
        });
        return { reviews, visits: await visitsOf(tx, reviews) };
      },
    );
    const all = found.flatMap((f) => f.reviews).sort((a, b) => +b.createdAt - +a.createdAt);
    const pageRows = all.slice((page - 1) * limit, page * limit);
    const context: Context = {
      visits: new Map(found.flatMap((f) => [...f.visits])),
      authors: await this.authors(pageRows.map((r) => r.userId)),
    };
    const now = new Date();
    return {
      items: pageRows.map((r) => ({
        ...this.mineView(r, context, now),
        business: { id: r.business.publicId, slug: r.business.slug, name: r.business.name },
      })),
      meta: { page, limit, total: all.length, totalPages: Math.ceil(all.length / limit) },
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
    const business = await findBookableBusiness(this.plane, idOrSlug);
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
    const { rows, total, summary, visits } = await this.plane.inBusiness(business.id, async (tx) => {
      const rows = await tx.review.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return {
        rows,
        total: await tx.review.count({ where }),
        summary: await summaryOf(tx, business.id),
        visits: await visitsOf(tx, rows),
      };
    });
    const context: Context = { visits, authors: await this.authors(rows.map((r) => r.userId)) };
    return {
      items: rows.map((r) => publicView(r, context)),
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
  async summary(businessId: bigint) {
    return this.plane.inBusiness(businessId, (tx) => summaryOf(tx, businessId));
  }

  // ── The business ──────────────────────────────────────────────────────────

  async respond(businessId: bigint, reviewId: bigint, actor: Actor, text: string, ctx: RequestContext) {
    const updated = await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'reviews.respond');
      const review = await businessReview(tx, businessId, reviewId);
      const updated = await tx.review.update({
        where: { id: review.id },
        data: { ownerResponse: maskContacts(text), ownerRespondedAt: new Date() },
      });
      await this.audit(tx, actor.id, 'review.responded', review.id, ctx, {
        businessId: businessId.toString(),
        replaced: review.ownerResponse !== null,
      });
      // The reviewer hears about the first reply only (not every edit of it).
      if (review.ownerResponse === null) {
        await this.event(tx, TOPICS.REVIEWS_RESPONDED, review.id, {
          reviewId: review.id.toString(),
          appointmentId: review.appointmentId.toString(),
          businessId: businessId.toString(),
          userId: review.userId.toString(),
        });
      }
      return updated;
    });
    return publicView(updated, await this.context(businessId, [updated]));
  }

  async removeResponse(businessId: bigint, reviewId: bigint, actor: Actor, ctx: RequestContext) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'reviews.respond');
      const review = await businessReview(tx, businessId, reviewId);
      await tx.review.update({
        where: { id: review.id },
        data: { ownerResponse: null, ownerRespondedAt: null },
      });
      await this.audit(tx, actor.id, 'review.response_removed', review.id, ctx, {
        businessId: businessId.toString(),
      });
    });
  }

  /** Report for an admin to look at. The review stays up until an admin decides. */
  async report(
    businessId: bigint,
    reviewId: bigint,
    actor: Actor,
    input: { reason: ReportReason; note?: string | undefined },
    ctx: RequestContext,
  ) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'reviews.respond');
      const review = await businessReview(tx, businessId, reviewId);
      if (review.isFlagged) throw AppError.conflict('Already reported', ErrorCodes.ALREADY_REPORTED);
      const reason = `${input.reason}${input.note ? `: ${input.note}` : ''}`.slice(0, 200);
      await tx.review.update({
        where: { id: review.id },
        data: { isFlagged: true, flagReason: reason, flaggedAt: new Date(), flaggedById: actor.id },
      });
      await this.audit(tx, actor.id, 'review.reported', review.id, ctx, {
        businessId: businessId.toString(),
        reason: input.reason,
      });
    });
  }

  // ── Platform admins ───────────────────────────────────────────────────────

  /** Reported reviews from every business shard, oldest report first (an admin tool). */
  async reported(page: number, limit: number) {
    const take = page * limit;
    const found = await this.plane.acrossBusinesses(async (tx) => {
      const where = { isFlagged: true };
      const rows = await tx.review.findMany({
        where,
        include: { business: { select: { publicId: true, slug: true, name: true } } },
        orderBy: [{ flaggedAt: 'asc' }, { id: 'asc' }],
        take,
      });
      return { rows, total: await tx.review.count({ where }), visits: await visitsOf(tx, rows) };
    });
    const rows = found
      .flatMap((f) => f.rows)
      .sort((a, b) => +(a.flaggedAt ?? 0) - +(b.flaggedAt ?? 0) || (a.id < b.id ? -1 : 1))
      .slice((page - 1) * limit, take);
    const context: Context = {
      visits: new Map(found.flatMap((f) => [...f.visits])),
      authors: await this.authors(rows.map((r) => r.userId)),
    };
    const total = found.reduce((n, f) => n + f.total, 0);
    return {
      items: rows.map((r) => ({
        ...publicView(r, context),
        business: { id: r.business.publicId, slug: r.business.slug, name: r.business.name },
        visible: r.isVisible,
        report: { reason: r.flagReason, at: r.flaggedAt?.toISOString() ?? null },
        hidden: r.hiddenAt ? { at: r.hiddenAt.toISOString(), reason: r.hiddenReason } : null,
      })),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * Hide (stays stored, stops counting) or put back; either way the report is settled. The review
   * is found by its ID on whichever business shard holds it.
   */
  async moderate(
    reviewId: bigint,
    adminId: bigint,
    decision: { action: 'hide'; reason: string } | { action: 'keep' } | { action: 'restore' },
    ctx: RequestContext,
  ) {
    // Found on whichever shard holds it; changed in its business's own transaction, where the
    // rating's announcement can be written with it.
    const found = (
      await this.plane.acrossBusinesses((tx) =>
        tx.review.findUnique({ where: { id: reviewId }, select: { businessId: true } }),
      )
    ).find(Boolean);
    if (!found) throw AppError.notFound('Review');
    await this.plane.inBusiness(found.businessId, async (tx) => {
      const review = await tx.review.findUnique({ where: { id: reviewId } });
      if (!review) throw AppError.notFound('Review');
      await tx.review.update({
        where: { id: reviewId },
        data:
          // Either way the report is settled (its reason and who made it stay; the audit log has the rest).
          decision.action === 'hide'
            ? {
                isVisible: false,
                hiddenAt: new Date(),
                hiddenReason: decision.reason,
                isFlagged: false,
                flaggedAt: null,
              }
            : decision.action === 'restore'
              ? { isVisible: true, hiddenAt: null, hiddenReason: null, isFlagged: false, flaggedAt: null }
              : { isFlagged: false, flaggedAt: null },
      });
      await this.audit(
        tx,
        adminId,
        `review.${decision.action === 'keep' ? 'kept' : decision.action === 'hide' ? 'hidden' : 'restored'}`,
        reviewId,
        ctx,
        {
          businessId: review.businessId.toString(),
          ...(decision.action === 'hide' && { reason: decision.reason }),
        },
      );
      if (decision.action !== 'keep') await announceListing(tx, this.plane, review.businessId, 'rating');
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** One of my visits (by its public ID), from my own list; 404 for anyone else's. */
  private async myVisit(userId: bigint, appointmentPublicId: string) {
    const row = await (
      await this.plane.user(userId)
    ).userAppointment.findFirst({
      where: { userId, appointmentPublicId },
      select: { appointmentId: true, businessId: true },
    });
    if (!row) throw AppError.notFound('Appointment');
    return row;
  }

  /** What reviews of one business are shown with. */
  private async context(businessId: bigint, reviews: Review[]): Promise<Context> {
    return {
      visits: await this.plane.inBusiness(businessId, (tx) => visitsOf(tx, reviews)),
      authors: await this.authors(reviews.map((r) => r.userId)),
    };
  }

  /** Reviewers' names, read on their own shards. */
  private async authors(userIds: bigint[]) {
    const found = new Map<bigint, { name: string; deleted: boolean }>();
    for (const [db, ids] of await this.plane.usersByShard(userIds)) {
      for (const u of await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, deletedAt: true },
      }))
        found.set(u.id, { name: u.name, deleted: u.deletedAt !== null });
    }
    return found;
  }

  private mineView(r: Review, context: Context, now: Date) {
    return {
      ...publicView(r, context),
      // The visit as the customer names it everywhere else: its public ID (DB-042).
      appointmentId: context.visits.get(r.appointmentId)?.publicId ?? null,
      visible: r.isVisible,
      editableUntil: new Date(r.createdAt.getTime() + REVIEW_RULES.editDays * DAY).toISOString(),
      canEdit: now.getTime() - r.createdAt.getTime() <= REVIEW_RULES.editDays * DAY,
    };
  }

  private audit(
    tx: BusinessTx,
    userId: bigint,
    action: string,
    reviewId: bigint,
    ctx: RequestContext,
    values?: Record<string, unknown>,
  ) {
    return recordShardAudit(tx, this.plane.id(), {
      userId,
      action,
      resourceType: 'review',
      resourceId: reviewId,
      ...(values && { newValues: values }),
      ...auditCtx(ctx),
    });
  }

  private event(tx: BusinessTx, type: (typeof TOPICS)[keyof typeof TOPICS], reviewId: bigint, data: object) {
    return enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({ type, source: 'booking-service', subject: reviewId.toString(), data }),
      'review',
    );
  }
}

/** The appointment a review is about (its partition key comes from the index, DB-024). */
async function visitOf(tx: BusinessTx, appointmentId: bigint) {
  const index = await tx.appointmentIndex.findUnique({ where: { appointmentId }, select: { startAt: true } });
  return index
    ? tx.appointment.findUnique({
        where: { id_startAt: { id: appointmentId, startAt: index.startAt } },
        select: { id: true, userId: true, status: true, startAt: true, checkedInAt: true },
      })
    : null;
}

/** The visits these reviews are about: when, which service, who. */
async function visitsOf(tx: BusinessTx, reviews: Review[]): Promise<Context['visits']> {
  if (!reviews.length) return new Map();
  const rows = await tx.appointment.findMany({
    where: {
      id: { in: reviews.map((r) => r.appointmentId) },
      startAt: { in: reviews.map((r) => r.appointmentStartAt) },
    },
    select: {
      id: true,
      publicId: true,
      startAt: true,
      service: { select: { name: true } },
      staff: { select: { displayName: true } },
    },
  });
  return new Map(
    rows.map((a) => [
      a.id,
      {
        publicId: a.publicId,
        startAt: a.startAt,
        service: a.service.name,
        staff: a.staff?.displayName ?? null,
      },
    ]),
  );
}

async function summaryOf(tx: BusinessTx, businessId: bigint) {
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { avgRating: true, reviewCount: true },
  });
  const byStar = await tx.review.groupBy({
    by: ['overallRating'],
    where: { businessId, isVisible: true },
    _count: { _all: true },
  });
  const details = await tx.review.aggregate({
    where: { businessId, isVisible: true },
    _avg: { waitTimeRating: true, staffRating: true, cleanlinessRating: true, valueRating: true },
  });
  const stats = await tx.businessSearchStats.findUnique({ where: { businessId } });
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

async function ownReview(tx: BusinessTx, userId: bigint, appointmentId: bigint) {
  const review = await tx.review.findFirst({ where: { appointmentId, userId } });
  if (!review) throw AppError.notFound('Review');
  return review;
}

/** Reviews of other businesses look missing. */
async function businessReview(tx: BusinessTx, businessId: bigint, reviewId: bigint) {
  const review = await tx.review.findFirst({ where: { id: reviewId, businessId } });
  if (!review) throw AppError.notFound('Review');
  return review;
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
function publicView(r: Review, context: Context) {
  const visit = context.visits.get(r.appointmentId);
  const author = context.authors.get(r.userId);
  return {
    id: r.id.toString(),
    rating: {
      overall: r.overallRating,
      waitTime: r.waitTimeRating,
      staff: r.staffRating,
      cleanliness: r.cleanlinessRating,
      value: r.valueRating,
    },
    comment: r.comment,
    author: author ? reviewerName(author.name, author.deleted) : 'A customer',
    service: visit?.service ?? null,
    staff: visit?.staff ?? null,
    /** Month of the visit only ("2026-10"): enough to judge, not a timestamp of someone's day. */
    visitedIn: r.appointmentStartAt.toISOString().slice(0, 7),
    createdAt: r.createdAt.toISOString(),
    edited: r.editedAt !== null,
    response: r.ownerResponse
      ? { text: r.ownerResponse, at: r.ownerRespondedAt?.toISOString() ?? null }
      : null,
  };
}
