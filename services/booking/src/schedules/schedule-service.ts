import { AppError, can, ErrorCodes, type Actor } from '@buku/common';
import {
  businessRoleOfActor,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { assertNotSuspended } from '../businesses.js';
import { announceListing } from '../listing.js';
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
 * managers manage everyone's (`schedule.manage_all`). All of it on the business's shard.
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
  constructor(private readonly plane: DataPlane) {}

  // ── Working hours ────────────────────────────────────────────────────────

  async getHours(businessId: bigint, staffId: bigint, actor: Actor): Promise<WeekDay[]> {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      await findStaff(tx, businessId, staffId);
      return hoursOf(tx, staffId);
    });
  }

  async setHours(
    businessId: bigint,
    staffId: bigint,
    actor: Actor,
    days: WeekDay[],
    ctx: RequestContext,
  ): Promise<WeekDay[]> {
    const seen = new Set<number>();
    for (const day of days) {
      if (seen.has(day.dayOfWeek)) throw AppError.badRequest(`Day ${day.dayOfWeek} is listed twice`);
      seen.add(day.dayOfWeek);
      assertNoOverlap(day.ranges, `day ${day.dayOfWeek}`);
    }
    return this.plane.inBusiness(businessId, async (tx) => {
      await authorizeFor(tx, businessId, staffId, actor);
      await tx.availabilityRule.deleteMany({ where: { businessId, staffId } });
      const rows = days.flatMap((d) =>
        d.ranges.map((r) => ({
          id: this.plane.id(),
          businessId,
          staffId,
          dayOfWeek: d.dayOfWeek,
          startTime: r.start,
          endTime: r.end,
        })),
      );
      if (rows.length) await tx.availabilityRule.createMany({ data: rows });
      await this.audit(tx, actor.id, 'booking.hours_updated', 'staff', staffId, ctx);
      return hoursOf(tx, staffId);
    });
  }

  // ── Time off / extra hours (one employee) ────────────────────────────────

  async listTimeOff(businessId: bigint, staffId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      await findStaff(tx, businessId, staffId);
      return upcoming(tx, businessId, staffId);
    });
  }

  async addTimeOff(
    businessId: bigint,
    staffId: bigint,
    actor: Actor,
    input: TimeOffInput,
    ctx: RequestContext,
  ) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await authorizeFor(tx, businessId, staffId, actor);
      await this.addExceptions(tx, businessId, staffId, input);
      await this.audit(tx, actor.id, `booking.${input.kind}_added`, 'staff', staffId, ctx);
      return upcoming(tx, businessId, staffId);
    });
  }

  async removeTimeOff(
    businessId: bigint,
    staffId: bigint,
    entryId: bigint,
    actor: Actor,
    ctx: RequestContext,
  ) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorizeFor(tx, businessId, staffId, actor);
      const { count } = await tx.availabilityException.deleteMany({
        where: { id: entryId, businessId, staffId },
      });
      if (count === 0) throw AppError.notFound('Time off');
      await this.audit(tx, actor.id, 'booking.time_off_removed', 'staff', staffId, ctx);
    });
  }

  // ── Business closures (everyone) ─────────────────────────────────────────

  async listClosures(businessId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return upcoming(tx, businessId, null);
    });
  }

  async addClosure(businessId: bigint, actor: Actor, input: Omit<TimeOffInput, 'kind'>, ctx: RequestContext) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'schedule.manage_all');
      await assertNotSuspended(tx, businessId);
      await this.addExceptions(tx, businessId, null, { ...input, kind: 'time_off' });
      await this.audit(tx, actor.id, 'booking.closure_added', 'business', businessId, ctx);
      await announceListing(tx, this.plane, businessId, 'closures');
      return upcoming(tx, businessId, null);
    });
  }

  async removeClosure(businessId: bigint, closureId: bigint, actor: Actor, ctx: RequestContext) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'schedule.manage_all');
      const { count } = await tx.availabilityException.deleteMany({
        where: { id: closureId, businessId, staffId: null },
      });
      if (count === 0) throw AppError.notFound('Closure');
      await this.audit(tx, actor.id, 'booking.closure_removed', 'business', businessId, ctx);
      await announceListing(tx, this.plane, businessId, 'closures');
    });
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async addExceptions(
    tx: BusinessTx,
    businessId: bigint,
    staffId: bigint | null,
    input: TimeOffInput,
  ) {
    const business = await tx.business.findUniqueOrThrow({
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

    await tx.availabilityException.createMany({
      data: dates.map((date) => ({
        id: this.plane.id(),
        businessId,
        staffId,
        exceptionDate: new Date(`${date}T00:00:00Z`),
        // A whole day off is a holiday, part of one a change to the day (the table's rule, D2b).
        type: input.kind === 'extra_hours' ? 'extra_hours' : partial ? 'modified' : 'holiday',
        startTime: input.startTime ?? null,
        endTime: input.endTime ?? null,
        reason: input.reason ?? null,
      })),
    });
  }

  private audit(
    tx: BusinessTx,
    userId: bigint,
    action: string,
    resourceType: string,
    resourceId: bigint,
    ctx: RequestContext,
  ) {
    return recordShardAudit(tx, this.plane.id(), {
      userId,
      action,
      resourceType,
      resourceId,
      ...auditCtx(ctx),
    });
  }
}

async function hoursOf(tx: BusinessTx, staffId: bigint): Promise<WeekDay[]> {
  const rules = await tx.availabilityRule.findMany({
    where: { staffId, isActive: true },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  });
  const days = new Map<number, TimeRange[]>();
  for (const r of rules)
    days.set(r.dayOfWeek, [...(days.get(r.dayOfWeek) ?? []), { start: r.startTime, end: r.endTime }]);
  return [...days.entries()].map(([dayOfWeek, ranges]) => ({ dayOfWeek, ranges }));
}

async function upcoming(tx: BusinessTx, businessId: bigint, staffId: bigint | null) {
  const business = await tx.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { timezone: true },
  });
  const rows = await tx.availabilityException.findMany({
    where: {
      businessId,
      staffId,
      exceptionDate: { gte: new Date(`${todayIn(business.timezone)}T00:00:00Z`) },
    },
    orderBy: [{ exceptionDate: 'asc' }, { startTime: 'asc' }],
  });
  return rows.map((r) => ({
    id: r.id.toString(),
    date: r.exceptionDate.toISOString().slice(0, 10),
    kind: r.type === 'extra_hours' ? 'extra_hours' : 'time_off',
    startTime: r.startTime,
    endTime: r.endTime,
    reason: r.reason,
  }));
}

/** Managers and owners: anyone's schedule. Everyone else: only their own. */
async function authorizeFor(tx: BusinessTx, businessId: bigint, staffId: bigint, actor: Actor) {
  const role = await businessRoleOfActor(tx, businessId, actor);
  if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  const staff = await findStaff(tx, businessId, staffId);
  await assertNotSuspended(tx, businessId);
  if (can(role, 'schedule.manage_all')) return staff;
  if (can(role, 'schedule.manage_own') && staff.userId === actor.id) return staff;
  throw AppError.forbidden('You can only change your own schedule');
}

async function findStaff(tx: BusinessTx, businessId: bigint, staffId: bigint) {
  const staff = await tx.staff.findFirst({
    where: { id: staffId, businessId },
    select: { id: true, userId: true },
  });
  if (!staff) throw AppError.notFound('Staff member');
  return staff;
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
