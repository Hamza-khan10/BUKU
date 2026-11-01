import { randomInt } from 'node:crypto';
import {
  AppError,
  can,
  CONFIRMATION_CODE_PATTERN,
  ErrorCodes,
  generateConfirmationCode,
  publicId,
  type Actor,
  type ShowUp,
} from '@buku/common';
import {
  businessRoleOfActor,
  constraintNameOf,
  isExclusionViolation,
  isRetryableTransactionError,
  isUniqueViolation,
  requireBusinessPermissionOnShard,
  ShardNotFoundError,
  type BusinessShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS, type Topic } from '@buku/kafka';
import { activeService, assertBookingAllowedForRole, slotsOn } from '../availability/availability-service.js';
import { addDays, startOfDay, wallClock } from '../availability/time.js';
import { findBookableBusiness } from '../businesses.js';
import type { RequestContext } from '../http/context.js';
import { exponentOf } from '../money.js';
import { showUpLabels } from '../reputation/reliability.js';
import { effectiveSettings, type BookingSettingsView } from '../settings/settings-service.js';
import type { PersonSync } from './person-sync.js';
import {
  appointmentInclude,
  businessView,
  findAppointment,
  loadAppointment,
  receiptView,
  type AppointmentRow,
} from './views.js';

/**
 * Appointments: booking, the customer's receipts, the business's list, and
 * every status change.
 *
 *   pending ──confirm──▶ confirmed          (manual approval; automatic mode books as confirmed)
 *      │ decline / cancel   │ cancel
 *      ▼                    ▼
 *   cancelled            cancelled           (reschedule: old → rescheduled, new one created)
 *
 * Database v2 (D3d): the database still has the last word on conflicts. A booking first claims
 * the customer's time on their own shard — one appointment at a time across every business
 * (D-036, DB-014) — and then writes the appointment on the business's shard, whose index refuses
 * an employee in two appointments (clean-up time included) and a duplicate code (DB-024). The
 * claim's ID is the appointment's, so a claim whose booking failed is given back, and one left
 * behind by a crash is found by the sweeper. Each status change is recorded in the appointment's
 * events and published (outbox) for notifications; the customer's side follows (PersonSync).
 */

const LIVE = ['pending', 'confirmed'] as const;
const REBOOK_REMINDER_DAYS = 3;
/** Tries per employee: a write conflict or deadlock between bookings is resolved by trying again. */
const MAX_ATTEMPTS = 4;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Check-in opens this long before the start. */
const CHECK_IN_OPENS_MS = 2 * 3_600_000;
/** A claim not turned into a booking by then is the sweeper's (DB-014). */
const CLAIM_MS = 2 * 60_000;

type AppointmentStatus = 'pending' | 'confirmed' | 'cancelled' | 'rescheduled' | 'completed' | 'no_show';

export type CancelReasonCode =
  | 'schedule_conflict'
  | 'found_alternative'
  | 'too_expensive'
  | 'not_needed'
  | 'illness'
  | 'business_unavailable'
  | 'other';

export interface BookInput {
  /** The business's public ID or slug. */
  businessId: string;
  serviceId: bigint;
  /** Absent → "anyone": the least-booked free employee that day. */
  staffId?: bigint | undefined;
  startAt: string;
  notes?: string | undefined;
}

export interface BusinessListQuery {
  date?: string | undefined;
  /** Days from `date`, 1 (the default) to 7. */
  days?: number | undefined;
  staffId?: bigint | undefined;
  status?: (typeof LIVE)[number] | 'cancelled' | 'completed' | 'no_show' | 'rescheduled' | undefined;
  /** A booking code (any date) or part of the customer's name. */
  q?: string | undefined;
}

type By = { type: 'user' | 'business'; id: bigint };

export class AppointmentService {
  constructor(
    private readonly plane: DataPlane,
    private readonly persons: PersonSync,
  ) {}

  // ── Booking ──────────────────────────────────────────────────────────────

  async book(actor: Actor, input: BookInput, ctx: RequestContext) {
    assertBookingAllowedForRole(actor.role);
    const { plane } = this;
    const business = await findBookableBusiness(plane, input.businessId);
    const startAt = new Date(input.startAt);
    // Who is booking, as the business will see them: the name they book under, their reliability.
    const customer = await this.customer(actor.id);
    const plan = await plane.inBusiness(business.id, async (tx) => {
      const service = await activeService(tx, business.id, input.serviceId);
      const settings = await effectiveSettings(tx, business.id);
      assertBookableTime(startAt, settings);
      const date = wallClock(startAt, business.timezone).date;
      const slot = (await slotsOn(tx, business, service, date, { staffId: input.staffId })).find(
        (s) => s.startAt.getTime() === startAt.getTime(),
      );
      if (!slot) throw slotTaken();
      const candidates = input.staffId
        ? [input.staffId]
        : await leastBookedFirst(tx, slot.staffIds.map(BigInt), business, date);
      return { service, settings, slot, candidates };
    });
    const status = initialStatus(plan.settings, customer.showUp);

    const id = plane.id();
    await this.claim(actor.id, { id, businessId: business.id, startAt, endAt: plan.slot.endAt });
    try {
      await this.firstFree(plan.candidates, (staffId) =>
        plane.inBusiness(business.id, async (tx) => {
          await lockCustomerAtBusiness(tx, actor.id, business.id);
          // Customers book for free and without a BUKU limit (D-101): only the business's own cap applies.
          const upcoming = await tx.appointment.count({
            where: {
              userId: actor.id,
              businessId: business.id,
              status: { in: [...LIVE] },
              startAt: { gt: new Date() },
            },
          });
          if (upcoming >= plan.settings.maxFutureBookingsPerCustomer) {
            throw new AppError(
              `You can have at most ${plan.settings.maxFutureBookingsPerCustomer} upcoming bookings at this business`,
              ErrorCodes.LIMIT_REACHED,
              409,
            );
          }
          const created = await insert(tx, {
            id,
            businessId: business.id,
            serviceId: plan.service.id,
            staffId,
            userId: actor.id,
            status,
            startAt,
            endAt: plan.slot.endAt,
            blockedUntil: new Date(
              startAt.getTime() + (plan.service.durationMinutes + plan.service.bufferMinutes) * 60_000,
            ),
            notes: input.notes ?? null,
            priceMinor: plan.service.priceMinor,
            currency: plan.service.currency,
            customerName: customer.name,
          });
          await this.history(tx, created, null, status, { type: 'user', id: actor.id });
          // The status tells notifications whether this is a booking or a request awaiting approval.
          await this.publish(tx, TOPICS.BOOKINGS_CREATED, created, ctx, { status });
          if (status === 'confirmed') await this.publish(tx, TOPICS.BOOKINGS_CONFIRMED, created, ctx);
        }),
      );
    } catch (err) {
      await this.release(actor.id, id);
      throw err;
    }
    await this.persons.syncSoon(business.id, id);
    return this.receipt(business.id, id);
  }

  // ── The customer's side ──────────────────────────────────────────────────

  /** My appointments: my own list (one shard), each shown from its business's shard. */
  async myAppointments(userId: bigint, scope: 'upcoming' | 'past', page: number, limit: number) {
    const now = new Date();
    const where =
      scope === 'upcoming'
        ? { userId, status: { in: [...LIVE] }, startAt: { gte: now } }
        : { userId, OR: [{ status: { notIn: [...LIVE] } }, { startAt: { lt: now } }] };
    const db = await this.plane.user(userId);
    const [rows, total] = await Promise.all([
      db.userAppointment.findMany({
        where,
        orderBy: { startAt: scope === 'upcoming' ? 'asc' : 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        select: { appointmentId: true, businessId: true },
      }),
      db.userAppointment.count({ where }),
    ]);
    const receipts = new Map<bigint, Awaited<ReturnType<AppointmentService['toReceipt']>>>();
    await this.plane.atBusinesses(
      rows.map((r) => r.businessId),
      async (tx, businessIds) => {
        for (const r of rows.filter((x) => businessIds.includes(x.businessId))) {
          const a = await loadAppointment(tx, r.appointmentId);
          if (a?.userId === userId) receipts.set(a.id, await this.toReceipt(tx, a));
        }
      },
    );
    const items = rows.flatMap((r) => receipts.get(r.appointmentId) ?? []);
    return { items, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /** A receipt — only for the customer it belongs to (404 for anyone else). */
  async myAppointment(userId: bigint, appointmentPublicId: string) {
    const mine = await this.mine(userId, appointmentPublicId);
    return this.receipt(mine.businessId, mine.appointmentId);
  }

  async cancelMine(
    userId: bigint,
    appointmentPublicId: string,
    input: { reasonCode: CancelReasonCode; note?: string | undefined; bookLater?: boolean | undefined },
    ctx: RequestContext,
  ) {
    const { businessId, appointmentId } = await this.mine(userId, appointmentPublicId);
    await this.plane.inBusiness(businessId, async (tx) => {
      const a = await ownLive(tx, userId, appointmentId);
      const settings = await effectiveSettings(tx, businessId);
      const now = new Date();
      const late = now.getTime() > a.startAt.getTime() - settings.cancellationWindowHours * 3_600_000;
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
    await this.persons.syncSoon(businessId, appointmentId);
    return this.receipt(businessId, appointmentId);
  }

  /**
   * The customer closed their account: every visit still to come is cancelled,
   * as if they had cancelled it themselves (the business is told, late ones
   * count as late), so nobody keeps a place for someone who has gone. Visits
   * they've arrived for are left alone. Safe to run again: nothing is left to
   * cancel the second time. Their own list says which businesses to visit. Returns how many were
   * cancelled.
   */
  async cancelForClosedAccount(userId: bigint, ctx: RequestContext): Promise<number> {
    const now = new Date();
    const db = await this.plane.user(userId).catch((err: unknown) => {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    });
    const upcoming = db
      ? await db.userAppointment.findMany({
          where: { userId, status: { in: [...LIVE] }, startAt: { gt: now } },
          select: { appointmentId: true, businessId: true },
        })
      : [];
    let cancelled = 0;
    for (const { appointmentId, businessId } of upcoming) {
      try {
        const done = await this.plane.inBusiness(businessId, async (tx) => {
          const a = await loadAppointment(tx, appointmentId);
          if (!a || a.userId !== userId || !isLive(a.status) || a.startAt <= now || a.checkedInAt)
            return false;
          const settings = await effectiveSettings(tx, businessId);
          const late = now.getTime() > a.startAt.getTime() - settings.cancellationWindowHours * 3_600_000;
          await this.transition(tx, a, 'cancelled', { type: 'user', id: userId }, 'account closed', {
            cancelledAt: now,
            cancelledBy: 'user',
            cancelReasonCode: 'other',
            cancelReason: 'Account closed',
            lateCancellation: late,
          });
          await this.publish(tx, TOPICS.BOOKINGS_CANCELLED, a, ctx, {
            cancelledBy: 'user',
            late,
            reasonCode: 'other',
            bookLater: false,
          });
          return true;
        });
        if (done) cancelled++;
      } catch (err) {
        // Changed meanwhile (checked in, cancelled by the business): nothing to do for that one.
        if (!(err instanceof AppError && err.code === ErrorCodes.INVALID_TRANSITION)) throw err;
      }
      await this.persons.syncSoon(businessId, appointmentId);
    }
    return cancelled;
  }

  /** Move my appointment (same service) — only before the cancellation window starts. */
  async rescheduleMine(
    userId: bigint,
    appointmentPublicId: string,
    input: { startAt: string; staffId?: bigint | undefined },
    ctx: RequestContext,
  ) {
    const { plane } = this;
    const { businessId, appointmentId } = await this.mine(userId, appointmentPublicId);
    const startAt = new Date(input.startAt);
    const plan = await plane.inBusiness(businessId, async (tx) => {
      const old = await ownLive(tx, userId, appointmentId);
      const settings = await effectiveSettings(tx, businessId);
      if (Date.now() > old.startAt.getTime() - settings.cancellationWindowHours * 3_600_000) {
        throw new AppError(
          `Appointments can be moved until ${settings.cancellationWindowHours} hours before; please contact the business`,
          ErrorCodes.CANCELLATION_WINDOW_PASSED,
          409,
        );
      }
      const business = { id: businessId, timezone: old.business.timezone };
      const service = await activeService(tx, businessId, old.serviceId);
      assertBookableTime(startAt, settings);
      const date = wallClock(startAt, business.timezone).date;
      const slot = (
        await slotsOn(tx, business, service, date, { staffId: input.staffId, excludeAppointmentId: old.id })
      ).find((s) => s.startAt.getTime() === startAt.getTime());
      if (!slot) throw slotTaken();
      // Keep the same person when they're free; otherwise the least booked.
      const free = slot.staffIds.map(BigInt);
      const candidates = input.staffId
        ? [input.staffId]
        : old.staffId && free.includes(old.staffId)
          ? [old.staffId]
          : await leastBookedFirst(tx, free, business, date);
      return { old, service, settings, slot, candidates };
    });
    const { old } = plan;
    const status = initialStatus(plan.settings, (await showUpLabels(plane, [userId])).get(userId));

    // The new time replaces the old one on the customer's shard (the two may overlap).
    const id = plane.id();
    await this.claim(userId, { id, businessId, startAt, endAt: plan.slot.endAt }, old.id);
    try {
      await this.firstFree(plan.candidates, (staffId) =>
        plane.inBusiness(businessId, async (tx) => {
          const by: By = { type: 'user', id: userId };
          const current = await ownLive(tx, userId, appointmentId);
          await this.transition(tx, current, 'rescheduled', by, 'rescheduled by the customer');
          const created = await insert(tx, {
            id,
            businessId,
            serviceId: old.serviceId,
            staffId,
            userId,
            status,
            startAt,
            endAt: plan.slot.endAt,
            blockedUntil: new Date(
              startAt.getTime() + (plan.service.durationMinutes + plan.service.bufferMinutes) * 60_000,
            ),
            notes: old.notes,
            priceMinor: old.priceMinor,
            currency: old.currency,
            rescheduledFromId: old.id,
            customerName: old.customerName,
          });
          await this.history(tx, created, null, status, by);
          await this.publish(tx, TOPICS.BOOKINGS_RESCHEDULED, created, ctx, {
            previousAppointmentId: old.id.toString(),
          });
        }),
      );
    } catch (err) {
      await this.release(userId, id);
      // The old appointment still stands: its time is held again.
      await this.persons.syncSoon(businessId, old.id);
      throw err;
    }
    await this.persons.syncSoon(businessId, old.id);
    await this.persons.syncSoon(businessId, id);
    return this.receipt(businessId, id);
  }

  // ── The business's side ──────────────────────────────────────────────────

  /**
   * The day's appointments (default: today), or a search by booking code or
   * customer name — so a customer without a phone is found just the same.
   * Staff see only their own appointments; front desk, managers and owners all.
   */
  async businessList(businessId: bigint, actor: Actor, query: BusinessListQuery) {
    const rows = await this.plane.inBusiness(businessId, async (tx) => {
      const role = await businessRoleOfActor(tx, businessId, actor);
      if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      const business = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { timezone: true, currency: true },
      });

      let staffFilter: bigint[] | undefined;
      if (!can(role, 'appointments.manage_all')) {
        const mine = await tx.staff.findMany({
          where: { businessId, userId: actor.id },
          select: { id: true },
        });
        staffFilter = mine.map((s) => s.id);
      }

      const q = query.q?.trim();
      const code = q && CONFIRMATION_CODE_PATTERN.test(q.toUpperCase()) ? q.toUpperCase() : undefined;
      const date = query.date ?? wallClock(new Date(), business.timezone).date;
      // A booking code: any date, through the index that knows where it is.
      const coded = code ? await findAppointment(tx, businessId, { code }) : null;
      const when = q
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
              lt: startOfDay(addDays(date, Math.min(7, Math.max(1, query.days ?? 1))), business.timezone),
            },
          };

      const found = code
        ? coded
          ? [coded]
          : []
        : await tx.appointment.findMany({
            where: {
              businessId,
              ...when,
              ...(q && { customerName: { contains: q, mode: 'insensitive' } }),
              ...(query.status && { status: query.status }),
              ...(query.staffId && { staffId: query.staffId }),
              ...(staffFilter && { staffId: { in: staffFilter } }),
            },
            include: appointmentInclude,
            orderBy: { startAt: 'asc' },
            // A week is up to seven days' worth.
            take: (query.days ?? 1) > 1 ? 1000 : 200,
          });
      const visible = found.filter(
        (a) =>
          (!query.status || a.status === query.status) &&
          (!query.staffId || a.staffId === query.staffId) &&
          (!staffFilter || (a.staffId !== null && staffFilter.includes(a.staffId))),
      );
      const exponent = await exponentOf(tx, business.currency);
      const moved = await movedFromOf(tx, visible);
      return {
        date: code || q ? null : date,
        timezone: business.timezone,
        visible,
        exponent,
        moved,
      };
    });
    const [showUp, customers] = await Promise.all([
      showUpLabels(
        this.plane,
        rows.visible.map((r) => r.userId),
      ),
      this.customerIds(rows.visible.map((r) => r.userId)),
    ]);
    return {
      date: rows.date,
      timezone: rows.timezone,
      items: rows.visible.map((a) =>
        businessView(
          a,
          customers.get(a.userId) ?? null,
          rows.exponent,
          rows.moved.get(a.id) ?? null,
          showUp.get(a.userId),
        ),
      ),
    };
  }

  async businessAppointment(businessId: bigint, appointmentPublicId: string, actor: Actor) {
    const a = await this.plane.inBusiness(businessId, async (tx) => {
      const role = await businessRoleOfActor(tx, businessId, actor);
      if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      const a = await findAppointment(tx, businessId, { publicId: appointmentPublicId });
      if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
      // Staff see only their own appointments.
      if (!can(role, 'appointments.manage_all') && !(await isTheirs(tx, a, actor.id)))
        throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
      return a;
    });
    return this.teamView(businessId, a.id);
  }

  /** Manual approval mode: accept a request. */
  async confirm(businessId: bigint, appointmentPublicId: string, actor: Actor, ctx: RequestContext) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const a = await businessAppointmentFor(tx, businessId, appointmentPublicId, actor);
      await this.transition(tx, a, 'confirmed', { type: 'business', id: actor.id }, undefined, {}, [
        'pending',
      ]);
      await this.publish(tx, TOPICS.BOOKINGS_CONFIRMED, a, ctx);
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  /** Manual approval mode: turn a request down (not counted against the business). */
  async decline(
    businessId: bigint,
    appointmentPublicId: string,
    actor: Actor,
    reason: string | undefined,
    ctx: RequestContext,
  ) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const a = await businessAppointmentFor(tx, businessId, appointmentPublicId, actor);
      await this.transition(
        tx,
        a,
        'cancelled',
        { type: 'business', id: actor.id },
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
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  /** The business cancels a booking (counts against the business's reliability, D-035). */
  async cancelByBusiness(
    businessId: bigint,
    appointmentPublicId: string,
    actor: Actor,
    reason: string,
    ctx: RequestContext,
  ) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const a = await businessAppointmentFor(tx, businessId, appointmentPublicId, actor);
      if (a.checkedInAt) throw checkedIn();
      await this.transition(tx, a, 'cancelled', { type: 'business', id: actor.id }, reason, {
        cancelledAt: new Date(),
        cancelledBy: 'business',
        cancelReasonCode: 'business_unavailable',
        cancelReason: reason,
      });
      await this.publish(tx, TOPICS.BOOKINGS_CANCELLED, a, ctx, {
        cancelledBy: 'business',
        reasonCode: 'business_unavailable',
      });
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  // ── At the venue: arrival, completion, no-show ───────────────────────────

  /**
   * The customer arrived: the receipt was scanned, the code typed, or the
   * customer picked from the list (no phone needed). Scanning twice is fine.
   * A request not yet approved (manual mode) is approved by checking in.
   */
  async checkIn(
    businessId: bigint,
    ref: { publicId: string } | { code: string },
    actor: Actor,
    ctx: RequestContext,
  ) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const { a, role } = await visit(tx, businessId, ref, actor);
      if (a.checkedInAt) return a.id;
      if (a.status === 'pending' && !can(role, 'appointments.manage_all')) throw AppError.forbidden();
      if (a.status !== 'pending' && a.status !== 'confirmed') throw invalidTransition(a.status, 'checked in');
      const now = new Date();
      if (now.getTime() < a.startAt.getTime() - CHECK_IN_OPENS_MS) {
        const opens = wallClock(a.startAt.getTime() - CHECK_IN_OPENS_MS, a.business.timezone);
        throw new AppError(
          `Check-in opens 2 hours before the appointment (${opens.date} ${opens.time})`,
          ErrorCodes.INVALID_TRANSITION,
          409,
        );
      }
      if (now > a.endAt)
        throw new AppError('This appointment has already ended', ErrorCodes.INVALID_TRANSITION, 409);
      const { count } = await tx.appointment.updateMany({
        where: { id: a.id, startAt: a.startAt, status: a.status, checkedInAt: null },
        data: { status: 'confirmed', checkedInAt: now, checkedInById: actor.id, version: { increment: 1 } },
      });
      if (count === 0) throw invalidTransition(a.status, 'checked in');
      if (a.status === 'pending') {
        await this.history(
          tx,
          a,
          'pending',
          'confirmed',
          { type: 'business', id: actor.id },
          'approved on arrival',
        );
        await this.publish(tx, TOPICS.BOOKINGS_CONFIRMED, a, ctx);
      }
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  /** The visit is done (from its start time on; with or without a recorded check-in). */
  async complete(businessId: bigint, appointmentPublicId: string, actor: Actor, ctx: RequestContext) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const { a } = await visit(tx, businessId, { publicId: appointmentPublicId }, actor);
      if (a.status === 'confirmed' && new Date() < a.startAt) {
        throw new AppError(
          'An appointment can’t be completed before it starts',
          ErrorCodes.INVALID_TRANSITION,
          409,
        );
      }
      await this.transition(tx, a, 'completed', { type: 'business', id: actor.id }, undefined, {}, [
        'confirmed',
      ]);
      await this.publish(tx, TOPICS.BOOKINGS_COMPLETED, a, ctx, { checkedIn: a.checkedInAt !== null });
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  /** The customer didn't come: only after the grace period, and never once they checked in. */
  async noShow(businessId: bigint, appointmentPublicId: string, actor: Actor, ctx: RequestContext) {
    const id = await this.plane.inBusiness(businessId, async (tx) => {
      const { a } = await visit(tx, businessId, { publicId: appointmentPublicId }, actor);
      if (a.checkedInAt) throw checkedIn();
      const settings = await effectiveSettings(tx, businessId);
      if (
        a.status === 'confirmed' &&
        Date.now() < a.startAt.getTime() + settings.noShowGraceMinutes * 60_000
      ) {
        throw new AppError(
          `A no-show can be recorded ${settings.noShowGraceMinutes} minutes after the start`,
          ErrorCodes.INVALID_TRANSITION,
          409,
        );
      }
      await this.transition(tx, a, 'no_show', { type: 'business', id: actor.id }, undefined, {}, [
        'confirmed',
      ]);
      await this.publish(tx, TOPICS.BOOKINGS_NO_SHOW, a, ctx);
      return a.id;
    });
    return this.afterChange(businessId, id);
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** The customer's name (as the business will see it) and reliability, from their own shard. */
  private async customer(userId: bigint): Promise<{ name: string; showUp: ShowUp | undefined }> {
    const person = await (
      await this.plane.user(userId)
    ).user.findFirst({ where: { id: userId, deletedAt: null }, select: { name: true } });
    if (!person) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    return { name: person.name, showUp: (await showUpLabels(this.plane, [userId])).get(userId) };
  }

  /**
   * Hold the customer's time on their own shard before the business's appointment is written:
   * one appointment at a time anywhere (D-036). `replacing` (rescheduling) is given up in the same
   * step, since the new time may overlap it. Held for 2 minutes; then it is the sweeper's.
   */
  private async claim(
    userId: bigint,
    hold: { id: bigint; businessId: bigint; startAt: Date; endAt: Date },
    replacing?: bigint,
  ) {
    const db = await this.plane.user(userId);
    try {
      await db.$transaction(async (tx) => {
        if (replacing) {
          await tx.userTimeReservation.deleteMany({
            where: { userId, OR: [{ id: replacing }, { appointmentId: replacing }] },
          });
        }
        await tx.userTimeReservation.create({
          data: { ...hold, userId, expiresAt: new Date(Date.now() + CLAIM_MS) },
        });
      });
    } catch (err) {
      if (isExclusionViolation(err)) throw overlap();
      throw err;
    }
  }

  /** A claim whose booking didn't happen is given back. */
  private async release(userId: bigint, id: bigint) {
    try {
      await (
        await this.plane.user(userId)
      ).userTimeReservation.deleteMany({ where: { id, appointmentId: null } });
    } catch {
      // The sweeper gives it back after 2 minutes.
    }
  }

  /** My appointment (by its public ID), from my own list; 404 for anyone else's. */
  private async mine(userId: bigint, appointmentPublicId: string) {
    const row = await (
      await this.plane.user(userId)
    ).userAppointment.findFirst({
      where: { userId, appointmentPublicId },
      select: { appointmentId: true, businessId: true },
    });
    if (!row) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
    return row;
  }

  /**
   * Run `attempt` (a whole transaction) for each candidate employee until one
   * succeeds. The database decides: the customer already busy → stop; this
   * employee just got booked by someone else → next candidate; the random
   * booking code collided (about 1 in 887 million) → same employee, new code;
   * two bookings' transactions got in each other's way (a write conflict or
   * deadlock, which Postgres resolves by aborting one) → same employee again,
   * after a short random pause, so a busy hour never shows a server error.
   */
  private async firstFree<T>(candidates: bigint[], attempt: (staffId: bigint) => Promise<T>): Promise<T> {
    for (const staffId of candidates) {
      for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
        try {
          return await attempt(staffId);
        } catch (err) {
          const constraint = constraintNameOf(err);
          if (constraint === 'appointment_index_customer_free') throw overlap();
          if (isExclusionViolation(err) && constraint === 'appointment_index_staff_free') break;
          if (
            isUniqueViolation(err) &&
            (constraint === 'appointment_index_business_id_code_key' ||
              constraint === 'appointment_index_public_id_key')
          )
            continue;
          if (isRetryableTransactionError(err) && tries < MAX_ATTEMPTS - 1) {
            await pause(10 + randomInt(40) * (tries + 1));
            continue;
          }
          throw err;
        }
      }
    }
    throw slotTaken();
  }

  /** Change status only if it is still what we expect (concurrent changes lose cleanly). */
  private async transition(
    tx: BusinessTx,
    a: AppointmentRow,
    to: AppointmentStatus,
    by: By,
    reason?: string,
    extra: Record<string, unknown> = {},
    from: readonly string[] = LIVE,
  ) {
    if (!from.includes(a.status)) throw invalidTransition(a.status, to);
    const { count } = await tx.appointment.updateMany({
      where: {
        id: a.id,
        startAt: a.startAt,
        status: a.status,
        // Once the customer has arrived, the visit can only be completed (never cancelled or moved).
        ...((to === 'cancelled' || to === 'rescheduled') && { checkedInAt: null }),
      },
      data: { status: to, version: { increment: 1 }, ...extra },
    });
    if (count === 0) throw invalidTransition(a.status, to);
    await this.history(tx, a, a.status as AppointmentStatus, to, by, reason);
  }

  private history(
    tx: BusinessTx,
    a: { id: bigint; businessId: bigint; startAt: Date },
    fromStatus: AppointmentStatus | null,
    toStatus: AppointmentStatus,
    by: By,
    reason?: string,
  ) {
    return tx.appointmentEvent.create({
      data: {
        id: this.plane.id(),
        businessId: a.businessId,
        appointmentId: a.id,
        appointmentStartAt: a.startAt,
        fromStatus,
        toStatus,
        actorType: by.type,
        actorId: by.id,
        reason: reason ?? null,
      },
    });
  }

  /** Events carry internal IDs and times only — no names or contact details (DB-042). */
  private publish(
    tx: BusinessTx,
    type: Topic,
    a: {
      id: bigint;
      businessId: bigint;
      userId: bigint;
      staffId: bigint | null;
      serviceId: bigint;
      startAt: Date;
      endAt: Date;
    },
    ctx: RequestContext,
    extra: Record<string, unknown> = {},
  ) {
    return enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({
        type,
        source: 'booking-service',
        subject: a.id.toString(),
        data: {
          appointmentId: a.id.toString(),
          businessId: a.businessId.toString(),
          userId: a.userId.toString(),
          staffId: a.staffId?.toString() ?? null,
          serviceId: a.serviceId.toString(),
          startAt: a.startAt.toISOString(),
          endAt: a.endAt.toISOString(),
          ...extra,
        },
        ...(ctx.requestId && { correlationId: ctx.requestId }),
      }),
      'appointment',
    );
  }

  /** After the business's change: the customer's side follows, and the team sees the result. */
  private async afterChange(businessId: bigint, appointmentId: bigint) {
    await this.persons.syncSoon(businessId, appointmentId);
    return this.teamView(businessId, appointmentId);
  }

  /** One appointment as the team sees it, with the customer's show-up label. */
  private async teamView(businessId: bigint, appointmentId: bigint) {
    const { a, exponent, moved } = await this.plane.inBusiness(businessId, async (tx) => {
      const a = (await loadAppointment(tx, appointmentId))!;
      return {
        a,
        exponent: await exponentOf(tx, a.currency),
        moved: (await movedFromOf(tx, [a])).get(a.id) ?? null,
      };
    });
    const [showUp, customers] = await Promise.all([
      showUpLabels(this.plane, [a.userId]),
      this.customerIds([a.userId]),
    ]);
    return businessView(a, customers.get(a.userId) ?? null, exponent, moved, showUp.get(a.userId));
  }

  /** Customers' public IDs, read on their shards. */
  private async customerIds(userIds: bigint[]): Promise<Map<bigint, string>> {
    const found = new Map<bigint, string>();
    for (const [db, ids] of await this.plane.usersByShard(userIds)) {
      for (const u of await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, publicId: true },
      }))
        found.set(u.id, u.publicId);
    }
    return found;
  }

  private async receipt(businessId: bigint, appointmentId: bigint) {
    return this.plane.inBusiness(businessId, async (tx) =>
      this.toReceipt(tx, (await loadAppointment(tx, appointmentId))!),
    );
  }

  private async toReceipt(tx: BusinessTx, a: AppointmentRow) {
    const settings = await effectiveSettings(tx, a.businessId);
    const exponent = await exponentOf(tx, a.currency);
    const moved = (await movedFromOf(tx, [a])).get(a.id) ?? null;
    return receiptView(a, settings.cancellationWindowHours, exponent, moved);
  }
}

// ── helpers in the business's transaction ──────────────────────────────────

const isLive = (status: string) => (LIVE as readonly string[]).includes(status);

function assertBookableTime(
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

/**
 * Confirmed at once, unless the business approves every booking — or asks to approve
 * bookings from customers who often don't show up (D-078: the only effect reliability has).
 */
function initialStatus(settings: BookingSettingsView, showUp: ShowUp | undefined): 'confirmed' | 'pending' {
  if (settings.confirmationMode === 'manual') return 'pending';
  const threshold = settings.approvalBelowShowUpPercent;
  if (threshold === null || !showUp) return 'confirmed';
  return showUp.showsUpPercent !== null && showUp.showsUpPercent < threshold ? 'pending' : 'confirmed';
}

/** "Anyone": the employee with the fewest appointments that day goes first (decision H). */
async function leastBookedFirst(
  tx: BusinessTx,
  staffIds: bigint[],
  business: { id: bigint; timezone: string },
  date: string,
) {
  const counts = await tx.appointmentIndex.groupBy({
    by: ['staffId'],
    where: {
      businessId: business.id,
      staffId: { in: staffIds },
      live: true,
      startAt: {
        gte: startOfDay(date, business.timezone),
        lt: startOfDay(addDays(date, 1), business.timezone),
      },
    },
    _count: { _all: true },
  });
  const load = new Map(counts.map((c) => [c.staffId, c._count._all]));
  return [...staffIds].sort(
    (a, b) => (load.get(a) ?? 0) - (load.get(b) ?? 0) || (a < b ? -1 : a > b ? 1 : 0),
  );
}

/**
 * One customer's bookings at one business are counted and created one at a
 * time, so two simultaneous requests can't both slip under the limit.
 */
async function lockCustomerAtBusiness(tx: BusinessTx, userId: bigint, businessId: bigint) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${businessId}`}, 0))`;
}

/**
 * Bookings for the same person take turns for the moment of inserting (a
 * transaction-scoped lock on that employee). Without it, two simultaneous
 * inserts that would double-book them can deadlock inside the no-overlap
 * constraint; with it, the second sees the first and is refused cleanly
 * ("taken" → the next person). Always after the customer's lock, so the
 * order never forms a cycle. Each try gets a fresh code and public ID.
 */
async function insert(
  tx: BusinessTx,
  data: Omit<BusinessShard.Prisma.AppointmentUncheckedCreateInput, 'code' | 'publicId'>,
) {
  if (data.staffId) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff:${data.staffId}`}, 0))`;
  }
  return tx.appointment.create({ data: { ...data, code: generateConfirmationCode(), publicId: publicId() } });
}

/** The public IDs of the appointments these were moved from. */
async function movedFromOf(tx: BusinessTx, rows: AppointmentRow[]): Promise<Map<bigint, string>> {
  const from = rows.filter((r) => r.rescheduledFromId !== null);
  if (!from.length) return new Map();
  const index = await tx.appointmentIndex.findMany({
    where: { appointmentId: { in: from.map((r) => r.rescheduledFromId!) } },
    select: { appointmentId: true, publicId: true },
  });
  const pid = new Map(index.map((i) => [i.appointmentId, i.publicId]));
  const moved = new Map<bigint, string>();
  for (const r of from) {
    const p = pid.get(r.rescheduledFromId!);
    if (p) moved.set(r.id, p);
  }
  return moved;
}

async function ownLive(tx: BusinessTx, userId: bigint, appointmentId: bigint) {
  const a = await loadAppointment(tx, appointmentId);
  if (!a || a.userId !== userId) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
  if (!isLive(a.status) || a.startAt <= new Date()) throw invalidTransition(a.status, 'cancelled');
  if (a.checkedInAt) throw checkedIn();
  return a;
}

async function isTheirs(tx: BusinessTx, a: AppointmentRow, userId: bigint) {
  return a.staffId !== null && (await tx.staff.count({ where: { id: a.staffId, userId } })) > 0;
}

/**
 * An appointment the actor may handle at the venue: owner, manager and front
 * desk for all; an employee for their own. Codes of other businesses — and
 * appointments of colleagues — are simply "not found".
 */
async function visit(
  tx: BusinessTx,
  businessId: bigint,
  ref: { publicId: string } | { code: string },
  actor: Actor,
) {
  const role = await businessRoleOfActor(tx, businessId, actor);
  if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  const a = await findAppointment(tx, businessId, 'code' in ref ? { code: ref.code.toUpperCase() } : ref);
  if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
  if (!can(role, 'appointments.manage_all') && !(await isTheirs(tx, a, actor.id)))
    throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
  return { a, role };
}

async function businessAppointmentFor(
  tx: BusinessTx,
  businessId: bigint,
  appointmentPublicId: string,
  actor: Actor,
) {
  await requireBusinessPermissionOnShard(tx, businessId, actor, 'appointments.manage_all');
  const a = await findAppointment(tx, businessId, { publicId: appointmentPublicId });
  if (!a) throw AppError.notFound('Appointment', ErrorCodes.APPOINTMENT_NOT_FOUND);
  return a;
}

const slotTaken = () =>
  new AppError('That time is no longer available; please pick another', ErrorCodes.SLOT_UNAVAILABLE, 409);
const overlap = () =>
  new AppError('You already have an appointment at that time', ErrorCodes.APPOINTMENT_OVERLAP, 409);
const checkedIn = () =>
  new AppError(
    'The customer has already checked in; the visit can only be completed',
    ErrorCodes.INVALID_TRANSITION,
    409,
  );
const invalidTransition = (from: string, to: string) =>
  new AppError(`An appointment that is ${from} can’t be ${to}`, ErrorCodes.INVALID_TRANSITION, 409);
