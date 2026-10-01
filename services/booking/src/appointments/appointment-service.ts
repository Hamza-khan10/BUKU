import {
  AppError,
  can,
  CONFIRMATION_CODE_PATTERN,
  ErrorCodes,
  generateConfirmationCode,
  type Role,
} from '@buku/common';
import {
  businessRoleOf,
  constraintNameOf,
  isExclusionViolation,
  isUniqueViolation,
  requireBusinessPermission,
  type Database,
  type Prisma,
  type Transaction,
} from '@buku/database';
import { createEvent, enqueueEvent, TOPICS, type Topic } from '@buku/kafka';
import {
  assertBookingAllowedForRole,
  type AvailabilityService,
} from '../availability/availability-service.js';
import { addDays, startOfDay, wallClock } from '../availability/time.js';
import { findBookableBusiness } from '../businesses.js';
import type { RequestContext } from '../http/context.js';
import type { SettingsService } from '../settings/settings-service.js';
import { appointmentInclude, businessView, receiptView, type AppointmentRow } from './views.js';

/**
 * Appointments: booking, the customer's receipts, the business's list, and
 * every status change.
 *
 *   pending ──confirm──▶ confirmed          (manual approval; automatic mode books as confirmed)
 *      │ decline / cancel   │ cancel
 *      ▼                    ▼
 *   cancelled            cancelled           (reschedule: old → rescheduled, new one created)
 *
 * The database has the last word on conflicts: an employee can't be in two
 * appointments (including clean-up time) and a customer can't hold two
 * overlapping appointments anywhere (D-036). Each status change is recorded
 * in the status history and published as an event (outbox) for notifications.
 */

const LIVE = ['pending', 'confirmed'] as const;
const REBOOK_REMINDER_DAYS = 3;

export type CancelReasonCode =
  | 'schedule_conflict'
  | 'found_alternative'
  | 'too_expensive'
  | 'not_needed'
  | 'illness'
  | 'business_unavailable'
  | 'other';

export interface BookInput {
  businessId: string;
  serviceId: string;
  /** Absent → "anyone": the least-booked free employee that day. */
  staffId?: string | undefined;
  startAt: string;
  notes?: string | undefined;
}

export interface BusinessListQuery {
  date?: string | undefined;
  staffId?: string | undefined;
  status?: (typeof LIVE)[number] | 'cancelled' | 'completed' | 'no_show' | 'rescheduled' | undefined;
  /** A booking code (any date) or part of the customer's name. */
  q?: string | undefined;
}

type Actor = { type: 'user' | 'business'; id: string };

export class AppointmentService {
  constructor(
    private readonly db: Database,
    private readonly availability: AvailabilityService,
    private readonly settings: SettingsService,
  ) {}

  // ── Booking ──────────────────────────────────────────────────────────────

  async book(userId: string, role: Role, input: BookInput, ctx: RequestContext) {
    assertBookingAllowedForRole(role);
    const business = await findBookableBusiness(this.db, input.businessId);
    const service = await this.availability.activeService(business.id, input.serviceId);
    const settings = await this.settings.effective(business.id);
    const startAt = new Date(input.startAt);
    this.assertBookableTime(startAt, settings);

    const date = wallClock(startAt, business.timezone).date;
    const slot = (await this.availability.slotsOn(business, service, date, { staffId: input.staffId })).find(
      (s) => s.startAt.getTime() === startAt.getTime(),
    );
    if (!slot) throw slotTaken();
    const candidates = input.staffId
      ? [input.staffId]
      : await this.leastBookedFirst(slot.staffIds, business, date);

    const id = await this.firstFree(candidates, (staffId) =>
      this.db.$transaction(async (tx) => {
        await this.lockCustomerAtBusiness(tx, userId, business.id);
        const upcoming = await tx.appointment.count({
          where: { userId, businessId: business.id, status: { in: [...LIVE] }, startAt: { gt: new Date() } },
        });
        if (upcoming >= settings.maxFutureBookingsPerCustomer) {
          throw new AppError(
            `You can have at most ${settings.maxFutureBookingsPerCustomer} upcoming bookings at this business`,
            ErrorCodes.LIMIT_REACHED,
            409,
          );
        }
        const status = settings.confirmationMode === 'automatic' ? 'confirmed' : 'pending';
        const created = await this.insert(tx, {
          businessId: business.id,
          serviceId: service.id,
          staffId,
          userId,
          status,
          startAt,
          endAt: slot.endAt,
          blockedUntil: new Date(
            startAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000,
          ),
          notes: input.notes ?? null,
          price: service.price,
          currency: service.currency,
        });
        await this.history(tx, created.id, null, status, { type: 'user', id: userId });
        await this.publish(tx, TOPICS.BOOKINGS_CREATED, created, ctx);
        if (status === 'confirmed') await this.publish(tx, TOPICS.BOOKINGS_CONFIRMED, created, ctx);
        return created.id;
      }),
    );
    return this.receipt(id);
  }

  // ── The customer's side ──────────────────────────────────────────────────

  async myAppointments(userId: string, scope: 'upcoming' | 'past', page: number, limit: number) {
    const now = new Date();
    const where =
      scope === 'upcoming'
        ? { userId, status: { in: [...LIVE] }, startAt: { gte: now } }
        : { userId, OR: [{ status: { notIn: [...LIVE] } }, { startAt: { lt: now } }] };
    const [rows, total] = await Promise.all([
      this.db.appointment.findMany({
        where,
        include: appointmentInclude,
        orderBy: { startAt: scope === 'upcoming' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.db.appointment.count({ where }),
    ]);
    const items = await Promise.all(rows.map((a) => this.toReceipt(a)));
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** A receipt — only for the customer it belongs to (404 for anyone else). */
  async myAppointment(userId: string, appointmentId: string) {
    const a = await this.db.appointment.findFirst({
      where: { id: appointmentId, userId },
      include: appointmentInclude,
    });
    if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    return this.toReceipt(a);
  }

  async cancelMine(
    userId: string,
    appointmentId: string,
    input: { reasonCode: CancelReasonCode; note?: string | undefined; bookLater?: boolean | undefined },
    ctx: RequestContext,
  ) {
    const a = await this.ownLive(userId, appointmentId);
    const settings = await this.settings.effective(a.businessId);
    const now = new Date();
    const late = now.getTime() > a.startAt.getTime() - settings.cancellationWindowHours * 3_600_000;
    await this.db.$transaction(async (tx) => {
      await this.transition(tx, a, 'cancelled', { type: 'user', id: userId }, input.note, {
        cancelledAt: now,
        cancelledBy: 'user',
        cancelReasonCode: input.reasonCode,
        cancelReason: input.note ?? null,
        lateCancellation: late,
        rebookReminderAt: input.bookLater
          ? new Date(now.getTime() + REBOOK_REMINDER_DAYS * 86_400_000)
          : null,
      });
      await this.publish(tx, TOPICS.BOOKINGS_CANCELLED, a, ctx, {
        cancelledBy: 'user',
        late,
        reasonCode: input.reasonCode,
        bookLater: Boolean(input.bookLater),
      });
    });
    return this.receipt(a.id);
  }

  /** Move my appointment (same service) — only before the cancellation window starts. */
  async rescheduleMine(
    userId: string,
    appointmentId: string,
    input: { startAt: string; staffId?: string | undefined },
    ctx: RequestContext,
  ) {
    const old = await this.ownLive(userId, appointmentId);
    const settings = await this.settings.effective(old.businessId);
    if (Date.now() > old.startAt.getTime() - settings.cancellationWindowHours * 3_600_000) {
      throw new AppError(
        `Appointments can be moved until ${settings.cancellationWindowHours} hours before; please contact the business`,
        ErrorCodes.CANCELLATION_WINDOW_PASSED,
        409,
      );
    }
    const business = { id: old.businessId, timezone: old.business.timezone };
    const service = await this.availability.activeService(old.businessId, old.serviceId);
    const startAt = new Date(input.startAt);
    this.assertBookableTime(startAt, settings);
    const date = wallClock(startAt, business.timezone).date;
    const slot = (
      await this.availability.slotsOn(business, service, date, {
        staffId: input.staffId,
        excludeAppointmentId: old.id,
      })
    ).find((s) => s.startAt.getTime() === startAt.getTime());
    if (!slot) throw slotTaken();
    // Keep the same person when they're free; otherwise the least booked.
    const candidates = input.staffId
      ? [input.staffId]
      : old.staffId && slot.staffIds.includes(old.staffId)
        ? [old.staffId]
        : await this.leastBookedFirst(slot.staffIds, business, date);

    const id = await this.firstFree(candidates, (staffId) =>
      this.db.$transaction(async (tx) => {
        const actor: Actor = { type: 'user', id: userId };
        await this.transition(tx, old, 'rescheduled', actor, 'rescheduled by the customer');
        const status = settings.confirmationMode === 'automatic' ? 'confirmed' : 'pending';
        const created = await this.insert(tx, {
          businessId: old.businessId,
          serviceId: old.serviceId,
          staffId,
          userId,
          status,
          startAt,
          endAt: slot.endAt,
          blockedUntil: new Date(
            startAt.getTime() + (service.durationMinutes + service.bufferMinutes) * 60_000,
          ),
          notes: old.notes,
          price: old.price,
          currency: old.currency,
          rescheduledFromId: old.id,
        });
        await this.history(tx, created.id, null, status, actor);
        await this.publish(tx, TOPICS.BOOKINGS_RESCHEDULED, created, ctx, { previousAppointmentId: old.id });
        return created.id;
      }),
    );
    return this.receipt(id);
  }

  // ── The business's side ──────────────────────────────────────────────────

  /**
   * The day's appointments (default: today), or a search by booking code or
   * customer name — so a customer without a phone is found just the same.
   * Staff see only their own appointments; front desk, managers and owners all.
   */
  async businessList(businessId: string, actorId: string, query: BusinessListQuery) {
    const role = await businessRoleOf(this.db, businessId, actorId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });

    let staffFilter: string[] | undefined;
    if (!can(role, 'appointments.manage_all')) {
      const mine = await this.db.staff.findMany({
        where: { businessId, userId: actorId },
        select: { id: true },
      });
      staffFilter = mine.map((s) => s.id);
    }

    const q = query.q?.trim();
    const code = q && CONFIRMATION_CODE_PATTERN.test(q.toUpperCase()) ? q.toUpperCase() : undefined;
    const date = query.date ?? wallClock(new Date(), business.timezone).date;
    const when = code
      ? {}
      : q
        ? // Name search: from a month back to a year ahead.
          {
            startAt: {
              gte: new Date(Date.now() - 30 * 86_400_000),
              lt: new Date(Date.now() + 366 * 86_400_000),
            },
          }
        : {
            startAt: {
              gte: startOfDay(date, business.timezone),
              lt: startOfDay(addDays(date, 1), business.timezone),
            },
          };

    const rows = await this.db.appointment.findMany({
      where: {
        businessId,
        ...when,
        ...(code && { confirmationCode: code }),
        ...(q && !code && { user: { name: { contains: q, mode: 'insensitive' } } }),
        ...(query.status && { status: query.status }),
        ...(query.staffId && { staffId: query.staffId }),
        ...(staffFilter && { staffId: { in: staffFilter } }),
      },
      include: appointmentInclude,
      orderBy: { startAt: 'asc' },
      take: 200,
    });
    return { date: code || q ? null : date, timezone: business.timezone, items: rows.map(businessView) };
  }

  async businessAppointment(businessId: string, appointmentId: string, actorId: string) {
    const role = await businessRoleOf(this.db, businessId, actorId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const a = await this.db.appointment.findFirst({
      where: { id: appointmentId, businessId },
      include: appointmentInclude,
    });
    if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    // Staff see only their own appointments.
    if (!can(role, 'appointments.manage_all')) {
      const mine = a.staffId ? await this.db.staff.count({ where: { id: a.staffId, userId: actorId } }) : 0;
      if (mine === 0) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    }
    return businessView(a);
  }

  /** Manual approval mode: accept a request. */
  async confirm(businessId: string, appointmentId: string, actorId: string, ctx: RequestContext) {
    const a = await this.businessAppointmentFor(businessId, appointmentId, actorId);
    await this.db.$transaction(async (tx) => {
      await this.transition(tx, a, 'confirmed', { type: 'business', id: actorId }, undefined, {}, [
        'pending',
      ]);
      await this.publish(tx, TOPICS.BOOKINGS_CONFIRMED, a, ctx);
    });
    return businessView(await this.load(a.id));
  }

  /** Manual approval mode: turn a request down (not counted against the business). */
  async decline(
    businessId: string,
    appointmentId: string,
    actorId: string,
    reason: string | undefined,
    ctx: RequestContext,
  ) {
    const a = await this.businessAppointmentFor(businessId, appointmentId, actorId);
    await this.db.$transaction(async (tx) => {
      await this.transition(
        tx,
        a,
        'cancelled',
        { type: 'business', id: actorId },
        reason,
        {
          cancelledAt: new Date(),
          cancelledBy: 'business',
          cancelReasonCode: 'declined',
          cancelReason: reason ?? null,
        },
        ['pending'],
      );
      await this.publish(tx, TOPICS.BOOKINGS_CANCELLED, a, ctx, {
        cancelledBy: 'business',
        reasonCode: 'declined',
      });
    });
    return businessView(await this.load(a.id));
  }

  /** The business cancels a booking (counts against the business's reliability, D-035). */
  async cancelByBusiness(
    businessId: string,
    appointmentId: string,
    actorId: string,
    reason: string,
    ctx: RequestContext,
  ) {
    const a = await this.businessAppointmentFor(businessId, appointmentId, actorId);
    await this.db.$transaction(async (tx) => {
      await this.transition(tx, a, 'cancelled', { type: 'business', id: actorId }, reason, {
        cancelledAt: new Date(),
        cancelledBy: 'business',
        cancelReasonCode: 'business_unavailable',
        cancelReason: reason,
      });
      await this.publish(tx, TOPICS.BOOKINGS_CANCELLED, a, ctx, {
        cancelledBy: 'business',
        reasonCode: 'business_unavailable',
      });
    });
    return businessView(await this.load(a.id));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private assertBookableTime(
    startAt: Date,
    settings: { minNoticeMinutes: number; bookingHorizonDays: number },
  ) {
    const now = Date.now();
    if (startAt.getTime() <= now) throw new AppError('That time has passed', ErrorCodes.SLOT_IN_PAST, 422);
    if (startAt.getTime() < now + settings.minNoticeMinutes * 60_000) {
      throw new AppError(
        `Bookings need at least ${settings.minNoticeMinutes} minutes’ notice`,
        ErrorCodes.SLOT_TOO_SOON,
        422,
      );
    }
    if (startAt.getTime() > now + settings.bookingHorizonDays * 86_400_000) {
      throw new AppError(
        `This business takes bookings up to ${settings.bookingHorizonDays} days ahead`,
        ErrorCodes.SLOT_TOO_FAR_AHEAD,
        422,
      );
    }
  }

  /** "Anyone": the employee with the fewest appointments that day goes first (decision H). */
  private async leastBookedFirst(
    staffIds: string[],
    business: { id: string; timezone: string },
    date: string,
  ) {
    const counts = await this.db.appointment.groupBy({
      by: ['staffId'],
      where: {
        staffId: { in: staffIds },
        status: { in: [...LIVE] },
        startAt: {
          gte: startOfDay(date, business.timezone),
          lt: startOfDay(addDays(date, 1), business.timezone),
        },
      },
      _count: { _all: true },
    });
    const load = new Map(counts.map((c) => [c.staffId, c._count._all]));
    return [...staffIds].sort((a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || a.localeCompare(b));
  }

  /**
   * One customer's bookings at one business are counted and created one at a
   * time, so two simultaneous requests can't both slip under the limit.
   */
  private async lockCustomerAtBusiness(tx: Transaction, userId: string, businessId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${businessId}`}, 0))`;
  }

  private insert(tx: Transaction, data: Omit<Prisma.AppointmentUncheckedCreateInput, 'confirmationCode'>) {
    return tx.appointment.create({ data: { ...data, confirmationCode: generateConfirmationCode() } });
  }

  /**
   * Run `attempt` (a whole transaction) for each candidate employee until one
   * succeeds. The database decides: the customer already busy → stop; this
   * employee just got booked by someone else → next candidate; the random
   * booking code collided (about 1 in 887 million) → same employee, new code.
   */
  private async firstFree<T>(candidates: string[], attempt: (staffId: string) => Promise<T>): Promise<T> {
    for (const staffId of candidates) {
      for (let tries = 0; tries < 3; tries++) {
        try {
          return await attempt(staffId);
        } catch (err) {
          const constraint = constraintNameOf(err);
          if (constraint === 'appointments_no_user_overlap') throw overlap();
          if (isExclusionViolation(err) && constraint === 'appointments_no_staff_overlap') break;
          if (isUniqueViolation(err) && constraint === 'appointments_confirmation_code_key') continue;
          throw err;
        }
      }
    }
    throw slotTaken();
  }

  /** Change status only if it is still what we expect (concurrent changes lose cleanly). */
  private async transition(
    tx: Transaction,
    a: { id: string; status: string },
    to: 'confirmed' | 'cancelled' | 'rescheduled',
    actor: Actor,
    reason?: string,
    extra: Record<string, unknown> = {},
    from: readonly string[] = LIVE,
  ) {
    if (!from.includes(a.status)) throw invalidTransition(a.status, to);
    const { count } = await tx.appointment.updateMany({
      where: { id: a.id, status: a.status as never },
      data: { status: to, version: { increment: 1 }, ...extra },
    });
    if (count === 0) throw invalidTransition(a.status, to);
    await this.history(tx, a.id, a.status as never, to, actor, reason);
  }

  private history(
    tx: Transaction,
    appointmentId: string,
    fromStatus: 'pending' | 'confirmed' | null,
    toStatus: 'pending' | 'confirmed' | 'cancelled' | 'rescheduled',
    actor: Actor,
    reason?: string,
  ) {
    return tx.appointmentStatusHistory.create({
      data: {
        appointmentId,
        fromStatus,
        toStatus,
        actorType: actor.type,
        actorId: actor.id,
        reason: reason ?? null,
      },
    });
  }

  /** Events carry ids and times only — no names or contact details. */
  private publish(
    tx: Transaction,
    type: Topic,
    a: {
      id: string;
      businessId: string;
      userId: string;
      staffId: string | null;
      serviceId: string;
      startAt: Date;
      endAt: Date;
    },
    ctx: RequestContext,
    extra: Record<string, unknown> = {},
  ) {
    return enqueueEvent(
      tx,
      createEvent({
        type,
        source: 'booking-service',
        subject: a.id,
        data: {
          appointmentId: a.id,
          businessId: a.businessId,
          userId: a.userId,
          staffId: a.staffId,
          serviceId: a.serviceId,
          startAt: a.startAt.toISOString(),
          endAt: a.endAt.toISOString(),
          ...extra,
        },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'appointment',
    );
  }

  private async ownLive(userId: string, appointmentId: string) {
    const a = await this.db.appointment.findFirst({
      where: { id: appointmentId, userId },
      include: appointmentInclude,
    });
    if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    if (!LIVE.includes(a.status as never) || a.startAt <= new Date())
      throw invalidTransition(a.status, 'cancelled');
    return a;
  }

  private async businessAppointmentFor(businessId: string, appointmentId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'appointments.manage_all');
    const a = await this.db.appointment.findFirst({
      where: { id: appointmentId, businessId },
      include: appointmentInclude,
    });
    if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    return a;
  }

  private load(id: string) {
    return this.db.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
  }

  private async receipt(id: string) {
    return this.toReceipt(await this.load(id));
  }

  private async toReceipt(a: AppointmentRow) {
    const settings = await this.settings.effective(a.businessId);
    return receiptView(a, settings.cancellationWindowHours);
  }
}

const slotTaken = () =>
  new AppError('That time is no longer available; please pick another', ErrorCodes.SLOT_UNAVAILABLE, 409);
const overlap = () =>
  new AppError('You already have an appointment at that time', ErrorCodes.APPOINTMENT_OVERLAP, 409);
const invalidTransition = (from: string, to: string) =>
  new AppError(`An appointment that is ${from} can’t be ${to}`, ErrorCodes.INVALID_TRANSITION, 409);
