import { AppError, ErrorCodes, type Role } from '@buku/common';
import {
  constraintNameOf,
  isUniqueViolation,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { createEvent, enqueueEvent, TOPICS, type Topic } from '@buku/kafka';
import { estimateWaitMinutes, shouldAlert, ticketLabel } from './alerts.js';
import type { RequestContext } from './http/context.js';
import type { QueueSettingsService } from './settings.js';

/**
 * The virtual queue (2.4). One session per business per day, opened by the
 * front desk. Customers join from their phone — only within the business's
 * distance (D-038) and holding at most ONE live ticket anywhere (database
 * rule) — or are added at the counter as walk-ins. Each gets a ticket like
 * "A-023" (D-057).
 *
 *   waiting ──call──▶ called ──serve──▶ serving ──complete──▶ completed
 *      │ leave           │ leave / no-show (after the grace period)
 *      ▼                 ▼
 *     left           left / no_show
 *
 * Every change to a session runs with that session locked, so ticket numbers
 * and "who's next" are never handed out twice. Changes are published as
 * events (outbox), including the "N people ahead of you" alerts.
 */

const LIVE = ['waiting', 'called', 'serving'] as const;
type EntryStatus = 'waiting' | 'called' | 'serving' | 'completed' | 'left' | 'no_show';
type SessionRow = Awaited<ReturnType<Database['queueSession']['findUniqueOrThrow']>>;

const BOOKABLE = ['pending', 'verified'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const entryInclude = {
  session: {
    select: {
      id: true,
      businessId: true,
      ticketPrefix: true,
      gracePeriodSeconds: true,
      avgServiceSeconds: true,
    },
  },
  user: { select: { name: true } },
} as const;

export class QueueService {
  constructor(
    private readonly db: Database,
    private readonly settings: QueueSettingsService,
  ) {}

  // ── Public: is there a queue, and how long is it? ────────────────────────

  async publicState(idOrSlug: string) {
    const business = await this.findBusiness(idOrSlug);
    const settings = await this.settings.effective(business.id);
    const session = await this.todaySession(business);
    if (!session) {
      return {
        businessId: business.id,
        status: 'closed' as const,
        remoteJoinRadiusMeters: settings.remoteJoinRadiusMeters,
      };
    }
    const [entries, onShift] = await Promise.all([
      this.db.queueEntry.findMany({
        where: { sessionId: session.id, status: { in: [...LIVE] } },
        select: { ticketNumber: true, ticketPrefix: true, status: true, priorityLane: true },
        orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
      }),
      this.staffOnShift(business.id),
    ]);
    const waiting = entries.filter((e) => e.status === 'waiting');
    return {
      businessId: business.id,
      status: session.status,
      remoteJoinRadiusMeters: settings.remoteJoinRadiusMeters,
      waiting: waiting.length,
      /** Ticket numbers only — never names. */
      called: entries
        .filter((e) => e.status === 'called')
        .map((e) => ticketLabel(e.ticketPrefix, e.ticketNumber)),
      serving: entries
        .filter((e) => e.status === 'serving')
        .map((e) => ticketLabel(e.ticketPrefix, e.ticketNumber)),
      /** For someone joining now. */
      estimatedWaitMinutes: estimateWaitMinutes(waiting.length, session.avgServiceSeconds, onShift),
    };
  }

  // ── Customers ────────────────────────────────────────────────────────────

  async join(
    userId: string,
    role: Role,
    input: { businessId: string; lat: number; lng: number },
    ctx: RequestContext,
  ) {
    if (role === 'staff') {
      throw new AppError('Employee accounts can’t join queues', ErrorCodes.BOOKING_NOT_ALLOWED, 403);
    }
    const business = await this.findBusiness(input.businessId);
    const session = await this.todaySession(business);
    this.assertOpenForJoining(session);
    const settings = await this.settings.effective(business.id);
    const distance = await this.distanceMeters(business.id, input.lat, input.lng);
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
    try {
      const id = await this.change(session!.id, async (tx, fresh) => {
        this.assertOpenForJoining(fresh);
        return this.addEntry(tx, fresh, { userId, joinedRemotely: true }, ctx);
      });
      return this.ticketView(id);
    } catch (err) {
      if (isUniqueViolation(err) && constraintNameOf(err) === 'queue_entries_one_active_per_user') {
        throw new AppError(
          'You are already in a queue; leave it first to join another',
          ErrorCodes.QUEUE_ALREADY_JOINED,
          409,
        );
      }
      throw err;
    }
  }

  /** My live ticket, wherever it is (at most one, D-038), or null. */
  async myTicket(userId: string) {
    const entry = await this.db.queueEntry.findFirst({
      where: { userId, status: { in: [...LIVE] } },
      select: { id: true },
    });
    return entry ? this.ticketView(entry.id) : null;
  }

  async ticket(userId: string, entryId: string) {
    const entry = await this.db.queueEntry.findFirst({
      where: { id: entryId, userId },
      select: { id: true },
    });
    if (!entry) throw AppError.notFound('Ticket', ErrorCodes.QUEUE_ENTRY_NOT_FOUND);
    return this.ticketView(entry.id);
  }

  async leave(userId: string, entryId: string, ctx: RequestContext) {
    const entry = await this.db.queueEntry.findFirst({
      where: { id: entryId, userId },
      include: entryInclude,
    });
    if (!entry) throw AppError.notFound('Ticket', ErrorCodes.QUEUE_ENTRY_NOT_FOUND);
    await this.change(entry.session.id, async (tx, session) => {
      await this.move(tx, entry, ['waiting', 'called'], 'left', { leftAt: new Date() });
      await this.publish(tx, TOPICS.QUEUE_ENTRY_LEFT, session, entry, ctx, { reason: 'left' });
    });
    return this.ticketView(entry.id);
  }

  // ── The front desk ───────────────────────────────────────────────────────

  /** Today's queue as the front desk sees it: who's waiting (in order), called and being served. */
  async board(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const business = await this.businessById(businessId);
    const session = await this.todaySession(business);
    const onShift = await this.staffOnShift(businessId);
    if (!session) return { session: null, staffOnShift: onShift, waiting: [], called: [], serving: [] };
    const entries = await this.db.queueEntry.findMany({
      where: { sessionId: session.id, status: { in: [...LIVE] } },
      include: { user: { select: { name: true } } },
      orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
    });
    const view = (e: (typeof entries)[number]) => ({
      id: e.id,
      ticket: ticketLabel(e.ticketPrefix, e.ticketNumber),
      status: e.status,
      /** The customer's name, or the walk-in's — never contact details or pictures. */
      name: e.user?.name ?? e.walkInName,
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
        id: session.id,
        date: session.sessionDate.toISOString().slice(0, 10),
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
  async open(businessId: string, actorId: string, ctx: RequestContext) {
    await this.operator(businessId, actorId);
    const business = await this.businessById(businessId);
    const settings = await this.settings.effective(businessId);
    const sessionDate = new Date(`${localDate(business.timezone)}T00:00:00Z`);
    const existing = await this.db.queueSession.findUnique({
      where: { businessId_sessionDate: { businessId, sessionDate } },
    });
    if (existing?.status !== 'open') {
      await this.db.$transaction(async (tx) => {
        const session = existing
          ? await tx.queueSession.update({
              where: { id: existing.id },
              data: { status: 'open', closedAt: null, openedAt: existing.openedAt ?? new Date() },
            })
          : await tx.queueSession.create({
              data: {
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
    }
    return this.board(businessId, actorId);
  }

  /** No new remote joins; the front desk keeps calling and can still add walk-ins. */
  async pause(businessId: string, actorId: string) {
    return this.setStatus(businessId, actorId, ['open'], 'paused');
  }

  async resume(businessId: string, actorId: string) {
    return this.setStatus(businessId, actorId, ['paused'], 'open');
  }

  /** Close for the day: whoever is still waiting or called is told the queue closed. */
  async close(businessId: string, actorId: string, ctx: RequestContext) {
    await this.operator(businessId, actorId);
    const session = await this.requireSession(businessId);
    await this.change(session.id, async (tx, fresh) => {
      if (fresh.status === 'closed') return;
      const remaining = await tx.queueEntry.findMany({
        where: { sessionId: fresh.id, status: { in: ['waiting', 'called'] } },
        include: entryInclude,
      });
      await tx.queueEntry.updateMany({
        where: { id: { in: remaining.map((e) => e.id) } },
        data: { status: 'left', leftAt: new Date() },
      });
      for (const e of remaining)
        await this.publish(tx, TOPICS.QUEUE_ENTRY_LEFT, fresh, e, ctx, { reason: 'queue_closed' });
      await tx.queueSession.update({
        where: { id: fresh.id },
        data: { status: 'closed', closedAt: new Date() },
      });
      await this.publishSession(tx, TOPICS.QUEUE_SESSION_CLOSED, fresh, ctx);
    });
    return this.board(businessId, actorId);
  }

  /** Someone at the counter (with or without the app). Allowed while paused too. */
  async walkIn(
    businessId: string,
    actorId: string,
    input: { name?: string | undefined; priority?: boolean | undefined },
    ctx: RequestContext,
  ) {
    await this.operator(businessId, actorId);
    const session = await this.requireSession(businessId);
    const id = await this.change(session.id, async (tx, fresh) => {
      if (fresh.status === 'closed') throw closed();
      return this.addEntry(
        tx,
        fresh,
        { walkInName: input.name ?? null, priorityLane: input.priority ?? false },
        ctx,
      );
    });
    return this.ticketView(id);
  }

  /** Call whoever is next (priority lane first, then by ticket number). */
  async callNext(businessId: string, actorId: string, ctx: RequestContext) {
    await this.operator(businessId, actorId);
    const session = await this.requireSession(businessId);
    const id = await this.change(session.id, async (tx, fresh) => {
      if (fresh.status === 'closed') throw closed();
      const next = await tx.queueEntry.findFirst({
        where: { sessionId: fresh.id, status: 'waiting' },
        orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
        include: entryInclude,
      });
      if (!next) throw AppError.conflict('Nobody is waiting');
      await this.callEntry(tx, fresh, next, ctx);
      return next.id;
    });
    return this.ticketView(id);
  }

  async call(businessId: string, entryId: string, actorId: string, ctx: RequestContext) {
    const entry = await this.operatorEntry(businessId, entryId, actorId);
    await this.change(entry.session.id, async (tx, fresh) => {
      if (entry.status !== 'waiting') throw invalid(entry.status, 'called');
      await this.callEntry(tx, fresh, entry, ctx);
    });
    return this.ticketView(entryId);
  }

  async serve(businessId: string, entryId: string, actorId: string, ctx: RequestContext) {
    const entry = await this.operatorEntry(businessId, entryId, actorId);
    await this.change(entry.session.id, async (tx, fresh) => {
      await this.move(tx, entry, ['waiting', 'called'], 'serving', { servedAt: new Date() });
      await this.publish(tx, TOPICS.QUEUE_ENTRY_SERVED, fresh, entry, ctx);
    });
    return this.ticketView(entryId);
  }

  /** Done. The day's average service time (used for wait estimates) learns from it. */
  async complete(businessId: string, entryId: string, actorId: string, ctx: RequestContext) {
    const entry = await this.operatorEntry(businessId, entryId, actorId);
    await this.change(entry.session.id, async (tx, fresh) => {
      const now = new Date();
      const seconds = entry.servedAt
        ? Math.max(1, Math.round((now.getTime() - entry.servedAt.getTime()) / 1000))
        : null;
      await this.move(tx, entry, ['serving'], 'completed', {
        completedAt: now,
        actualServiceSeconds: seconds,
      });
      await tx.queueSession.update({
        where: { id: fresh.id },
        data: {
          totalServed: { increment: 1 },
          ...(seconds !== null && {
            avgServiceSeconds: Math.max(
              30,
              Math.round((fresh.avgServiceSeconds * fresh.totalServed + seconds) / (fresh.totalServed + 1)),
            ),
          }),
        },
      });
      await this.publish(tx, TOPICS.QUEUE_ENTRY_COMPLETED, fresh, entry, ctx, { serviceSeconds: seconds });
    });
    return this.ticketView(entryId);
  }

  /** Called but didn't come within the grace period (default 5 minutes). */
  async noShow(businessId: string, entryId: string, actorId: string, ctx: RequestContext) {
    const entry = await this.operatorEntry(businessId, entryId, actorId);
    await this.change(entry.session.id, async (tx, fresh) => {
      if (entry.status === 'called' && entry.calledAt) {
        const allowedAt = entry.calledAt.getTime() + fresh.gracePeriodSeconds * 1000;
        if (Date.now() < allowedAt) {
          throw new AppError(
            `A no-show can be recorded ${Math.round(fresh.gracePeriodSeconds / 60)} minutes after calling`,
            ErrorCodes.INVALID_TRANSITION,
            409,
          );
        }
      }
      await this.move(tx, entry, ['called'], 'no_show', {});
      await this.publish(tx, TOPICS.QUEUE_ENTRY_NO_SHOW, fresh, entry, ctx);
    });
    return this.ticketView(entryId);
  }

  /** Priority lane (elderly, disabled, pregnant…): goes ahead of the regular line. */
  async setPriority(businessId: string, entryId: string, actorId: string, priority: boolean) {
    const entry = await this.operatorEntry(businessId, entryId, actorId);
    await this.change(entry.session.id, async (tx) => {
      if (entry.status !== 'waiting') throw invalid(entry.status, 'moved');
      await tx.queueEntry.update({ where: { id: entry.id }, data: { priorityLane: priority } });
    });
    return this.ticketView(entryId);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /**
   * Run a change with the session row locked (serializes ticket numbers and
   * "who's next"), then send "N ahead of you" alerts for whoever moved closer.
   */
  private async change<T>(
    sessionId: string,
    fn: (tx: Transaction, session: SessionRow) => Promise<T>,
  ): Promise<T> {
    return this.db.$transaction(async (tx) => {
      const session = await this.lock(tx, sessionId);
      const result = await fn(tx, session);
      await this.alertPositions(tx, session);
      return result;
    });
  }

  private async lock(tx: Transaction, sessionId: string): Promise<SessionRow> {
    await tx.$executeRaw`SELECT 1 FROM queue_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
    return tx.queueSession.findUniqueOrThrow({ where: { id: sessionId } });
  }

  private async addEntry(
    tx: Transaction,
    session: SessionRow,
    who: { userId?: string; walkInName?: string | null; joinedRemotely?: boolean; priorityLane?: boolean },
    ctx: RequestContext,
  ) {
    const live = await tx.queueEntry.count({ where: { sessionId: session.id, status: { in: [...LIVE] } } });
    if (live >= session.maxQueueSize)
      throw new AppError('The queue is full right now', ErrorCodes.QUEUE_FULL, 409);
    const ticketNumber = session.currentNumber + 1;
    const entry = await tx.queueEntry.create({
      data: { sessionId: session.id, ticketNumber, ticketPrefix: session.ticketPrefix, ...who },
      include: entryInclude,
    });
    await tx.queueSession.update({ where: { id: session.id }, data: { currentNumber: ticketNumber } });
    await this.publish(tx, TOPICS.QUEUE_ENTRY_JOINED, session, entry, ctx, {
      remote: Boolean(who.joinedRemotely),
    });
    return entry.id;
  }

  private async callEntry(
    tx: Transaction,
    session: SessionRow,
    entry: { id: string; status: string; ticketNumber: number; userId: string | null; ticketPrefix: string },
    ctx: RequestContext,
  ) {
    await this.move(tx, entry, ['waiting'], 'called', { calledAt: new Date() });
    await tx.queueSession.update({
      where: { id: session.id },
      // The ticket most recently called (what the display shows) — with a priority lane
      // this isn't always the highest number.
      data: { lastCalledNumber: entry.ticketNumber },
    });
    await this.publish(tx, TOPICS.QUEUE_ENTRY_CALLED, session, entry, ctx);
  }

  /** Change status only if it is still what we expect (concurrent changes lose cleanly). */
  private async move(
    tx: Transaction,
    entry: { id: string; status: string },
    from: EntryStatus[],
    to: EntryStatus,
    data: Record<string, unknown>,
  ) {
    const { count } = await tx.queueEntry.updateMany({
      where: { id: entry.id, status: { in: from } },
      data: { status: to, ...data },
    });
    if (count === 0) throw invalid(entry.status, to);
  }

  /** "N people ahead of you" for the first few in line (10, 5, then every step). */
  private async alertPositions(tx: Transaction, session: SessionRow) {
    const line = await tx.queueEntry.findMany({
      where: { sessionId: session.id, status: 'waiting' },
      orderBy: [{ priorityLane: 'desc' }, { ticketNumber: 'asc' }],
      take: 11,
      include: entryInclude,
    });
    for (const [ahead, e] of line.entries()) {
      if (!e.userId || !shouldAlert(ahead, e.lastAlertedAhead)) continue;
      await tx.queueEntry.update({ where: { id: e.id }, data: { lastAlertedAhead: ahead } });
      await this.publish(tx, TOPICS.QUEUE_POSITION_UPDATED, session, e, {} as RequestContext, { ahead });
    }
  }

  /** Events carry ids and the ticket number — no names. */
  private publish(
    tx: Transaction,
    type: Topic,
    session: { id: string; businessId: string },
    entry: { id: string; userId: string | null; ticketNumber: number; ticketPrefix: string },
    ctx: RequestContext,
    extra: Record<string, unknown> = {},
  ) {
    return enqueueEvent(
      tx,
      createEvent({
        type,
        source: 'queue-service',
        subject: entry.id,
        data: {
          entryId: entry.id,
          sessionId: session.id,
          businessId: session.businessId,
          userId: entry.userId,
          ticket: ticketLabel(entry.ticketPrefix, entry.ticketNumber),
          ...extra,
        },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'queue_entry',
    );
  }

  private publishSession(
    tx: Transaction,
    type: Topic,
    session: { id: string; businessId: string },
    ctx: RequestContext,
  ) {
    return enqueueEvent(
      tx,
      createEvent({
        type,
        source: 'queue-service',
        subject: session.id,
        data: { sessionId: session.id, businessId: session.businessId },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'queue_session',
    );
  }

  private async setStatus(businessId: string, actorId: string, from: string[], to: 'open' | 'paused') {
    await this.operator(businessId, actorId);
    const session = await this.requireSession(businessId);
    await this.change(session.id, async (tx, fresh) => {
      if (!from.includes(fresh.status)) throw invalid(fresh.status, to);
      await tx.queueSession.update({ where: { id: fresh.id }, data: { status: to } });
    });
    return this.board(businessId, actorId);
  }

  async ticketView(entryId: string) {
    const e = await this.db.queueEntry.findUniqueOrThrow({
      where: { id: entryId },
      include: { session: { include: { business: { select: { id: true, name: true, slug: true } } } } },
    });
    let ahead: number | null = null;
    let estimatedWaitMinutes: number | null = null;
    if (e.status === 'waiting') {
      ahead = await this.db.queueEntry.count({
        where: {
          sessionId: e.sessionId,
          status: 'waiting',
          OR: e.priorityLane
            ? [{ priorityLane: true, ticketNumber: { lt: e.ticketNumber } }]
            : [{ priorityLane: true }, { ticketNumber: { lt: e.ticketNumber } }],
        },
      });
      estimatedWaitMinutes = estimateWaitMinutes(
        ahead,
        e.session.avgServiceSeconds,
        await this.staffOnShift(e.session.businessId),
      );
    }
    const ticket = ticketLabel(e.ticketPrefix, e.ticketNumber);
    return {
      id: e.id,
      ticket,
      /** Content of the QR the app shows (D-057): the ticket number only. */
      qr: ticket,
      status: e.status,
      business: e.session.business,
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

  private assertOpenForJoining(session: { status: string } | null): void {
    if (!session || session.status === 'closed') throw closed();
    if (session.status === 'paused') {
      throw new AppError(
        'The queue is paused; please try again in a little while',
        ErrorCodes.QUEUE_PAUSED,
        409,
      );
    }
  }

  /** Metres from the customer to the business (PostGIS), or null if the business has no location. */
  private async distanceMeters(businessId: string, lat: number, lng: number): Promise<number | null> {
    const [row] = await this.db.$queryRaw<{ meters: number | null }[]>`
      SELECT extensions.ST_Distance(
               location,
               extensions.ST_SetSRID(extensions.ST_MakePoint(${lng}::float8, ${lat}::float8), 4326)::extensions.geography
             ) AS meters
      FROM businesses WHERE id = ${businessId}::uuid`;
    return row?.meters ?? null;
  }

  private async staffOnShift(businessId: string): Promise<number> {
    return this.db.staffAttendance.count({ where: { businessId, checkOutAt: null } });
  }

  private async todaySession(business: { id: string; timezone: string }) {
    const sessionDate = new Date(`${localDate(business.timezone)}T00:00:00Z`);
    return this.db.queueSession.findUnique({
      where: { businessId_sessionDate: { businessId: business.id, sessionDate } },
    });
  }

  private async requireSession(businessId: string) {
    const session = await this.todaySession(await this.businessById(businessId));
    if (!session) throw closed();
    return session;
  }

  private async operator(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'queue.operate');
    const b = await this.db.business.findFirst({ where: { id: businessId }, select: { status: true } });
    if (b?.status === 'suspended') {
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
    }
  }

  private async operatorEntry(businessId: string, entryId: string, actorId: string) {
    await this.operator(businessId, actorId);
    const entry = await this.db.queueEntry.findFirst({
      where: { id: entryId, session: { businessId } },
      include: entryInclude,
    });
    if (!entry) throw AppError.notFound('Ticket', ErrorCodes.QUEUE_ENTRY_NOT_FOUND);
    return entry;
  }

  private async findBusiness(idOrSlug: string) {
    const business = await this.db.business.findFirst({
      where: {
        ...(UUID.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }),
        deletedAt: null,
        status: { in: [...BOOKABLE] },
      },
      select: { id: true, timezone: true },
    });
    if (!business) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return business;
  }

  private async businessById(businessId: string) {
    return this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, timezone: true },
    });
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

const formatDistance = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km` : `${m} m`);
const closed = () => new AppError('The queue is closed', ErrorCodes.QUEUE_CLOSED, 409);
const invalid = (from: string, to: string) =>
  new AppError(`A ticket that is ${from} can’t be ${to}`, ErrorCodes.INVALID_TRANSITION, 409);
