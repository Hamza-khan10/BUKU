import { ID_EPOCH_MS } from '@buku/common';
import type { DataPlane, UserShardClient } from '@buku/database';
import { isQuietHour } from '../channels.js';
import { suggest, type Message, type Opening } from '../messages.js';
import type { NotificationSettings, Settings } from '../settings.js';
import { pickOpening, type OpeningsFinder } from './openings.js';
import type { Scheduler } from './scheduler.js';
import {
  capsAllow,
  dueDate,
  everyDays,
  firstBookingStep,
  RULES,
  usualDue,
  usualMinuteOfDay,
} from './suggestion-rules.js';

/**
 * Suggestions shaped by how each person uses BUKU (D-075). A visit is a
 * completed appointment, or one they checked in to (not every business marks
 * visits completed), or a completed queue ticket. Regulars whose
 * usual visit is due (with a real free time), people who stopped coming, and
 * new accounts that never booked. Only people who opted in are considered
 * (`suggestions`, or `marketingEmails` for email); each suggestion goes once
 * (a key per visit / quiet spell / step) and within the admin's caps; never
 * at night; never when they already have something booked there.
 *
 * Database v2 (D3f): each user shard is read on its own — people's visits are in their
 * reliability ledger (`user_visit_outcomes`), their bookings in their own list, their place in
 * line in `user_active_tickets` — and only the businesses a suggestion names are asked about
 * (still taking bookings, the service still offered, the usual employee).
 */

const DAY = 86_400_000;
/** Per run: keep well under booking-service's availability rate limit. */
const MAX_LOOKUPS = 30;
const MAX_SENDS = 500;
const CANDIDATES = 2000;
const LIVE_TICKET = ['waiting', 'called', 'serving'] as const;
const BOOKABLE = ['pending', 'verified'] as const;

export interface SuggestionCounts {
  usual: number;
  comeBack: number;
  firstBooking: number;
}

interface Budget {
  sends: number;
  lookups: number;
}

export class Suggestions {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      settings: NotificationSettings;
      scheduler: Scheduler;
      openings: OpeningsFinder;
    },
  ) {}

  async run(now = new Date()): Promise<SuggestionCounts> {
    const counts: SuggestionCounts = { usual: 0, comeBack: 0, firstBooking: 0 };
    const settings = await this.deps.settings.get();
    if (!settings.suggestionsEnabled || settings.suggestionMaxPer30Days === 0) return counts;
    const budget: Budget = { sends: MAX_SENDS, lookups: MAX_LOOKUPS };
    await this.deps.plane.acrossUsers(async (db) => {
      counts.usual += await this.regulars(db, now, settings, budget);
      counts.comeBack += await this.comeBacks(db, now, settings, budget);
      counts.firstBooking += await this.firstBookings(db, now, settings, budget);
    });
    return counts;
  }

  // ── Regulars whose usual visit is due ─────────────────────────────────────

  private async regulars(db: UserShardClient, now: Date, settings: Settings, budget: Budget) {
    const since = new Date(now.getTime() - RULES.regular.lookbackDays * DAY);
    const minGap = new Date(now.getTime() - RULES.regular.minEveryDays * RULES.regular.dueAt * DAY);
    const rows = await db.$queryRaw<{ userId: bigint; businessId: bigint; visits: Date[]; lastId: bigint }[]>`
      SELECT o.user_id AS "userId", o.business_id AS "businessId",
             array_agg(o.happened_at ORDER BY o.happened_at) AS visits,
             (array_agg(o.ref_id ORDER BY o.happened_at DESC))[1] AS "lastId"
      FROM user_visit_outcomes o
      JOIN users u ON u.id = o.user_id
      JOIN notification_preferences p ON p.user_id = o.user_id
      WHERE o.kind = 'visit' AND o.source = 'appointment'
        AND o.happened_at > ${since} AND o.happened_at <= ${now}
        AND u.deleted_at IS NULL AND u.status = 'active' AND u.managed_by_business_id IS NULL
        AND (p.suggestions OR p.marketing_emails)
      GROUP BY o.user_id, o.business_id
      HAVING count(*) >= ${RULES.regular.minVisits} AND max(o.happened_at) < ${minGap}
      LIMIT ${CANDIDATES}`;

    let sent = 0;
    const keyOf = (r: { lastId: bigint }) => `suggest:usual:${r.lastId}`;
    const done = await this.deps.scheduler.sentKeys(rows.map((r) => ({ userId: r.userId, key: keyOf(r) })));
    for (const r of rows) {
      if (budget.sends <= 0) break;
      const key = keyOf(r);
      if (done.has(`${r.userId}:${key}`)) continue;
      const every = everyDays(r.visits);
      const last = r.visits.at(-1)!;
      if (every === null || usualDue(last, every, now) !== 'due') continue;

      // Their last visit there: what they had, and with whom.
      const place = await this.place(r.businessId, { lastAppointmentId: r.lastId });
      if (!place?.service) continue;
      if (isQuietHour(now, place.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (await this.busy(db, r.userId, now, r.businessId)) continue;
      if (!(await this.capsAllow(db, r.userId, settings, now))) continue;

      const opening =
        budget.lookups > 0
          ? await this.findOpening(place, r.visits, dueDate(last, every), now, budget)
          : null;
      const message = suggest.usual({
        businessId: place.publicId,
        businessName: place.name,
        serviceId: place.service.id.toString(),
        serviceName: place.service.name,
        timezone: place.timezone,
        everyDays: every,
        sinceDays: (now.getTime() - last.getTime()) / DAY,
        opening,
      });
      if (await this.send(key, 'suggest_usual', r.userId, message, now)) {
        sent++;
        budget.sends--;
      }
    }
    return sent;
  }

  /** A free time near their usual one, with their usual employee if possible. */
  private async findOpening(
    place: Place,
    visits: Date[],
    due: Date,
    now: Date,
    budget: { lookups: number },
  ): Promise<Opening | null> {
    const service = place.service!;
    const from = new Date(Math.max(now.getTime(), due.getTime()));
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: place.timezone }).format(from);
    const usual = usualMinuteOfDay(visits, place.timezone);
    const attempts = place.usualStaff ? [place.usualStaff.id, undefined] : [undefined];
    for (const staffId of attempts) {
      if (budget.lookups <= 0) return null;
      budget.lookups--;
      const slots = await this.deps.openings.find({
        businessId: place.publicId,
        serviceId: service.id.toString(),
        date,
        days: 7,
        staffId: staffId?.toString(),
      });
      if (slots === null) return null; // booking-service unavailable: don't keep asking
      const future = slots.filter((s) => s.startAt.getTime() > now.getTime() + 2 * 3_600_000);
      const slot = pickOpening(future, usual, place.timezone);
      if (!slot) continue;
      const chosen = staffId?.toString() ?? slot.staffIds[0] ?? null;
      const staffName =
        chosen === null
          ? null
          : chosen === place.usualStaff?.id.toString()
            ? place.usualStaff.name
            : await this.staffName(place.id, chosen);
      return { startAt: slot.startAt, staffId: chosen, staffName };
    }
    return null;
  }

  // ── People who stopped coming ─────────────────────────────────────────────

  private async comeBacks(db: UserShardClient, now: Date, settings: Settings, budget: Budget) {
    const from = new Date(now.getTime() - RULES.comeBack.untilDays * DAY);
    const to = new Date(now.getTime() - RULES.comeBack.afterDays * DAY);
    // Last booking (of any outcome; an appointment's ID starts with when it was made, DB-002) or
    // queue join: any of them means they were active.
    const epoch = BigInt(ID_EPOCH_MS);
    const rows = await db.$queryRaw<{ userId: bigint; lastActive: Date }[]>`
      WITH activity AS (
        SELECT user_id, to_timestamp(((max(appointment_id) >> 22) + ${epoch}::bigint)::float8 / 1000) AS at
        FROM user_appointments GROUP BY user_id
        UNION ALL
        SELECT user_id, created_at FROM user_active_tickets
      ), last AS (SELECT user_id, max(at) AS at FROM activity GROUP BY user_id)
      SELECT l.user_id AS "userId", l.at AS "lastActive"
      FROM last l
      JOIN users u ON u.id = l.user_id
      JOIN notification_preferences p ON p.user_id = l.user_id
      WHERE l.at BETWEEN ${from} AND ${to}
        AND u.deleted_at IS NULL AND u.status = 'active' AND u.managed_by_business_id IS NULL
        AND (p.suggestions OR p.marketing_emails)
      LIMIT ${CANDIDATES}`;

    let sent = 0;
    const keyOf = (r: { userId: bigint; lastActive: Date }) =>
      `suggest:comeback:${r.userId}:${Math.floor(r.lastActive.getTime() / DAY)}`;
    const done = await this.deps.scheduler.sentKeys(rows.map((r) => ({ userId: r.userId, key: keyOf(r) })));
    for (const r of rows) {
      if (budget.sends <= 0) break;
      const key = keyOf(r);
      if (done.has(`${r.userId}:${key}`)) continue;
      if (await this.busy(db, r.userId, now)) continue;
      const favourite = await this.favourite(db, r.userId);
      if (!favourite) continue;
      if (isQuietHour(now, favourite.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (!(await this.capsAllow(db, r.userId, settings, now))) continue;
      const message = suggest.comeBack(favourite);
      if (await this.send(key, 'suggest_comeback', r.userId, message, now)) {
        sent++;
        budget.sends--;
      }
    }
    return sent;
  }

  /** Where they went most (visits and served queue tickets) that still takes bookings, and their usual service. */
  private async favourite(db: UserShardClient, userId: bigint) {
    const visits = await db.userVisitOutcome.findMany({
      where: { userId, kind: 'visit' },
      select: { businessId: true, refId: true, source: true },
      take: 500,
    });
    const score = new Map<bigint, number>();
    for (const v of visits) score.set(v.businessId, (score.get(v.businessId) ?? 0) + 1);
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    for (const businessId of ranked) {
      const appointments = visits
        .filter((v) => v.businessId === businessId && v.source === 'appointment')
        .map((v) => v.refId);
      const place = await this.place(businessId, { usualOf: appointments });
      if (!place) continue;
      return {
        businessId: place.publicId,
        businessName: place.name,
        serviceId: place.service?.id.toString() ?? null,
        serviceName: place.service?.name ?? null,
        timezone: place.timezone,
      };
    }
    return null;
  }

  // ── New accounts that never booked ────────────────────────────────────────

  private async firstBookings(db: UserShardClient, now: Date, settings: Settings, budget: Budget) {
    const users = await db.user.findMany({
      where: {
        role: 'user',
        status: 'active',
        deletedAt: null,
        managedByBusinessId: null,
        createdAt: {
          gte: new Date(now.getTime() - RULES.firstBooking.untilDays * DAY),
          lte: new Date(now.getTime() - RULES.firstBooking.stepDays[0] * DAY),
        },
        appointments: { none: {} },
        activeTicket: { is: null },
        notificationPrefs: { OR: [{ suggestions: true }, { marketingEmails: true }] },
      },
      select: { id: true, createdAt: true, timezone: true },
      take: CANDIDATES,
    });
    let sent = 0;
    for (const u of users) {
      if (budget.sends <= 0) break;
      const marks = await db.notificationMark.findMany({
        where: { userId: u.id, key: { in: [`suggest:first:${u.id}:1`, `suggest:first:${u.id}:2`] } },
      });
      const step1 = marks.find((m) => m.key.endsWith(':1'));
      const step = firstBookingStep(u.createdAt, now, step1?.createdAt ?? null, marks.length === 2);
      if (!step) continue;
      if (isQuietHour(now, u.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (!(await this.capsAllow(db, u.id, settings, now))) continue;
      if (
        await this.send(
          `suggest:first:${u.id}:${step}`,
          'suggest_first_booking',
          u.id,
          suggest.firstBooking(step),
          now,
        )
      ) {
        sent++;
        budget.sends--;
      }
    }
    return sent;
  }

  // ── Shared checks ─────────────────────────────────────────────────────────

  private send(key: string, kind: string, userId: bigint, message: Message, now: Date) {
    return this.deps.scheduler.once(key, kind, [{ userId, message }], now);
  }

  /**
   * A business that still takes bookings, read on its shard, with the service to suggest: the one
   * of their last visit (and that visit's employee), or the one they had most of `usualOf`; it
   * must still be offered. Null if the business no longer takes bookings, or the last visit's
   * service is gone.
   */
  private async place(
    businessId: bigint,
    of: { lastAppointmentId?: bigint; usualOf?: bigint[] },
  ): Promise<Place | null> {
    return this.deps.plane
      .inBusiness(businessId, async (tx) => {
        const business = await tx.business.findFirst({
          where: { id: businessId, deletedAt: null, status: { in: [...BOOKABLE] } },
          select: { id: true, publicId: true, name: true, timezone: true },
        });
        if (!business) return null;
        let serviceId: bigint | null = null;
        let staffId: bigint | null = null;
        if (of.lastAppointmentId) {
          const last = await tx.appointment.findFirst({
            where: { id: of.lastAppointmentId },
            select: { serviceId: true, staffId: true },
          });
          if (!last) return null;
          ({ serviceId, staffId } = last);
        } else if (of.usualOf?.length) {
          const byService = await tx.appointment.groupBy({
            by: ['serviceId'],
            where: { id: { in: of.usualOf } },
            _count: { _all: true },
          });
          serviceId = byService.sort((a, b) => b._count._all - a._count._all)[0]?.serviceId ?? null;
        }
        const service = serviceId
          ? await tx.service.findFirst({
              where: { id: serviceId, businessId, isActive: true },
              select: { id: true, name: true },
            })
          : null;
        // Their last visit's service is gone: no suggestion about it.
        if (of.lastAppointmentId && !service) return null;
        const usualStaff =
          service && staffId
            ? await tx.staff.findFirst({
                where: {
                  id: staffId,
                  businessId,
                  isActive: true,
                  services: { some: { serviceId: service.id } },
                },
                select: { id: true, displayName: true },
              })
            : null;
        return {
          ...business,
          service,
          usualStaff: usualStaff && { id: usualStaff.id, name: usualStaff.displayName },
        };
      })
      .catch(() => null);
  }

  private async staffName(businessId: bigint, staffId: string): Promise<string | null> {
    if (!/^[1-9][0-9]{0,18}$/.test(staffId)) return null;
    const staff = await this.deps.plane
      .inBusiness(businessId, (tx) =>
        tx.staff.findFirst({ where: { id: BigInt(staffId), businessId }, select: { displayName: true } }),
      )
      .catch(() => null);
    return staff?.displayName ?? null;
  }

  /** Already booked (there, or anywhere), or waiting in a queue right now. */
  private async busy(db: UserShardClient, userId: bigint, now: Date, businessId?: bigint): Promise<boolean> {
    const upcoming = await db.userAppointment.count({
      where: {
        userId,
        status: { in: ['pending', 'confirmed'] },
        startAt: { gt: now },
        ...(businessId && { businessId }),
      },
    });
    if (upcoming) return true;
    const ticket = await db.userActiveTicket.findUnique({ where: { userId } });
    if (!ticket || (businessId && ticket.businessId !== businessId)) return false;
    const live = await this.deps.plane
      .inBusiness(ticket.businessId, (tx) =>
        tx.queueTicket.count({
          where: {
            id: ticket.ticketId,
            sessionDate: ticket.ticketSessionDate,
            status: { in: [...LIVE_TICKET] },
          },
        }),
      )
      .catch(() => 0);
    return live > 0;
  }

  private async capsAllow(db: UserShardClient, userId: bigint, settings: Settings, now: Date) {
    const suggestionMarks = { userId, kind: { startsWith: 'suggest_' } };
    const last = await db.notificationMark.findFirst({
      where: { ...suggestionMarks, createdAt: { lte: now } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const lastMonth = await db.notificationMark.count({
      where: { ...suggestionMarks, createdAt: { gt: new Date(now.getTime() - 30 * DAY), lte: now } },
    });
    // Their latest booking (its ID says when it was made) or queue join.
    const lastBooking = await db.userAppointment.findFirst({
      where: { userId },
      orderBy: { appointmentId: 'desc' },
      select: { appointmentId: true },
    });
    const lastQueue = await db.userActiveTicket.findUnique({
      where: { userId },
      select: { createdAt: true },
    });
    const lastActive = Math.max(
      lastBooking ? Number(lastBooking.appointmentId >> 22n) + ID_EPOCH_MS : 0,
      lastQueue?.createdAt.getTime() ?? 0,
    );
    const sinceBooking = await db.notificationMark.count({
      where: { ...suggestionMarks, createdAt: { gt: new Date(lastActive), lte: now } },
    });
    return capsAllow(
      { lastSentAt: last?.createdAt ?? null, sentLast30Days: lastMonth, sentSinceLastBooking: sinceBooking },
      settings,
      now,
    );
  }
}

interface Place {
  id: bigint;
  publicId: string;
  name: string;
  timezone: string;
  service: { id: bigint; name: string } | null;
  usualStaff: { id: bigint; name: string } | null;
}
