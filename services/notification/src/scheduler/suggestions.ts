import type { Database } from '@buku/database';
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
 */

const DAY = 86_400_000;
/** Per run: keep well under booking-service's availability rate limit. */
const MAX_LOOKUPS = 30;
const MAX_SENDS = 500;
const CANDIDATES = 2000;
const LIVE_TICKET = ['waiting', 'called', 'serving'] as const;

export interface SuggestionCounts {
  usual: number;
  comeBack: number;
  firstBooking: number;
}

export class Suggestions {
  constructor(
    private readonly deps: {
      db: Database;
      settings: NotificationSettings;
      scheduler: Scheduler;
      openings: OpeningsFinder;
    },
  ) {}

  async run(now = new Date()): Promise<SuggestionCounts> {
    const counts: SuggestionCounts = { usual: 0, comeBack: 0, firstBooking: 0 };
    const settings = await this.deps.settings.get();
    if (!settings.suggestionsEnabled || settings.suggestionMaxPer30Days === 0) return counts;
    const budget = { sends: MAX_SENDS, lookups: MAX_LOOKUPS };
    counts.usual = await this.regulars(now, settings, budget);
    counts.comeBack = await this.comeBacks(now, settings, budget);
    counts.firstBooking = await this.firstBookings(now, settings, budget);
    return counts;
  }

  // ── Regulars whose usual visit is due ─────────────────────────────────────

  private async regulars(now: Date, settings: Settings, budget: { sends: number; lookups: number }) {
    const since = new Date(now.getTime() - RULES.regular.lookbackDays * DAY);
    const minGap = new Date(now.getTime() - RULES.regular.minEveryDays * RULES.regular.dueAt * DAY);
    const rows = await this.deps.db.$queryRaw<
      {
        userId: string;
        businessId: string;
        visits: Date[];
        lastId: string;
        serviceId: string;
        staffId: string | null;
      }[]
    >`
      SELECT a.user_id AS "userId", a.business_id AS "businessId",
             array_agg(a.start_at ORDER BY a.start_at) AS visits,
             (array_agg(a.id ORDER BY a.start_at DESC))[1] AS "lastId",
             (array_agg(a.service_id ORDER BY a.start_at DESC))[1] AS "serviceId",
             (array_agg(a.staff_id ORDER BY a.start_at DESC))[1] AS "staffId"
      FROM appointments a
      JOIN users u ON u.id = a.user_id
      JOIN notification_preferences p ON p.user_id = a.user_id
      WHERE (a.status = 'completed' OR (a.status = 'confirmed' AND a.checked_in_at IS NOT NULL))
        AND a.start_at > ${since} AND a.start_at <= ${now}
        AND u.deleted_at IS NULL AND u.status = 'active' AND u.managed_by_business_id IS NULL
        AND (p.suggestions OR p.marketing_emails)
      GROUP BY a.user_id, a.business_id
      HAVING count(*) >= ${RULES.regular.minVisits} AND max(a.start_at) < ${minGap}
      LIMIT ${CANDIDATES}`;

    let sent = 0;
    const done = await this.sentKeys(rows.map((r) => `suggest:usual:${r.lastId}`));
    for (const r of rows) {
      if (budget.sends <= 0) break;
      const key = `suggest:usual:${r.lastId}`;
      if (done.has(key)) continue;
      const every = everyDays(r.visits);
      const last = r.visits.at(-1)!;
      if (every === null || usualDue(last, every, now) !== 'due') continue;

      const place = await this.bookable(r.businessId, r.serviceId);
      if (!place) continue;
      if (isQuietHour(now, place.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (await this.busyAt(r.userId, r.businessId, now)) continue;
      if (!(await this.capsAllow(r.userId, settings, now))) continue;

      const opening =
        budget.lookups > 0
          ? await this.findOpening(r, place.timezone, dueDate(last, every), now, budget)
          : null;
      const message = suggest.usual({
        businessId: r.businessId,
        businessName: place.name,
        serviceId: r.serviceId,
        serviceName: place.serviceName ?? '',
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
    r: { businessId: string; serviceId: string; staffId: string | null; visits: Date[] },
    timezone: string,
    due: Date,
    now: Date,
    budget: { lookups: number },
  ): Promise<Opening | null> {
    const from = new Date(Math.max(now.getTime(), due.getTime()));
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(from);
    const usual = usualMinuteOfDay(r.visits, timezone);
    const staffActive = r.staffId
      ? await this.deps.db.staffService.count({
          where: { staffId: r.staffId, serviceId: r.serviceId, staff: { isActive: true } },
        })
      : 0;
    const attempts = staffActive ? [r.staffId!, undefined] : [undefined];
    for (const staffId of attempts) {
      if (budget.lookups <= 0) return null;
      budget.lookups--;
      const slots = await this.deps.openings.find({
        businessId: r.businessId,
        serviceId: r.serviceId,
        date,
        days: 7,
        staffId,
      });
      if (slots === null) return null; // booking-service unavailable: don't keep asking
      const future = slots.filter((s) => s.startAt.getTime() > now.getTime() + 2 * 3_600_000);
      const slot = pickOpening(future, usual, timezone);
      if (!slot) continue;
      const chosen = staffId ?? slot.staffIds[0] ?? null;
      const staff = chosen
        ? await this.deps.db.staff.findUnique({ where: { id: chosen }, select: { displayName: true } })
        : null;
      return { startAt: slot.startAt, staffId: chosen, staffName: staff?.displayName ?? null };
    }
    return null;
  }

  // ── People who stopped coming ─────────────────────────────────────────────

  private async comeBacks(now: Date, settings: Settings, budget: { sends: number }) {
    const from = new Date(now.getTime() - RULES.comeBack.untilDays * DAY);
    const to = new Date(now.getTime() - RULES.comeBack.afterDays * DAY);
    // Last booking (of any outcome) or queue join: any of them means they were active.
    const rows = await this.deps.db.$queryRaw<{ userId: string; lastActive: Date }[]>`
      WITH activity AS (
        SELECT user_id, max(created_at) AS at FROM appointments GROUP BY user_id
        UNION ALL
        SELECT user_id, max(joined_at) FROM queue_entries WHERE user_id IS NOT NULL GROUP BY user_id
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
    const keyOf = (r: { userId: string; lastActive: Date }) =>
      `suggest:comeback:${r.userId}:${Math.floor(r.lastActive.getTime() / DAY)}`;
    const done = await this.sentKeys(rows.map(keyOf));
    for (const r of rows) {
      if (budget.sends <= 0) break;
      const key = keyOf(r);
      if (done.has(key)) continue;
      if (await this.busyAnywhere(r.userId, now)) continue;
      const favourite = await this.favourite(r.userId);
      if (!favourite) continue;
      if (isQuietHour(now, favourite.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (!(await this.capsAllow(r.userId, settings, now))) continue;
      const message = suggest.comeBack(favourite);
      if (await this.send(key, 'suggest_comeback', r.userId, message, now)) {
        sent++;
        budget.sends--;
      }
    }
    return sent;
  }

  /** Where they went most (completed visits) that still takes bookings, and their usual service there. */
  private async favourite(userId: string) {
    const visits = await this.deps.db.appointment.groupBy({
      by: ['businessId', 'serviceId'],
      where: {
        userId,
        OR: [{ status: 'completed' }, { status: 'confirmed', checkedInAt: { not: null } }],
      },
      _count: { _all: true },
    });
    const queues = await this.deps.db.queueEntry.findMany({
      where: { userId, status: 'completed' },
      select: { session: { select: { businessId: true } } },
      take: 200,
    });
    const score = new Map<string, number>();
    for (const v of visits) score.set(v.businessId, (score.get(v.businessId) ?? 0) + v._count._all);
    for (const q of queues) score.set(q.session.businessId, (score.get(q.session.businessId) ?? 0) + 1);
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    for (const businessId of ranked) {
      const usual = visits
        .filter((v) => v.businessId === businessId)
        .sort((a, b) => b._count._all - a._count._all)[0];
      // Their usual service if it's still offered; otherwise just the place.
      const withService = usual ? await this.bookable(businessId, usual.serviceId) : null;
      const place = withService ?? (await this.bookable(businessId, null));
      if (!place) continue;
      return {
        businessId,
        businessName: place.name,
        serviceId: withService ? usual!.serviceId : null,
        serviceName: withService ? place.serviceName : null,
        timezone: place.timezone,
      };
    }
    return null;
  }

  // ── New accounts that never booked ────────────────────────────────────────

  private async firstBookings(now: Date, settings: Settings, budget: { sends: number }) {
    const users = await this.deps.db.user.findMany({
      where: {
        role: 'user',
        status: 'active',
        managedByBusinessId: null,
        createdAt: {
          gte: new Date(now.getTime() - RULES.firstBooking.untilDays * DAY),
          lte: new Date(now.getTime() - RULES.firstBooking.stepDays[0] * DAY),
        },
        appointments: { none: {} },
        queueEntries: { none: {} },
        notificationPrefs: { OR: [{ suggestions: true }, { marketingEmails: true }] },
      },
      select: { id: true, createdAt: true, timezone: true },
      take: CANDIDATES,
    });
    let sent = 0;
    for (const u of users) {
      if (budget.sends <= 0) break;
      const marks = await this.deps.db.notificationMark.findMany({
        where: { key: { in: [`suggest:first:${u.id}:1`, `suggest:first:${u.id}:2`] } },
      });
      const step1 = marks.find((m) => m.key.endsWith(':1'));
      const step = firstBookingStep(u.createdAt, now, step1?.createdAt ?? null, marks.length === 2);
      if (!step) continue;
      if (isQuietHour(now, u.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      if (!(await this.capsAllow(u.id, settings, now))) continue;
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

  private send(key: string, kind: string, userId: string, message: Message, now: Date) {
    return this.deps.scheduler.once(key, kind, userId, [{ userId, message }], now);
  }

  private async sentKeys(keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const rows = await this.deps.db.notificationMark.findMany({
      where: { key: { in: keys } },
      select: { key: true },
    });
    return new Set(rows.map((r) => r.key));
  }

  /** The business still takes bookings (and the service, if given, is still offered). */
  private async bookable(businessId: string, serviceId: string | null) {
    const business = await this.deps.db.business.findFirst({
      where: { id: businessId, deletedAt: null, status: { in: ['pending', 'verified'] } },
      select: { name: true, timezone: true },
    });
    if (!business) return null;
    const service = serviceId
      ? await this.deps.db.service.findFirst({
          where: { id: serviceId, businessId, isActive: true },
          select: { name: true },
        })
      : null;
    if (serviceId && !service) return null;
    return { name: business.name, timezone: business.timezone, serviceName: service?.name ?? null };
  }

  /** Already booked there, or waiting in its queue right now. */
  private async busyAt(userId: string, businessId: string, now: Date): Promise<boolean> {
    const [upcoming, inQueue] = await Promise.all([
      this.deps.db.appointment.count({
        where: { userId, businessId, status: { in: ['pending', 'confirmed'] }, startAt: { gt: now } },
      }),
      this.deps.db.queueEntry.count({
        where: { userId, status: { in: [...LIVE_TICKET] }, session: { businessId } },
      }),
    ]);
    return upcoming + inQueue > 0;
  }

  private async busyAnywhere(userId: string, now: Date): Promise<boolean> {
    const [upcoming, inQueue] = await Promise.all([
      this.deps.db.appointment.count({
        where: { userId, status: { in: ['pending', 'confirmed'] }, startAt: { gt: now } },
      }),
      this.deps.db.queueEntry.count({ where: { userId, status: { in: [...LIVE_TICKET] } } }),
    ]);
    return upcoming + inQueue > 0;
  }

  private async capsAllow(userId: string, settings: Settings, now: Date): Promise<boolean> {
    const suggestionMarks = { userId, kind: { startsWith: 'suggest_' } };
    const [last, lastMonth, lastBooking, lastQueue] = await Promise.all([
      this.deps.db.notificationMark.findFirst({
        where: { ...suggestionMarks, createdAt: { lte: now } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.deps.db.notificationMark.count({
        where: { ...suggestionMarks, createdAt: { gt: new Date(now.getTime() - 30 * DAY), lte: now } },
      }),
      this.deps.db.appointment.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
      this.deps.db.queueEntry.findFirst({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        select: { joinedAt: true },
      }),
    ]);
    const lastActive = Math.max(lastBooking?.createdAt.getTime() ?? 0, lastQueue?.joinedAt.getTime() ?? 0);
    const sinceBooking = await this.deps.db.notificationMark.count({
      where: { ...suggestionMarks, createdAt: { gt: new Date(lastActive), lte: now } },
    });
    return capsAllow(
      { lastSentAt: last?.createdAt ?? null, sentLast30Days: lastMonth, sentSinceLastBooking: sinceBooking },
      settings,
      now,
    );
  }
}
