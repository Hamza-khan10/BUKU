import { AppError, can, ErrorCodes, type Actor } from '@buku/common';
import {
  businessRoleOfActor,
  isUniqueViolation,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { addDays, startOfDay, wallClock } from '../availability/time.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Employee shifts (decision C): clocking in and out. Everyone can clock
 * themselves; owner, manager and front desk can clock anyone (the shared
 * front-desk tablet). Managers correct mistakes (audited). At most one open
 * shift per person — the database guarantees it even if two devices clock in
 * at the same moment (the open shift is kept by a trigger, keyed by the employee). Attendance
 * doesn't change bookable times (those come from working hours); it records who actually worked
 * and who is in now. Shifts are partitioned by when they started (DB-006).
 */

const MAX_SHIFT_MS = 24 * 3_600_000;

type ShiftRow = {
  id: bigint;
  staffId: bigint;
  startedAt: Date;
  endedAt: Date | null;
  note: string | null;
};

export class AttendanceService {
  constructor(private readonly plane: DataPlane) {}

  async clockIn(businessId: bigint, staffId: bigint, actor: Actor, note: string | undefined) {
    try {
      return await this.plane.inBusiness(businessId, async (tx) => {
        await authorize(tx, businessId, staffId, actor);
        const shift = await tx.staffShift.create({
          data: {
            id: this.plane.id(),
            businessId,
            staffId,
            startedAt: new Date(),
            recordedById: actor.id,
            note: note ?? null,
          },
        });
        return shiftView(shift);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('Already clocked in');
      throw err;
    }
  }

  async clockOut(businessId: bigint, staffId: bigint, actor: Actor) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, staffId, actor);
      const open = await tx.staffOpenShift.findUnique({
        where: { staffId_businessId: { staffId, businessId } },
      });
      if (!open) throw AppError.conflict('Not clocked in');
      const now = new Date();
      if (now.getTime() - open.startedAt.getTime() > MAX_SHIFT_MS) {
        throw AppError.conflict(
          'This shift has been open for more than 24 hours; ask a manager to correct it',
        );
      }
      const shift = await tx.staffShift.update({
        where: { id_startedAt: { id: open.shiftId, startedAt: open.startedAt } },
        data: { endedAt: now, recordedById: actor.id },
      });
      return shiftView(shift);
    });
  }

  /** Shifts that started on a local date (default today). Employees without `attendance.manage` see their own. */
  async list(
    businessId: bigint,
    actor: Actor,
    query: { date?: string | undefined; staffId?: bigint | undefined },
  ) {
    return this.plane.inBusiness(businessId, async (tx) => {
      const role = await businessRoleOfActor(tx, businessId, actor);
      if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      const { timezone } = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { timezone: true },
      });
      const date = query.date ?? wallClock(new Date(), timezone).date;
      const own = can(role, 'attendance.manage')
        ? undefined
        : (await tx.staff.findMany({ where: { businessId, userId: actor.id }, select: { id: true } })).map(
            (s) => s.id,
          );
      const shifts = await tx.staffShift.findMany({
        where: {
          businessId,
          startedAt: { gte: startOfDay(date, timezone), lt: startOfDay(addDays(date, 1), timezone) },
          ...(query.staffId && { staffId: query.staffId }),
          ...(own && { staffId: { in: own } }),
        },
        include: { staff: { select: { displayName: true } } },
        orderBy: { startedAt: 'asc' },
      });
      return {
        date,
        timezone,
        items: shifts.map((s) => ({ ...shiftView(s), displayName: s.staff.displayName })),
      };
    });
  }

  /** Who is in right now (for the front desk, and for the live queue). */
  async present(businessId: bigint, actor: Actor) {
    const open = await this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return tx.staffOpenShift.findMany({
        where: { businessId },
        include: { staff: { select: { displayName: true } } },
        orderBy: { startedAt: 'asc' },
      });
    });
    return open.map((s) => ({
      staffId: s.staffId.toString(),
      displayName: s.staff.displayName,
      since: s.startedAt.toISOString(),
    }));
  }

  /** A manager fixes a forgotten or wrong clock-in/out. Audited with the old and new times. */
  async correct(
    businessId: bigint,
    shiftId: bigint,
    actor: Actor,
    changes: { checkInAt?: string | undefined; checkOutAt?: string | undefined; note?: string | undefined },
    ctx: RequestContext,
  ) {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'schedule.manage_all');
      const shift = await tx.staffShift.findFirst({ where: { id: shiftId, businessId } });
      if (!shift) throw AppError.notFound('Shift');
      const startedAt = changes.checkInAt ? new Date(changes.checkInAt) : shift.startedAt;
      const endedAt = changes.checkOutAt ? new Date(changes.checkOutAt) : shift.endedAt;
      if (endedAt && endedAt <= startedAt) throw AppError.badRequest('Clock-out must be after clock-in');
      if (endedAt && endedAt.getTime() - startedAt.getTime() > MAX_SHIFT_MS) {
        throw AppError.badRequest('A shift can be at most 24 hours');
      }
      if (startedAt > new Date() || (endedAt && endedAt > new Date())) {
        throw AppError.badRequest('Times can’t be in the future');
      }
      const updated = await tx.staffShift.update({
        where: { id_startedAt: { id: shiftId, startedAt: shift.startedAt } },
        data: {
          startedAt,
          endedAt,
          recordedById: actor.id,
          ...(changes.note !== undefined && { note: changes.note }),
        },
      });
      await recordShardAudit(tx, this.plane.id(), {
        userId: actor.id,
        action: 'booking.attendance_corrected',
        resourceType: 'staff_attendance',
        resourceId: shiftId,
        oldValues: {
          checkInAt: shift.startedAt.toISOString(),
          checkOutAt: shift.endedAt?.toISOString() ?? null,
        },
        newValues: { checkInAt: startedAt.toISOString(), checkOutAt: endedAt?.toISOString() ?? null },
        ...auditCtx(ctx),
      });
      return shiftView(updated);
    });
  }
}

/** Clock yourself, or anyone if you run the front desk (or manage the business). */
async function authorize(tx: BusinessTx, businessId: bigint, staffId: bigint, actor: Actor) {
  const role = await businessRoleOfActor(tx, businessId, actor);
  if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
  const staff = await tx.staff.findFirst({
    where: { id: staffId, businessId },
    select: { userId: true, isActive: true },
  });
  if (!staff) throw AppError.notFound('Staff member');
  if (!can(role, 'attendance.manage') && staff.userId !== actor.id) {
    throw AppError.forbidden('You can only clock yourself in and out');
  }
  if (!staff.isActive) throw AppError.conflict('This staff profile is inactive');
}

function shiftView(s: ShiftRow) {
  return {
    id: s.id.toString(),
    staffId: s.staffId.toString(),
    checkInAt: s.startedAt.toISOString(),
    checkOutAt: s.endedAt?.toISOString() ?? null,
    open: s.endedAt === null,
    /** Minutes worked (so far, if still open). */
    minutes: Math.round(((s.endedAt ?? new Date()).getTime() - s.startedAt.getTime()) / 60_000),
    note: s.note,
  };
}
