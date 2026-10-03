import { AppError } from '@buku/common';
import { requireBusinessPermission, type Database } from '@buku/database';
import { addDays, startOfDay, wallClock } from '../availability/time.js';

/**
 * Cancellations and no-shows for a business (D-078): how many, why, when
 * (weekday and hour, in the business's timezone), for which services and
 * employees, and whether "remind me later" brought people back. Visits are
 * counted by when they were (or would have been), not when they were booked.
 * Moved bookings are counted once, at their new time.
 */

const MAX_DAYS = 366;

export class CancellationReport {
  constructor(private readonly db: Database) {}

  async build(
    businessId: string,
    actorId: string,
    query: { from?: string | undefined; to?: string | undefined },
    now = new Date(),
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'reports.view');
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const tz = business.timezone;
    const to = query.to ?? wallClock(now, tz).date;
    const from = query.from ?? addDays(to, -89);
    const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
    if (days < 1) throw AppError.badRequest('`from` must not be after `to`');
    if (days > MAX_DAYS) throw AppError.badRequest(`At most ${MAX_DAYS} days at a time`);
    const start = startOfDay(from, tz);
    const end = startOfDay(addDays(to, 1), tz);
    const scope = { businessId, startAt: { gte: start, lt: end }, status: { not: 'rescheduled' as const } };

    const [totals] = await this.db.$queryRaw<
      {
        booked: number;
        completed: number;
        upcoming: number;
        customer_cancels: number;
        late_cancels: number;
        business_cancels: number;
        declined: number;
        system_cancels: number;
        no_shows: number;
        moved: number;
      }[]
    >`
      SELECT
        count(*) FILTER (WHERE status <> 'rescheduled')::int AS booked,
        count(*) FILTER (WHERE status = 'completed' OR (status = 'confirmed' AND checked_in_at IS NOT NULL))::int AS completed,
        count(*) FILTER (WHERE status IN ('pending', 'confirmed') AND checked_in_at IS NULL AND start_at > ${now})::int AS upcoming,
        count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user')::int AS customer_cancels,
        count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user' AND late_cancellation)::int AS late_cancels,
        count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'business'
          AND cancel_reason_code IS DISTINCT FROM 'declined')::int AS business_cancels,
        count(*) FILTER (WHERE status = 'cancelled' AND cancel_reason_code = 'declined')::int AS declined,
        count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'system')::int AS system_cancels,
        count(*) FILTER (WHERE status = 'no_show')::int AS no_shows,
        count(*) FILTER (WHERE status = 'rescheduled')::int AS moved
      FROM appointments
      WHERE business_id = ${businessId}::uuid AND start_at >= ${start} AND start_at < ${end}`;

    const t = totals!;
    const pct = (n: number, d: number) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);

    const [byReason, byWeekday, byHour, byService, byStaff, weekly, rebook] = await Promise.all([
      this.db.appointment.groupBy({
        by: ['cancelReasonCode'],
        where: { ...scope, status: 'cancelled', cancelledBy: 'user' },
        _count: { _all: true },
      }),
      this.db.$queryRaw<{ dow: number; cancellations: number; no_shows: number }[]>`
        SELECT extract(dow FROM start_at AT TIME ZONE ${tz})::int AS dow,
          count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user')::int AS cancellations,
          count(*) FILTER (WHERE status = 'no_show')::int AS no_shows
        FROM appointments
        WHERE business_id = ${businessId}::uuid AND start_at >= ${start} AND start_at < ${end}
        GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<{ hour: number; cancellations: number; no_shows: number }[]>`
        SELECT extract(hour FROM start_at AT TIME ZONE ${tz})::int AS hour,
          count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user')::int AS cancellations,
          count(*) FILTER (WHERE status = 'no_show')::int AS no_shows
        FROM appointments
        WHERE business_id = ${businessId}::uuid AND start_at >= ${start} AND start_at < ${end}
        GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<
        { id: string; name: string; booked: number; cancellations: number; no_shows: number }[]
      >`
        SELECT s.id, s.name,
          count(*) FILTER (WHERE a.status <> 'rescheduled')::int AS booked,
          count(*) FILTER (WHERE a.status = 'cancelled' AND a.cancelled_by = 'user')::int AS cancellations,
          count(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows
        FROM appointments a JOIN services s ON s.id = a.service_id
        WHERE a.business_id = ${businessId}::uuid AND a.start_at >= ${start} AND a.start_at < ${end}
        GROUP BY s.id, s.name ORDER BY booked DESC, s.name LIMIT 20`,
      this.db.$queryRaw<
        { id: string; name: string; booked: number; cancellations: number; no_shows: number }[]
      >`
        SELECT st.id, st.display_name AS name,
          count(*) FILTER (WHERE a.status <> 'rescheduled')::int AS booked,
          count(*) FILTER (WHERE a.status = 'cancelled' AND a.cancelled_by = 'user')::int AS cancellations,
          count(*) FILTER (WHERE a.status = 'no_show')::int AS no_shows
        FROM appointments a JOIN staff st ON st.id = a.staff_id
        WHERE a.business_id = ${businessId}::uuid AND a.start_at >= ${start} AND a.start_at < ${end}
        GROUP BY st.id, st.display_name ORDER BY booked DESC, st.display_name LIMIT 50`,
      this.db.$queryRaw<{ week: string; booked: number; cancellations: number; no_shows: number }[]>`
        SELECT to_char(date_trunc('week', start_at AT TIME ZONE ${tz}), 'YYYY-MM-DD') AS week,
          count(*) FILTER (WHERE status <> 'rescheduled')::int AS booked,
          count(*) FILTER (WHERE status = 'cancelled' AND cancelled_by = 'user')::int AS cancellations,
          count(*) FILTER (WHERE status = 'no_show')::int AS no_shows
        FROM appointments
        WHERE business_id = ${businessId}::uuid AND start_at >= ${start} AND start_at < ${end}
        GROUP BY 1 ORDER BY 1`,
      this.db.$queryRaw<{ asked: number; came_back: number }[]>`
        SELECT count(*)::int AS asked,
          count(*) FILTER (WHERE EXISTS (
            SELECT 1 FROM appointments n
            WHERE n.business_id = a.business_id AND n.user_id = a.user_id
              AND n.created_at > a.cancelled_at AND n.status <> 'cancelled'))::int AS came_back
        FROM appointments a
        WHERE a.business_id = ${businessId}::uuid AND a.start_at >= ${start} AND a.start_at < ${end}
          AND a.status = 'cancelled' AND a.rebook_reminder_at IS NOT NULL`,
    ]);

    const decided = t.completed + t.no_shows;
    return {
      period: { from, to, timezone: tz },
      totals: {
        booked: t.booked,
        completed: t.completed,
        upcoming: t.upcoming,
        cancelledByCustomer: t.customer_cancels,
        lateCancellations: t.late_cancels,
        cancelledByBusiness: t.business_cancels,
        declined: t.declined,
        cancelledBySystem: t.system_cancels,
        noShows: t.no_shows,
        moved: t.moved,
      },
      /** Percentages with one decimal; null when there is nothing to divide by. */
      rates: {
        customerCancellation: pct(t.customer_cancels, t.booked),
        lateCancellation: pct(t.late_cancels, t.booked),
        noShow: pct(t.no_shows, decided),
        businessCancellation: pct(t.business_cancels, t.booked),
      },
      reasons: byReason
        .map((r) => ({ reason: r.cancelReasonCode ?? 'not_given', count: r._count._all }))
        .sort((a, b) => b.count - a.count),
      byWeekday: [0, 1, 2, 3, 4, 5, 6].map((dow) => {
        const r = byWeekday.find((x) => x.dow === dow);
        return { dayOfWeek: dow, cancellations: r?.cancellations ?? 0, noShows: r?.no_shows ?? 0 };
      }),
      byHour: byHour.map((r) => ({ hour: r.hour, cancellations: r.cancellations, noShows: r.no_shows })),
      byService: byService.map((r) => ({ ...rowView(r), name: r.name })),
      byStaff: byStaff.map((r) => ({ ...rowView(r), name: r.name })),
      weekly: weekly.map((w) => ({
        weekOf: w.week,
        booked: w.booked,
        cancellations: w.cancellations,
        noShows: w.no_shows,
      })),
      /** Customers who cancelled with "remind me later", and how many booked again here since. */
      rebookLater: {
        asked: rebook[0]?.asked ?? 0,
        bookedAgain: rebook[0]?.came_back ?? 0,
        rate: pct(rebook[0]?.came_back ?? 0, rebook[0]?.asked ?? 0),
      },
    };
  }
}

function rowView(r: { id: string; booked: number; cancellations: number; no_shows: number }) {
  return {
    id: r.id,
    booked: r.booked,
    cancellations: r.cancellations,
    noShows: r.no_shows,
    cancellationRate: r.booked ? Math.round((r.cancellations / r.booked) * 1000) / 10 : null,
  };
}
