import { AppError, can, ErrorCodes } from '@buku/common';
import {
  businessRoleOf,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import { assertNotSuspended } from '../businesses.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * When people work (decision C: bookable slots come from working hours).
 *
 *  • Working hours: per employee, per weekday, up to 4 ranges a day
 *    ("09:00–13:00, 14:00–18:00"), in the business's timezone.
 *  • Time off: whole days (holidays, several days at once) or part of a day.
 *  • Extra hours: an additional working range on one date.
 *  • Closures: the whole business, e.g. a public holiday.
 *
 * Employees manage their OWN schedule (`schedule.manage_own`); owners and
 * managers manage everyone's (`schedule.manage_all`).
 */

export interface TimeRange {
  start: string;
  end: string;
}

export interface WeekDay {
  dayOfWeek: number; // 0 = Sunday … 6 = Saturday
  ranges: TimeRange[];
}

export interface TimeOffInput {
  kind: 'time_off' | 'extra_hours';
  /** First day, YYYY-MM-DD in the business's timezone. */
  from: string;
  /** Last day (inclusive). Defaults to `from`. Whole days only when it differs from `from`. */
  to?: string | undefined;
  startTime?: string | undefined;
  endTime?: string | undefined;
  reason?: string | undefined;
}

const MAX_DAYS_AT_ONCE = 62;

export class ScheduleService {
  constructor(private readonly db: Database) {}

  // ── Working hours ────────────────────────────────────────────────────────

  async getHours(businessId: string, staffId: string, actorId: string): Promise<WeekDay[]> {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    await this.findStaff(businessId, staffId);
    return this.hoursOf(staffId);
  }

  async setHours(
    businessId: string,
    staffId: string,
    actorId: string,
    days: WeekDay[],
    ctx: RequestContext,
  ): Promise<WeekDay[]> {
    await this.authorizeFor(businessId, staffId, actorId);
    const seen = new Set<number>();
    for (const day of days) {
      if (seen.has(day.dayOfWeek)) throw AppError.badRequest(`Day ${day.dayOfWeek} is listed twice`);
      seen.add(day.dayOfWeek);
      assertNoOverlap(day.ranges, `day ${day.dayOfWeek}`);
    }
    await this.db.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { businessId, staffId } });
      const rows = days.flatMap((d) =>
        d.ranges.map((r) => ({
          businessId,
          staffId,
          dayOfWeek: d.dayOfWeek,
          startTime: r.start,
          endTime: r.end,
        })),
      );
      if (rows.length) await tx.availabilityRule.createMany({ data: rows });
      await this.audit(tx, actorId, 'booking.hours_updated', 'staff', staffId, ctx);
    });
    return this.hoursOf(staffId);
  }

  // ── Time off / extra hours (one employee) ────────────────────────────────

  async listTimeOff(businessId: string, staffId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    await this.findStaff(businessId, staffId);
    return this.upcoming(businessId, staffId);
  }

  async addTimeOff(
    businessId: string,
    staffId: string,
    actorId: string,
    input: TimeOffInput,
    ctx: RequestContext,
  ) {
    await this.authorizeFor(businessId, staffId, actorId);
    await this.addExceptions(businessId, staffId, input);
    await this.audit(this.db, actorId, `booking.${input.kind}_added`, 'staff', staffId, ctx);
    return this.upcoming(businessId, staffId);
  }

  async removeTimeOff(
    businessId: string,
    staffId: string,
    entryId: string,
    actorId: string,
    ctx: RequestContext,
  ) {
    await this.authorizeFor(businessId, staffId, actorId);
    const { count } = await this.db.availabilityException.deleteMany({
      where: { id: entryId, businessId, staffId },
    });
    if (count === 0) throw AppError.notFound('Time off');
    await this.audit(this.db, actorId, 'booking.time_off_removed', 'staff', staffId, ctx);
  }

  // ── Business closures (everyone) ─────────────────────────────────────────

  async listClosures(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    return this.upcoming(businessId, null);
  }

  async addClosure(
    businessId: string,
    actorId: string,
    input: Omit<TimeOffInput, 'kind'>,
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'schedule.manage_all');
    await assertNotSuspended(this.db, businessId);
    await this.addExceptions(businessId, null, { ...input, kind: 'time_off' });
    await this.audit(this.db, actorId, 'booking.closure_added', 'business', businessId, ctx);
    return this.upcoming(businessId, null);
  }

  async removeClosure(businessId: string, closureId: string, actorId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, actorId, 'schedule.manage_all');
    const { count } = await this.db.availabilityException.deleteMany({
      where: { id: closureId, businessId, staffId: null },
    });
    if (count === 0) throw AppError.notFound('Closure');
    await this.audit(this.db, actorId, 'booking.closure_removed', 'business', businessId, ctx);
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async hoursOf(staffId: string): Promise<WeekDay[]> {
    const rules = await this.db.availabilityRule.findMany({
      where: { staffId, isActive: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
    });
    const days = new Map<number, TimeRange[]>();
    for (const r of rules)
      days.set(r.dayOfWeek, [...(days.get(r.dayOfWeek) ?? []), { start: r.startTime, end: r.endTime }]);
    return [...days.entries()].map(([dayOfWeek, ranges]) => ({ dayOfWeek, ranges }));
  }

  private async addExceptions(businessId: string, staffId: string | null, input: TimeOffInput) {
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const to = input.to ?? input.from;
    if (to < input.from) throw AppError.badRequest('`to` must not be before `from`');
    if (input.from < todayIn(business.timezone))
      throw AppError.badRequest('Dates in the past cannot be changed');
    const dates = datesBetween(input.from, to);
    if (dates.length > MAX_DAYS_AT_ONCE)
      throw AppError.badRequest(`At most ${MAX_DAYS_AT_ONCE} days at once`);

    const partial = input.startTime !== undefined || input.endTime !== undefined;
    if (partial) {
      if (!input.startTime || !input.endTime) throw AppError.badRequest('Give both startTime and endTime');
      if (input.startTime >= input.endTime) throw AppError.badRequest('startTime must be before endTime');
      if (dates.length > 1) throw AppError.badRequest('Part of a day can only be given for a single date');
    }
    if (input.kind === 'extra_hours' && (!partial || dates.length > 1)) {
      throw AppError.badRequest('Extra hours need one date with startTime and endTime');
    }

    await this.db.availabilityException.createMany({
      data: dates.map((date) => ({
        businessId,
        staffId,
        exceptionDate: new Date(`${date}T00:00:00Z`),
        type: input.kind === 'extra_hours' ? ('extra_hours' as const) : ('holiday' as const),
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        reason: input.reason ?? null,
      })),
    });
  }

  private async upcoming(businessId: string, staffId: string | null) {
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const rows = await this.db.availabilityException.findMany({
      where: {
        businessId,
        staffId,
        exceptionDate: { gte: new Date(`${todayIn(business.timezone)}T00:00:00Z`) },
      },
      orderBy: [{ exceptionDate: 'asc' }, { startTime: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      date: r.exceptionDate.toISOString().slice(0, 10),
      kind: r.type === 'extra_hours' ? 'extra_hours' : 'time_off',
      startTime: r.startTime,
      endTime: r.endTime,
      reason: r.reason,
    }));
  }

  /** Managers and owners: anyone's schedule. Everyone else: only their own. */
  private async authorizeFor(businessId: string, staffId: string, actorId: string) {
    const role = await businessRoleOf(this.db, businessId, actorId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const staff = await this.findStaff(businessId, staffId);
    await assertNotSuspended(this.db, businessId);
    if (can(role, 'schedule.manage_all')) return staff;
    if (can(role, 'schedule.manage_own') && staff.userId === actorId) return staff;
    throw AppError.forbidden('You can only change your own schedule');
  }

  private async findStaff(businessId: string, staffId: string) {
    const staff = await this.db.staff.findFirst({
      where: { id: staffId, businessId },
      select: { id: true, userId: true },
    });
    if (!staff) throw AppError.notFound('Staff member');
    return staff;
  }

  private audit(
    db: Database | Transaction,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    ctx: RequestContext,
  ) {
    return recordAudit(db, { userId, action, resourceType, resourceId, ...auditCtx(ctx) });
  }
}

function assertNoOverlap(ranges: TimeRange[], where: string) {
  const sorted = [...ranges].sort((a, b) => a.start.localeCompare(b.start));
  for (const [i, r] of sorted.entries()) {
    if (r.start >= r.end) throw AppError.badRequest(`${where}: ${r.start}–${r.end} ends before it starts`);
    const next = sorted[i + 1];
    if (next && next.start < r.end)
      throw AppError.badRequest(`${where}: ${r.start}–${r.end} overlaps ${next.start}–${next.end}`);
  }
}

/** Today's date (YYYY-MM-DD) where the business is. */
export function todayIn(timezone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let d = new Date(`${from}T00:00:00Z`);
    d <= new Date(`${to}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    out.push(d.toISOString().slice(0, 10));
    if (out.length > MAX_DAYS_AT_ONCE) break;
  }
  return out;
}
