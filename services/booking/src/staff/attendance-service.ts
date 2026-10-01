import { AppError, can, ErrorCodes } from '@buku/common';
import {
  businessRoleOf,
  isUniqueViolation,
  recordAudit,
  requireBusinessPermission,
  type Database,
} from '@buku/database';
import { addDays, startOfDay, wallClock } from '../availability/time.js';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Employee shifts (decision C): clocking in and out. Everyone can clock
 * themselves; owner, manager and front desk can clock anyone (the shared
 * front-desk tablet). Managers correct mistakes (audited). At most one open
 * shift per person — the database guarantees it even if two devices clock in
 * at the same moment. Attendance doesn't change bookable times (those come
 * from working hours); it records who actually worked and who is in now.
 */

const MAX_SHIFT_MS = 24 * 3_600_000;

export class AttendanceService {
  constructor(private readonly db: Database) {}

  async clockIn(businessId: string, staffId: string, actorId: string, note: string | undefined) {
    await this.authorize(businessId, staffId, actorId);
    try {
      const shift = await this.db.staffAttendance.create({
        data: { businessId, staffId, checkInAt: new Date(), recordedById: actorId, note: note ?? null },
      });
      return shiftView(shift);
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('Already clocked in');
      throw err;
    }
  }

  async clockOut(businessId: string, staffId: string, actorId: string) {
    await this.authorize(businessId, staffId, actorId);
    const open = await this.db.staffAttendance.findFirst({
      where: { staffId, businessId, checkOutAt: null },
    });
    if (!open) throw AppError.conflict('Not clocked in');
    const now = new Date();
    if (now.getTime() - open.checkInAt.getTime() > MAX_SHIFT_MS) {
      throw AppError.conflict('This shift has been open for more than 24 hours; ask a manager to correct it');
    }
    const shift = await this.db.staffAttendance.update({
      where: { id: open.id },
      data: { checkOutAt: now, recordedById: actorId },
    });
    return shiftView(shift);
  }

  /** Shifts that started on a local date (default today). Employees without `attendance.manage` see their own. */
  async list(
    businessId: string,
    actorId: string,
    query: { date?: string | undefined; staffId?: string | undefined },
  ) {
    const role = await businessRoleOf(this.db, businessId, actorId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const { timezone } = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { timezone: true },
    });
    const date = query.date ?? wallClock(new Date(), timezone).date;
    const own = can(role, 'attendance.manage')
      ? undefined
      : (await this.db.staff.findMany({ where: { businessId, userId: actorId }, select: { id: true } })).map(
          (s) => s.id,
        );
    const shifts = await this.db.staffAttendance.findMany({
      where: {
        businessId,
        checkInAt: { gte: startOfDay(date, timezone), lt: startOfDay(addDays(date, 1), timezone) },
        ...(query.staffId && { staffId: query.staffId }),
        ...(own && { staffId: { in: own } }),
      },
      include: { staff: { select: { displayName: true } } },
      orderBy: { checkInAt: 'asc' },
    });
    return {
      date,
      timezone,
      items: shifts.map((s) => ({ ...shiftView(s), displayName: s.staff.displayName })),
    };
  }

  /** Who is in right now (for the front desk, and for the live queue in 2.4). */
  async present(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    const open = await this.db.staffAttendance.findMany({
      where: { businessId, checkOutAt: null },
      include: { staff: { select: { displayName: true } } },
      orderBy: { checkInAt: 'asc' },
    });
    return open.map((s) => ({
      staffId: s.staffId,
      displayName: s.staff.displayName,
      since: s.checkInAt.toISOString(),
    }));
  }

  /** A manager fixes a forgotten or wrong clock-in/out. Audited with the old and new times. */
  async correct(
    businessId: string,
    shiftId: string,
    actorId: string,
    changes: { checkInAt?: string | undefined; checkOutAt?: string | undefined; note?: string | undefined },
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'schedule.manage_all');
    const shift = await this.db.staffAttendance.findFirst({ where: { id: shiftId, businessId } });
    if (!shift) throw AppError.notFound('Shift');
    const checkInAt = changes.checkInAt ? new Date(changes.checkInAt) : shift.checkInAt;
    const checkOutAt = changes.checkOutAt ? new Date(changes.checkOutAt) : shift.checkOutAt;
    if (checkOutAt && checkOutAt <= checkInAt) throw AppError.badRequest('Clock-out must be after clock-in');
    if (checkOutAt && checkOutAt.getTime() - checkInAt.getTime() > MAX_SHIFT_MS) {
      throw AppError.badRequest('A shift can be at most 24 hours');
    }
    if (checkInAt > new Date() || (checkOutAt && checkOutAt > new Date())) {
      throw AppError.badRequest('Times can’t be in the future');
    }
    const updated = await this.db.$transaction(async (tx) => {
      const updated = await tx.staffAttendance.update({
        where: { id: shiftId },
        data: {
          checkInAt,
          checkOutAt,
          recordedById: actorId,
          ...(changes.note !== undefined && { note: changes.note }),
        },
      });
      await recordAudit(tx, {
        userId: actorId,
        action: 'booking.attendance_corrected',
        resourceType: 'staff_attendance',
        resourceId: shiftId,
        oldValues: {
          checkInAt: shift.checkInAt.toISOString(),
          checkOutAt: shift.checkOutAt?.toISOString() ?? null,
        },
        newValues: { checkInAt: checkInAt.toISOString(), checkOutAt: checkOutAt?.toISOString() ?? null },
        ...auditCtx(ctx),
      });
      return updated;
    });
    return shiftView(updated);
  }

  /** Clock yourself, or anyone if you run the front desk (or manage the business). */
  private async authorize(businessId: string, staffId: string, actorId: string) {
    const role = await businessRoleOf(this.db, businessId, actorId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const staff = await this.db.staff.findFirst({
      where: { id: staffId, businessId },
      select: { userId: true, isActive: true },
    });
    if (!staff) throw AppError.notFound('Staff member');
    if (!can(role, 'attendance.manage') && staff.userId !== actorId) {
      throw AppError.forbidden('You can only clock yourself in and out');
    }
    if (!staff.isActive) throw AppError.conflict('This staff profile is inactive');
  }
}

function shiftView(s: {
  id: string;
  staffId: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  note: string | null;
}) {
  return {
    id: s.id,
    staffId: s.staffId,
    checkInAt: s.checkInAt.toISOString(),
    checkOutAt: s.checkOutAt?.toISOString() ?? null,
    open: s.checkOutAt === null,
    /** Minutes worked (so far, if still open). */
    minutes: Math.round(((s.checkOutAt ?? new Date()).getTime() - s.checkInAt.getTime()) / 60_000),
    note: s.note,
  };
}
