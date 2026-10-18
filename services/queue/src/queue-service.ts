import { assertFeature, businessEntitlementsOnShard } from '@buku/billing';
import { AppError, ErrorCodes, logger, type Actor } from '@buku/common';
import {
  constraintNameOf,
  isUniqueViolation,
  requireBusinessPermissionOnShard,
  ShardNotFoundError,
  showUpLabelsOf,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS, type Topic } from '@buku/kafka';
import { estimateWaitMinutes, shouldAlert, ticketLabel } from './alerts.js';
import type { RequestContext } from './http/context.js';
import { effectiveQueueSettings } from './settings.js';

/**
 * The virtual queue (2.4). One session per business per day, opened by the
 * front desk. Customers join from their phone — only within the business's
 * distance (D-038) and holding at most ONE live ticket anywhere — or are added
 * at the counter as walk-ins. Each gets a ticket like "A-023" (D-057).
 *
 *   waiting ──call──▶ called ──serve──▶ serving ──complete──▶ completed
 *      │ leave           │ leave / no-show (after the grace period)
 *      ▼                 ▼
 *     left           left / no_show
 *
 * Database v2 (D3e): sessions and tickets live on the business's shard. "One queue at a time,
 * anywhere" is kept on the person's own shard (`user_active_tickets`, DB-014): their current or
 * latest ticket, claimed there before the business's shard writes it. How a ticket ended (served,
 * no-show) goes into the person's reliability (D-078). Every change to a session runs with that
 * session locked, so ticket numbers and "who's next" are never handed out twice. Changes are
 * published as events (the shard's outbox), including the "N people ahead of you" alerts.
 */

const LIVE = ['waiting', 'called', 'serving'] as const;
const PUBLIC_LINE_LENGTH = 300;
/** A claim whose ticket never appeared (a join that failed half-way) gives way after this long. */
const CLAIM_MS = 2 * 60_000;
/** Businesses customers can queue at: not deleted, not rejected or suspended. */
const BOOKABLE = ['pending', 'verified'] as const;
const NO_CONTEXT: RequestContext = { ip: null, userAgent: null, requestId: null };

type TicketStatus = 'waiting' | 'called' | 'serving' | 'completed' | 'left' | 'no_show';
type SessionRow = Awaited<ReturnType<BusinessTx['queueSession']['findUniqueOrThrow']>>;
type TicketRow = Awaited<ReturnType<BusinessTx['queueTicket']['findFirstOrThrow']>>;

export class QueueService {
  constructor(
    private readonly plane: DataPlane,
    /** Told after every committed change, so live screens update (live/live-hub.ts). */
    private readonly onChange: (businessId: bigint) => void = () => undefined,
  ) {}

  // ── Public: is there a queue, and how long is it? ────────────────────────

  async publicState(idOrSlug: string) {
    return this.publicStateOf(await this.businessIdOf(idOrSlug));
  }

  /** The internal ID of a business (by public ID or slug), for its live stream; 404 for none. */
  async businessIdOf(idOrSlug: string): Promise<bigint> {
    const id = await this.plane.businessIdOf(idOrSlug);
    if (id === null) throw businessNotFound();
    return id;
  }

  /** The public state of a business's queue (what live screens are sent); 404 once it's gone. */
  async publicStateOf(businessId: bigint) {
    return this.plane.inBusiness(businessId, async (tx) => {
      const business = await publicBusiness(tx, businessId);
      const settings = await effectiveQueueSettings(tx, businessId);
      const session = await todaySession(tx, business);
      if (!session) {
        return {
          businessId: business.publicId,
          status: 'closed' as const,
          remoteJoinRadiusMeters: settings.remoteJoinRadiusMeters,
        };
      }
      const entries = await tx.queueTicket.findMany({
        where: { sessionId: session.id, sessionDate: session.sessionDate, status: { in: [...LIVE] } },
        select: { ticketNumber: true, ticketPrefix: true, status: true, priorityLane: true },
        orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
      });
      const onShift = await staffOnShift(tx, businessId);
      const waiting = entries.filter((e) => e.status === 'waiting');
      const labels = (status: string) =>
        entries.filter((e) => e.status === status).map((e) => ticketLabel(e.ticketPrefix, e.ticketNumber));
      return {
        businessId: business.publicId,
        status: session.status,
        remoteJoinRadiusMeters: settings.remoteJoinRadiusMeters,
        waiting: waiting.length,
        /**
         * The waiting tickets in calling order (first PUBLIC_LINE_LENGTH). A phone finds its own
         * position here — ahead = index of its ticket — without a personal stream or login.
         */
        line: waiting.slice(0, PUBLIC_LINE_LENGTH).map((e) => ticketLabel(e.ticketPrefix, e.ticketNumber)),
        /** Ticket numbers only — never names. */
        called: labels('called'),
        serving: labels('serving'),
        /** For someone joining now. */
        estimatedWaitMinutes: estimateWaitMinutes(waiting.length, session.avgServiceSeconds, onShift),
        /** To estimate any position: ceil(ahead / max(1, staffOnShift)) × avgServiceSeconds. */
        avgServiceSeconds: session.avgServiceSeconds,
        staffOnShift: onShift,
      };
    });
  }

  // ── Customers ────────────────────────────────────────────────────────────

  async join(actor: Actor, input: { businessId: string; lat: number; lng: number }, ctx: RequestContext) {
    if (actor.role === 'staff') {
      throw new AppError('Employee accounts can’t join queues', ErrorCodes.BOOKING_NOT_ALLOWED, 403);
    }
    const businessId = await this.plane.idOfPublic('business', input.businessId);
    if (businessId === null) throw businessNotFound();
    const session = await this.plane.inBusiness(businessId, async (tx) => {
      const business = await publicBusiness(tx, businessId);
      const session = await todaySession(tx, business);
      assertOpenForJoining(session);
      const settings = await effectiveQueueSettings(tx, businessId);
      const distance = await distanceMeters(tx, businessId, input.lat, input.lng);
      if (distance === null) {
        throw new AppError(
          'This business takes queue sign-ups at the counter only',
          ErrorCodes.QUEUE_TOO_FAR,
          422,
        );
      }
      if (distance > settings.remoteJoinRadiusMeters) {
        throw new AppError(
          `You need to be within ${formatDistance(settings.remoteJoinRadiusMeters)} of the business to join its queue`,
          ErrorCodes.QUEUE_TOO_FAR,
          422,
          { details: { distanceMeters: Math.round(distance), maxMeters: settings.remoteJoinRadiusMeters } },
        );
      }
      return session!;
    });

    // The person's own shard first: one queue at a time, anywhere. The claim's ticket is this one.
    const ticketId = this.plane.id();
    await this.claim(actor.id, {
      ticketId,
      ticketSessionDate: session.sessionDate,
      businessId,
      sessionId: session.id,
    });
    try {
      return await this.changing(businessId, (tx) =>
        this.withSession(tx, session.id, async (fresh) => {
          assertOpenForJoining(fresh);
          await this.addEntry(tx, fresh, { id: ticketId, userId: actor.id, joinedRemotely: true }, ctx);
          return this.view(tx, ticketId, fresh.sessionDate);
        }),
      );
    } catch (err) {
      await this.release(actor.id, ticketId, businessId, session.sessionDate);
      if (isUniqueViolation(err) && constraintNameOf(err) === 'queue_tickets_one_live_per_person')
        throw alreadyJoined();
      throw err;
    }
  }

  /** My live ticket, wherever it is (at most one, D-038), or null. */
  async myTicket(userId: bigint) {
    const mine = await this.activeTicketOf(userId);
    if (!mine) return null;
    const found = await this.plane
      .inBusiness(mine.businessId, async (tx) => {
        const t = await loadTicket(tx, mine.ticketId, mine.ticketSessionDate);
        return t && holdsPlace(t) ? this.view(tx, t.id, t.sessionDate) : null;
      })
      .catch(nullIfShardGone);
    return found ?? null;
  }

  /** My current or latest ticket, by its ID; 404 for anyone else's (or an older one of mine). */
  async ticket(userId: bigint, ticketId: bigint) {
    const mine = await this.mine(userId, ticketId);
    const view = await this.plane
      .inBusiness(mine.businessId, async (tx) =>
        (await loadTicket(tx, ticketId, mine.ticketSessionDate))
          ? this.view(tx, ticketId, mine.ticketSessionDate)
          : null,
      )
      .catch(nullIfShardGone);
    if (!view) throw ticketNotFound();
    return view;
  }

  async leave(userId: bigint, ticketId: bigint, ctx: RequestContext) {
    const mine = await this.mine(userId, ticketId);
    return this.leaveTicket(mine, 'left', ctx);
  }

  /**
   * The customer closed their account: they leave the line they're waiting in, so the people
   * behind move up. Someone already being served is left alone. Safe to run again. Returns how
   * many tickets were given up.
   */
  async leaveForClosedAccount(userId: bigint, ctx: RequestContext): Promise<number> {
    const mine = await this.activeTicketOf(userId).catch(nullIfShardGone);
    if (!mine) return 0;
    try {
      await this.leaveTicket(mine, 'account_closed', ctx);
      return 1;
    } catch (err) {
      // Moved on meanwhile (served, marked absent), or never written: nothing to give up.
      if (
        err instanceof AppError &&
        (err.code === ErrorCodes.INVALID_TRANSITION || err.code === ErrorCodes.QUEUE_ENTRY_NOT_FOUND)
      )
        return 0;
      throw err;
    }
  }

  // ── The front desk ───────────────────────────────────────────────────────

  /** Today's queue as the front desk sees it: who's waiting (in order), called and being served. */
  async board(businessId: bigint, actor: Actor) {
    const { session, entries, onShift } = await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      const business = await businessRow(tx, businessId);
      const session = await todaySession(tx, business);
      const onShift = await staffOnShift(tx, businessId);
      const entries = session
        ? await tx.queueTicket.findMany({
            where: { sessionId: session.id, sessionDate: session.sessionDate, status: { in: [...LIVE] } },
            orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
          })
        : [];
      return { session, entries, onShift };
    });
    if (!session) return { session: null, staffOnShift: onShift, waiting: [], called: [], serving: [] };
    const people = entries.flatMap((e) => (e.userId ? [e.userId] : []));
    // "Shows up 95%" / "New customer" — a label only, never their history (D-078).
    const [names, showUp] = await Promise.all([this.namesOf(people), showUpLabelsOf(this.plane, people)]);
    const view = (e: TicketRow) => ({
      id: e.id.toString(),
      ticket: ticketLabel(e.ticketPrefix, e.ticketNumber),
      status: e.status,
      /** The customer's name, or the walk-in's — never contact details or pictures. */
      name: e.userId ? (names.get(e.userId) ?? null) : e.walkInName,
      reliability: e.userId
        ? (({ label, showsUpPercent }) => ({ label, showsUpPercent }))(showUp.get(e.userId)!)
        : null,
      walkIn: e.userId === null,
      priority: e.priorityLane,
      joinedRemotely: e.joinedRemotely,
      joinedAt: e.joinedAt.toISOString(),
      calledAt: e.calledAt?.toISOString() ?? null,
      noShowFrom: e.calledAt
        ? new Date(e.calledAt.getTime() + session.gracePeriodSeconds * 1000).toISOString()
        : null,
      servedAt: e.servedAt?.toISOString() ?? null,
    });
    return {
      session: {
        id: session.id.toString(),
        date: isoDate(session.sessionDate),
        status: session.status,
        ticketPrefix: session.ticketPrefix,
        lastCalled: session.lastCalledNumber
          ? ticketLabel(session.ticketPrefix, session.lastCalledNumber)
          : null,
        totalServed: session.totalServed,
        avgServiceMinutes: Math.round(session.avgServiceSeconds / 60),
        gracePeriodSeconds: session.gracePeriodSeconds,
        openedAt: session.openedAt?.toISOString() ?? null,
        closedAt: session.closedAt?.toISOString() ?? null,
      },
      staffOnShift: onShift,
      waiting: entries.filter((e) => e.status === 'waiting').map(view),
      called: entries.filter((e) => e.status === 'called').map(view),
      serving: entries.filter((e) => e.status === 'serving').map(view),
    };
  }

  /** Open today's queue (again). Settings are copied in at opening. */
  async open(businessId: bigint, actor: Actor, ctx: RequestContext) {
    try {
      await this.changing(businessId, async (tx) => {
        const business = await this.operator(tx, businessId, actor);
        const sessionDate = dateOnly(localDate(business.timezone));
        const existing = await tx.queueSession.findUnique({
          where: { businessId_sessionDate: { businessId, sessionDate } },
        });
        if (existing?.status === 'open') return;
        // The virtual queue is part of the business's plan (Starter: not included).
        assertFeature(await businessEntitlementsOnShard(tx, businessId), 'queue');
        const settings = await effectiveQueueSettings(tx, businessId);
        const session = existing
          ? await tx.queueSession.update({
              where: { id: existing.id },
              data: { status: 'open', closedAt: null, openedAt: existing.openedAt ?? new Date() },
            })
          : await tx.queueSession.create({
              data: {
                id: this.plane.id(),
                businessId,
                sessionDate,
                status: 'open',
                ticketPrefix: settings.ticketPrefix,
                maxQueueSize: settings.maxQueueSize,
                gracePeriodSeconds: settings.gracePeriodSeconds,
                avgServiceSeconds: settings.avgServiceSeconds,
                openedAt: new Date(),
              },
            });
        await this.publishSession(tx, TOPICS.QUEUE_SESSION_OPENED, session, ctx);
      });
    } catch (err) {
      // Opened by someone else at the same moment: it's open.
      if (!(
        isUniqueViolation(err) && constraintNameOf(err) === 'queue_sessions_business_id_session_date_key'
      ))
        throw err;
    }
    return this.board(businessId, actor);
  }

  /** No new remote joins; the front desk keeps calling and can still add walk-ins. */
  async pause(businessId: bigint, actor: Actor) {
    return this.setStatus(businessId, actor, ['open'], 'paused');
  }

  async resume(businessId: bigint, actor: Actor) {
    return this.setStatus(businessId, actor, ['paused'], 'open');
  }

  /** Close for the day: whoever is still waiting or called is told the queue closed. */
  async close(businessId: bigint, actor: Actor, ctx: RequestContext) {
    await this.atDesk(businessId, actor, (tx, today) =>
      this.withSession(tx, today.id, async (fresh) => {
        if (fresh.status === 'closed') return;
        const remaining = await tx.queueTicket.findMany({
          where: {
            sessionId: fresh.id,
            sessionDate: fresh.sessionDate,
            status: { in: ['waiting', 'called'] },
          },
        });
        await tx.queueTicket.updateMany({
          where: { id: { in: remaining.map((e) => e.id) }, sessionDate: fresh.sessionDate },
          data: { status: 'left', leftAt: new Date() },
        });
        for (const e of remaining)
          await this.publish(tx, TOPICS.QUEUE_ENTRY_LEFT, fresh, e, ctx, { reason: 'queue_closed' });
        await tx.queueSession.update({
          where: { id: fresh.id },
          data: { status: 'closed', closedAt: new Date() },
        });
        await this.publishSession(tx, TOPICS.QUEUE_SESSION_CLOSED, fresh, ctx);
      }),
    );
    return this.board(businessId, actor);
  }

  /** Someone at the counter (with or without the app). Allowed while paused too. */
  async walkIn(
    businessId: bigint,
    actor: Actor,
    input: { name?: string | undefined; priority?: boolean | undefined },
    ctx: RequestContext,
  ) {
    return this.atDesk(businessId, actor, (tx, today) =>
      this.withSession(tx, today.id, async (fresh) => {
        if (fresh.status === 'closed') throw closed();
        const id = this.plane.id();
        await this.addEntry(
          tx,
          fresh,
          { id, walkInName: input.name ?? null, priorityLane: input.priority ?? false },
          ctx,
        );
        return this.view(tx, id, fresh.sessionDate);
      }),
    );
  }

  /** Call whoever is next (priority lane first, then by ticket number). */
  async callNext(businessId: bigint, actor: Actor, ctx: RequestContext) {
    return this.atDesk(businessId, actor, (tx, today) =>
      this.withSession(tx, today.id, async (fresh) => {
        if (fresh.status === 'closed') throw closed();
        const next = await tx.queueTicket.findFirst({
          where: { sessionId: fresh.id, sessionDate: fresh.sessionDate, status: 'waiting' },
          orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
        });
        if (!next) throw AppError.conflict('Nobody is waiting');
        await this.callEntry(tx, fresh, next, ctx);
        return this.view(tx, next.id, fresh.sessionDate);
      }),
    );
  }

  async call(businessId: bigint, ticketId: bigint, actor: Actor, ctx: RequestContext) {
    return this.onTicket(businessId, ticketId, actor, async (tx, session, entry) => {
      if (entry.status !== 'waiting') throw invalid(entry.status, 'called');
      await this.callEntry(tx, session, entry, ctx);
    });
  }

  async serve(businessId: bigint, ticketId: bigint, actor: Actor, ctx: RequestContext) {
    return this.onTicket(businessId, ticketId, actor, async (tx, session, entry) => {
      await move(tx, entry, ['waiting', 'called'], 'serving', { servedAt: new Date() });
      await this.publish(tx, TOPICS.QUEUE_ENTRY_SERVED, session, entry, ctx);
    });
  }

  /** Done. The day's average service time (used for wait estimates) learns from it. */
  async complete(businessId: bigint, ticketId: bigint, actor: Actor, ctx: RequestContext) {
    const view = await this.onTicket(businessId, ticketId, actor, async (tx, session, entry) => {
      const now = new Date();
      const seconds = entry.servedAt
        ? Math.max(1, Math.round((now.getTime() - entry.servedAt.getTime()) / 1000))
        : null;
      await move(tx, entry, ['serving'], 'completed', { completedAt: now, actualServiceSeconds: seconds });
      await tx.queueSession.update({
        where: { id: session.id },
        data: {
          totalServed: { increment: 1 },
          ...(seconds !== null && {
            avgServiceSeconds: Math.max(
              30,
              Math.round(
                (session.avgServiceSeconds * session.totalServed + seconds) / (session.totalServed + 1),
              ),
            ),
          }),
        },
      });
      await this.publish(tx, TOPICS.QUEUE_ENTRY_COMPLETED, session, entry, ctx, { serviceSeconds: seconds });
    });
    await this.recordOutcomeSoon(businessId, ticketId);
    return view;
  }

  /** Called but didn't come within the grace period (default 5 minutes). */
  async noShow(businessId: bigint, ticketId: bigint, actor: Actor, ctx: RequestContext) {
    const view = await this.onTicket(businessId, ticketId, actor, async (tx, session, entry) => {
      if (entry.status === 'called' && entry.calledAt) {
        const allowedAt = entry.calledAt.getTime() + session.gracePeriodSeconds * 1000;
        if (Date.now() < allowedAt) {
          throw new AppError(
            `A no-show can be recorded ${Math.round(session.gracePeriodSeconds / 60)} minutes after calling`,
            ErrorCodes.INVALID_TRANSITION,
            409,
          );
        }
      }
      await move(tx, entry, ['called'], 'no_show', {});
      await this.publish(tx, TOPICS.QUEUE_ENTRY_NO_SHOW, session, entry, ctx);
    });
    await this.recordOutcomeSoon(businessId, ticketId);
    return view;
  }

  /** Priority lane (elderly, disabled, pregnant…): goes ahead of the regular line. */
  async setPriority(businessId: bigint, ticketId: bigint, actor: Actor, priority: boolean) {
    return this.onTicket(businessId, ticketId, actor, async (tx, _session, entry) => {
      if (entry.status !== 'waiting') throw invalid(entry.status, 'moved');
      await tx.queueTicket.updateMany({
        where: { id: entry.id, sessionDate: entry.sessionDate },
        data: { priorityLane: priority },
      });
    });
  }

  // ── Reliability ──────────────────────────────────────────────────────────

  /**
   * How a person's ticket ended — served, or a no-show — goes into their reliability on their own
   * shard (D-078), once. Runs after the front desk's change and again from its event (the repair,
   * should that step have been lost); walk-ins and other endings record nothing.
   */
  async recordOutcome(businessId: bigint, ticketId: bigint, sessionDate?: Date): Promise<void> {
    const t = await this.plane
      .inBusiness(businessId, (tx) =>
        tx.queueTicket.findFirst({
          where: { id: ticketId, businessId, ...(sessionDate && { sessionDate }) },
          select: { userId: true, status: true, joinedAt: true },
        }),
      )
      .catch(nullIfShardGone);
    if (!t?.userId || (t.status !== 'completed' && t.status !== 'no_show')) return;
    const db = await this.plane.user(t.userId).catch(nullIfShardGone);
    if (!db) return;
    await db.userVisitOutcome.createMany({
      data: [
        {
          userId: t.userId,
          refId: ticketId,
          businessId,
          happenedAt: t.joinedAt,
          kind: t.status === 'completed' ? 'visit' : 'no_show',
          source: 'queue',
        },
      ],
      skipDuplicates: true,
    });
  }

  /** Like `recordOutcome`, but never fails the front desk's request: the event repairs it. */
  private async recordOutcomeSoon(businessId: bigint, ticketId: bigint): Promise<void> {
    try {
      await this.recordOutcome(businessId, ticketId);
    } catch (err) {
      logger.warn({ err, ticketId: ticketId.toString() }, "couldn't record how a queue ticket ended yet");
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One transaction on the business's shard; live screens hear of it after the commit. */
  private async changing<T>(businessId: bigint, work: (tx: BusinessTx) => Promise<T>): Promise<T> {
    const result = await this.plane.inBusiness(businessId, work);
    this.onChange(businessId); // after the commit: screens never show a change that rolled back
    return result;
  }

  /** A front-desk change to today's session (which must exist). */
  private async atDesk<T>(
    businessId: bigint,
    actor: Actor,
    work: (tx: BusinessTx, today: SessionRow) => Promise<T>,
  ): Promise<T> {
    return this.changing(businessId, async (tx) => {
      const business = await this.operator(tx, businessId, actor);
      const today = await todaySession(tx, business);
      if (!today) throw closed();
      return work(tx, today);
    });
  }

  /** A front-desk change to one ticket of the business, with its session locked. */
  private async onTicket(
    businessId: bigint,
    ticketId: bigint,
    actor: Actor,
    work: (tx: BusinessTx, session: SessionRow, entry: TicketRow) => Promise<void>,
  ) {
    return this.changing(businessId, async (tx) => {
      await this.operator(tx, businessId, actor);
      const found = await tx.queueTicket.findFirst({
        where: { id: ticketId, businessId },
        select: { sessionId: true, sessionDate: true },
      });
      if (!found) throw ticketNotFound();
      return this.withSession(tx, found.sessionId, async (session) => {
        const entry = (await loadTicket(tx, ticketId, found.sessionDate))!;
        await work(tx, session, entry);
        return this.view(tx, ticketId, found.sessionDate);
      });
    });
  }

  /**
   * A change to one session, with its row locked (serializes ticket numbers and "who's next"),
   * then "N ahead of you" alerts for whoever moved closer.
   */
  private async withSession<T>(
    tx: BusinessTx,
    sessionId: bigint,
    work: (session: SessionRow) => Promise<T>,
  ): Promise<T> {
    await tx.$executeRaw`SELECT 1 FROM queue_sessions WHERE id = ${sessionId} FOR UPDATE`;
    const session = await tx.queueSession.findUniqueOrThrow({ where: { id: sessionId } });
    const result = await work(session);
    await this.alertPositions(tx, session);
    return result;
  }

  /** The customer's own leaving (or their account's closing), with the session locked. */
  private async leaveTicket(mine: ActiveTicket, reason: 'left' | 'account_closed', ctx: RequestContext) {
    return this.changing(mine.businessId, async (tx) => {
      const found = await loadTicket(tx, mine.ticketId, mine.ticketSessionDate);
      if (!found) throw ticketNotFound();
      return this.withSession(tx, found.sessionId, async (session) => {
        const entry = (await loadTicket(tx, mine.ticketId, mine.ticketSessionDate))!;
        await move(tx, entry, ['waiting', 'called'], 'left', { leftAt: new Date() });
        await this.publish(tx, TOPICS.QUEUE_ENTRY_LEFT, session, entry, ctx, { reason });
        return this.view(tx, entry.id, entry.sessionDate);
      });
    });
  }

  /**
   * One queue at a time, anywhere (DB-014): the person's own shard holds the ticket they're about
   * to get before the business's shard writes it. The row is their current or latest ticket; it
   * gives way only once that ticket no longer holds a place (finished, left, its queue closed or
   * from an earlier day), or never appeared within 2 minutes. Two joins at once: one wins.
   */
  private async claim(userId: bigint, hold: Omit<ActiveTicket, 'userId' | 'createdAt'>): Promise<void> {
    const db = await this.plane.user(userId);
    for (let tries = 0; tries < 3; tries++) {
      const current = await db.userActiveTicket.findUnique({ where: { userId } });
      if (current && (await this.stillHolds(current))) throw alreadyJoined();
      try {
        await db.$transaction(async (tx) => {
          if (current) {
            const { count } = await tx.userActiveTicket.deleteMany({
              where: { userId, ticketId: current.ticketId },
            });
            if (count === 0) throw RACED;
          }
          await tx.userActiveTicket.create({ data: { userId, ...hold } });
        });
        return;
      } catch (err) {
        // Someone else's join changed it meanwhile: look again.
        if (err === RACED || isUniqueViolation(err)) continue;
        throw err;
      }
    }
    throw alreadyJoined();
  }

  /** Does the ticket a person's row points at still hold their place? */
  private async stillHolds(row: ActiveTicket): Promise<boolean> {
    const t = await this.plane
      .inBusiness(row.businessId, (tx) => loadTicket(tx, row.ticketId, row.ticketSessionDate))
      .catch(nullIfShardGone);
    // Not there: still being written for a moment, or a join that never happened.
    if (!t) return Date.now() - row.createdAt.getTime() < CLAIM_MS;
    return holdsPlace(t);
  }

  /** A join that didn't happen gives its claim back — unless its ticket was written after all. */
  private async release(userId: bigint, ticketId: bigint, businessId: bigint, sessionDate: Date) {
    try {
      const written = await this.plane.inBusiness(businessId, (tx) => loadTicket(tx, ticketId, sessionDate));
      if (written) return;
      await (await this.plane.user(userId)).userActiveTicket.deleteMany({ where: { userId, ticketId } });
    } catch {
      // Without its ticket, the claim gives way to the next join after 2 minutes.
    }
  }

  private async activeTicketOf(userId: bigint): Promise<ActiveTicket | null> {
    return (await this.plane.user(userId)).userActiveTicket.findUnique({ where: { userId } });
  }

  /** The person's row, if it is this ticket; 404 otherwise. */
  private async mine(userId: bigint, ticketId: bigint): Promise<ActiveTicket> {
    const mine = await this.activeTicketOf(userId);
    if (mine?.ticketId !== ticketId) throw ticketNotFound();
    return mine;
  }

  /** Names of app customers in line, from their own shards. */
  private async namesOf(userIds: bigint[]): Promise<Map<bigint, string>> {
    const names = new Map<bigint, string>();
    for (const [db, ids] of await this.plane.usersByShard(userIds)) {
      for (const u of await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }))
        names.set(u.id, u.name);
    }
    return names;
  }

  private async addEntry(
    tx: BusinessTx,
    session: SessionRow,
    who: {
      id: bigint;
      userId?: bigint;
      walkInName?: string | null;
      joinedRemotely?: boolean;
      priorityLane?: boolean;
    },
    ctx: RequestContext,
  ) {
    const live = await tx.queueTicket.count({
      where: { sessionId: session.id, sessionDate: session.sessionDate, status: { in: [...LIVE] } },
    });
    if (live >= session.maxQueueSize)
      throw new AppError('The queue is full right now', ErrorCodes.QUEUE_FULL, 409);
    const ticketNumber = session.currentNumber + 1;
    const entry = await tx.queueTicket.create({
      data: {
        ...who,
        sessionId: session.id,
        sessionDate: session.sessionDate,
        businessId: session.businessId,
        ticketNumber,
        ticketPrefix: session.ticketPrefix,
      },
    });
    await tx.queueSession.update({ where: { id: session.id }, data: { currentNumber: ticketNumber } });
    await this.publish(tx, TOPICS.QUEUE_ENTRY_JOINED, session, entry, ctx, {
      remote: Boolean(who.joinedRemotely),
    });
  }

  private async callEntry(tx: BusinessTx, session: SessionRow, entry: TicketRow, ctx: RequestContext) {
    await move(tx, entry, ['waiting'], 'called', { calledAt: new Date() });
    await tx.queueSession.update({
      where: { id: session.id },
      // The ticket most recently called (what the display shows) — with a priority lane
      // this isn't always the highest number.
      data: { lastCalledNumber: entry.ticketNumber },
    });
    await this.publish(tx, TOPICS.QUEUE_ENTRY_CALLED, session, entry, ctx);
  }

  /** "N people ahead of you" for the first few in line (10, 5, then every step). */
  private async alertPositions(tx: BusinessTx, session: SessionRow) {
    const line = await tx.queueTicket.findMany({
      where: { sessionId: session.id, sessionDate: session.sessionDate, status: 'waiting' },
      orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
      take: 11,
    });
    for (const [ahead, e] of line.entries()) {
      if (!e.userId || !shouldAlert(ahead, e.lastAlertedAhead)) continue;
      await tx.queueTicket.updateMany({
        where: { id: e.id, sessionDate: e.sessionDate },
        data: { lastAlertedAhead: ahead },
      });
      await this.publish(tx, TOPICS.QUEUE_POSITION_UPDATED, session, e, NO_CONTEXT, { ahead });
    }
  }

  /** Events carry internal IDs (DB-042) and the ticket number — no names. */
  private publish(
    tx: BusinessTx,
    type: Topic,
    session: SessionRow,
    entry: { id: bigint; userId: bigint | null; ticketNumber: number; ticketPrefix: string },
    ctx: RequestContext,
    extra: Record<string, unknown> = {},
  ) {
    return enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({
        type,
        source: 'queue-service',
        subject: entry.id.toString(),
        data: {
          entryId: entry.id.toString(),
          sessionId: session.id.toString(),
          sessionDate: isoDate(session.sessionDate),
          businessId: session.businessId.toString(),
          userId: entry.userId?.toString() ?? null,
          ticket: ticketLabel(entry.ticketPrefix, entry.ticketNumber),
          ...extra,
        },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'queue_entry',
    );
  }

  private publishSession(tx: BusinessTx, type: Topic, session: SessionRow, ctx: RequestContext) {
    return enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({
        type,
        source: 'queue-service',
        subject: session.id.toString(),
        data: {
          sessionId: session.id.toString(),
          sessionDate: isoDate(session.sessionDate),
          businessId: session.businessId.toString(),
        },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'queue_session',
    );
  }

  private async setStatus(businessId: bigint, actor: Actor, from: string[], to: 'open' | 'paused') {
    await this.atDesk(businessId, actor, (tx, today) =>
      this.withSession(tx, today.id, async (fresh) => {
        if (!from.includes(fresh.status)) throw invalid(fresh.status, to);
        await tx.queueSession.update({ where: { id: fresh.id }, data: { status: to } });
      }),
    );
    return this.board(businessId, actor);
  }

  /** One ticket as its holder (and the front desk, after a change) sees it. */
  private async view(tx: BusinessTx, ticketId: bigint, sessionDate: Date) {
    const e = await tx.queueTicket.findFirstOrThrow({
      where: { id: ticketId, sessionDate },
      include: {
        session: { select: { avgServiceSeconds: true, gracePeriodSeconds: true } },
        business: { select: { publicId: true, name: true, slug: true } },
      },
    });
    let ahead: number | null = null;
    let estimatedWaitMinutes: number | null = null;
    if (e.status === 'waiting') {
      ahead = await tx.queueTicket.count({
        where: {
          sessionId: e.sessionId,
          sessionDate: e.sessionDate,
          status: 'waiting',
          OR: e.priorityLane
            ? [{ priorityLane: true, ticketNumber: { lt: e.ticketNumber } }]
            : [{ priorityLane: true }, { ticketNumber: { lt: e.ticketNumber } }],
        },
      });
      estimatedWaitMinutes = estimateWaitMinutes(
        ahead,
        e.session.avgServiceSeconds,
        await staffOnShift(tx, e.businessId),
      );
    }
    const ticket = ticketLabel(e.ticketPrefix, e.ticketNumber);
    return {
      id: e.id.toString(),
      ticket,
      /** Content of the QR the app shows (D-057): the ticket number only. */
      qr: ticket,
      status: e.status,
      business: { id: e.business.publicId, name: e.business.name, slug: e.business.slug },
      ahead,
      estimatedWaitMinutes,
      priority: e.priorityLane,
      walkInName: e.walkInName,
      joinedAt: e.joinedAt.toISOString(),
      calledAt: e.calledAt?.toISOString() ?? null,
      /** Come to the counter before this, or the ticket may be marked a no-show. */
      comeBy: e.calledAt
        ? new Date(e.calledAt.getTime() + e.session.gracePeriodSeconds * 1000).toISOString()
        : null,
      servedAt: e.servedAt?.toISOString() ?? null,
      completedAt: e.completedAt?.toISOString() ?? null,
      leftAt: e.leftAt?.toISOString() ?? null,
    };
  }

  /** The front desk: may operate the queue, and the business isn't suspended. */
  private async operator(tx: BusinessTx, businessId: bigint, actor: Actor) {
    await requireBusinessPermissionOnShard(tx, businessId, actor, 'queue.operate');
    const business = await businessRow(tx, businessId);
    if (business.status === 'suspended') {
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
    }
    return business;
  }
}

type ActiveTicket = {
  userId: bigint;
  ticketId: bigint;
  ticketSessionDate: Date;
  businessId: bigint;
  sessionId: bigint;
  createdAt: Date;
};

/** Thrown inside a claim when another join replaced the row first. */
const RACED = new Error('the active ticket changed meanwhile');

/** A ticket with what deciding "does it still hold a place?" needs. */
async function loadTicket(tx: BusinessTx, ticketId: bigint, sessionDate: Date) {
  return tx.queueTicket.findFirst({
    where: { id: ticketId, sessionDate },
    include: {
      session: { select: { status: true } },
      business: { select: { timezone: true } },
    },
  });
}

/** Live, in a queue that's still open or paused, today: it holds the person's place. */
function holdsPlace(t: NonNullable<Awaited<ReturnType<typeof loadTicket>>>, now = new Date()): boolean {
  return (
    (LIVE as readonly string[]).includes(t.status) &&
    t.session.status !== 'closed' &&
    isoDate(t.sessionDate) >= localDate(t.business.timezone, now)
  );
}

/** Change status only if it is still what we expect (concurrent changes lose cleanly). */
async function move(
  tx: BusinessTx,
  entry: { id: bigint; sessionDate: Date; status: string },
  from: TicketStatus[],
  to: TicketStatus,
  data: Record<string, unknown>,
) {
  const { count } = await tx.queueTicket.updateMany({
    where: { id: entry.id, sessionDate: entry.sessionDate, status: { in: from } },
    data: { status: to, ...data },
  });
  if (count === 0) throw invalid(entry.status, to);
}

/** A business the public can queue at, or 404. */
async function publicBusiness(tx: BusinessTx, businessId: bigint) {
  const business = await tx.business.findFirst({
    where: { id: businessId, deletedAt: null, status: { in: [...BOOKABLE] } },
    select: { id: true, publicId: true, timezone: true, status: true },
  });
  if (!business) throw businessNotFound();
  return business;
}

async function businessRow(tx: BusinessTx, businessId: bigint) {
  const business = await tx.business.findFirst({
    where: { id: businessId },
    select: { id: true, publicId: true, timezone: true, status: true },
  });
  if (!business) throw businessNotFound();
  return business;
}

/** Metres from the customer to the business (PostGIS), or null if the business has no location. */
async function distanceMeters(tx: BusinessTx, businessId: bigint, lat: number, lng: number) {
  const [row] = await tx.$queryRaw<{ meters: number | null }[]>`
    SELECT extensions.ST_Distance(
             location,
             extensions.ST_SetSRID(extensions.ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::extensions.geography
           ) AS meters
    FROM businesses WHERE id = ${businessId}`;
  return row?.meters ?? null;
}

/** Employees clocked in right now (D-077): wait estimates divide the line between them. */
const staffOnShift = (tx: BusinessTx, businessId: bigint) =>
  tx.staffOpenShift.count({ where: { businessId } });

async function todaySession(tx: BusinessTx, business: { id: bigint; timezone: string }) {
  return tx.queueSession.findUnique({
    where: {
      businessId_sessionDate: {
        businessId: business.id,
        sessionDate: dateOnly(localDate(business.timezone)),
      },
    },
  });
}

function assertOpenForJoining(session: { status: string } | null): void {
  if (!session || session.status === 'closed') throw closed();
  if (session.status === 'paused') {
    throw new AppError(
      'The queue is paused; please try again in a little while',
      ErrorCodes.QUEUE_PAUSED,
      409,
    );
  }
}

/** Today's date (YYYY-MM-DD) where the business is. */
function localDate(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const dateOnly = (date: string) => new Date(`${date}T00:00:00Z`);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);

function nullIfShardGone(err: unknown): null {
  if (err instanceof ShardNotFoundError) return null;
  throw err;
}

const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`);
const closed = () => new AppError('The queue is closed', ErrorCodes.QUEUE_CLOSED, 409);
const businessNotFound = () => AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
const ticketNotFound = () => AppError.notFound('Ticket', ErrorCodes.QUEUE_ENTRY_NOT_FOUND);
const alreadyJoined = () =>
  new AppError(
    'You are already in a queue; leave it first to join another',
    ErrorCodes.QUEUE_ALREADY_JOINED,
    409,
  );
const invalid = (from: string, to: string) =>
  new AppError(`A ticket that is ${from} can’t be ${to}`, ErrorCodes.INVALID_TRANSITION, 409);
