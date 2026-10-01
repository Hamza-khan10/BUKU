import { AppError, ErrorCodes } from '@buku/common';
import type { Database } from '@buku/database';
import { findBookableBusiness } from '../businesses.js';
import type { SettingsService } from '../settings/settings-service.js';
import {
  computeSlots,
  type DateException,
  type LocalRange,
  type Slot,
  type StaffSchedule,
} from './engine.js';
import { addDays, startOfDay, wallClock } from './time.js';

/**
 * Loads what the slot calculator needs (staff who perform the service,
 * their hours, time off, closures, existing appointments, booking settings)
 * and runs it. The same code answers "what's free?" and checks a booking.
 */

const LIVE = ['pending', 'confirmed'] as const;
const MAX_DAYS = 14;

export interface BusinessRef {
  id: string;
  timezone: string;
}

export interface ServiceRef {
  id: string;
  durationMinutes: number;
  bufferMinutes: number;
}

export interface SlotOptions {
  staffId?: string | undefined;
  /** Ignore this appointment's own time (when rescheduling it). */
  excludeAppointmentId?: string | undefined;
  now?: Date;
}

export class AvailabilityService {
  constructor(
    private readonly db: Database,
    private readonly settings: SettingsService,
  ) {}

  /** Public: free start times for a service, for `days` days from `date`. */
  async publicAvailability(
    idOrSlug: string,
    input: { serviceId: string; date: string; days: number; staffId?: string | undefined },
  ) {
    const business = await findBookableBusiness(this.db, idOrSlug);
    const service = await this.activeService(business.id, input.serviceId);
    const days = Math.min(input.days, MAX_DAYS);
    const dates = Array.from({ length: days }, (_, i) => addDays(input.date, i));
    const result = await this.slotsForDates(business, service, dates, { staffId: input.staffId });
    return {
      businessId: business.id,
      timezone: business.timezone,
      serviceId: service.id,
      durationMinutes: service.durationMinutes,
      days: dates.map((date) => ({
        date,
        slots: (result.get(date) ?? []).map((s) => ({
          startAt: s.startAt.toISOString(),
          endAt: s.endAt.toISOString(),
          time: s.time,
          staffIds: s.staffIds,
        })),
      })),
    };
  }

  /** Free slots on one local date (used to check a booking). */
  async slotsOn(
    business: BusinessRef,
    service: ServiceRef,
    date: string,
    options: SlotOptions = {},
  ): Promise<Slot[]> {
    return (await this.slotsForDates(business, service, [date], options)).get(date) ?? [];
  }

  async activeService(businessId: string, serviceId: string) {
    const service = await this.db.service.findFirst({
      where: { id: serviceId, businessId, isActive: true },
      select: {
        id: true,
        name: true,
        durationMinutes: true,
        bufferMinutes: true,
        price: true,
        currency: true,
      },
    });
    if (!service) throw AppError.notFound('Service');
    return service;
  }

  private async slotsForDates(
    business: BusinessRef,
    service: ServiceRef,
    dates: string[],
    options: SlotOptions,
  ): Promise<Map<string, Slot[]>> {
    const now = options.now ?? new Date();
    const settings = await this.settings.effective(business.id);
    const first = dates[0]!;
    const last = dates[dates.length - 1]!;
    const from = startOfDay(first, business.timezone);
    const to = startOfDay(addDays(last, 1), business.timezone);

    const staff = await this.db.staff.findMany({
      where: {
        businessId: business.id,
        isActive: true,
        services: { some: { serviceId: service.id } },
        ...(options.staffId && { id: options.staffId }),
      },
      select: {
        id: true,
        availabilityRules: {
          where: { isActive: true },
          select: { dayOfWeek: true, startTime: true, endTime: true },
        },
      },
    });
    const staffIds = staff.map((s) => s.id);
    const result = new Map<string, Slot[]>();
    if (!staffIds.length) return result;

    const [exceptions, appointments] = await Promise.all([
      this.db.availabilityException.findMany({
        where: {
          businessId: business.id,
          exceptionDate: { gte: new Date(`${first}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) },
          OR: [{ staffId: null }, { staffId: { in: staffIds } }],
        },
      }),
      this.db.appointment.findMany({
        where: {
          staffId: { in: staffIds },
          status: { in: [...LIVE] },
          startAt: { lt: to },
          blockedUntil: { gt: from },
          ...(options.excludeAppointmentId && { id: { not: options.excludeAppointmentId } }),
        },
        select: { staffId: true, startAt: true, blockedUntil: true },
      }),
    ]);

    const asException = (e: (typeof exceptions)[number]): DateException => ({
      date: e.exceptionDate.toISOString().slice(0, 10),
      start: e.startTime,
      end: e.endTime,
    });
    const schedules: StaffSchedule[] = staff.map((s) => {
      const weekly = new Map<number, LocalRange[]>();
      for (const r of s.availabilityRules) {
        weekly.set(r.dayOfWeek, [...(weekly.get(r.dayOfWeek) ?? []), { start: r.startTime, end: r.endTime }]);
      }
      const own = exceptions.filter((e) => e.staffId === s.id);
      return {
        id: s.id,
        weekly,
        timeOff: own.filter((e) => e.type !== 'extra_hours').map(asException),
        extraHours: own
          .filter((e) => e.type === 'extra_hours' && e.startTime && e.endTime)
          .map((e) => ({ ...asException(e), start: e.startTime!, end: e.endTime! })),
        busy: appointments
          .filter((a) => a.staffId === s.id)
          .map((a): [number, number] => [a.startAt.getTime(), a.blockedUntil.getTime()]),
      };
    });
    const closures = exceptions
      .filter((e) => e.staffId === null && e.type !== 'extra_hours')
      .map(asException);

    const today = wallClock(now, business.timezone).date;
    for (const date of dates) {
      if (date < today) {
        result.set(date, []);
        continue;
      }
      result.set(
        date,
        computeSlots({
          date,
          timezone: business.timezone,
          durationMinutes: service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
          stepMinutes: settings.slotStepMinutes,
          earliest: new Date(now.getTime() + settings.minNoticeMinutes * 60_000),
          latest: new Date(now.getTime() + settings.bookingHorizonDays * 86_400_000),
          staff: schedules,
          closures,
        }),
      );
    }
    return result;
  }
}

export const assertBookingAllowedForRole = (role: string) => {
  if (role === 'staff') {
    throw new AppError('Employee accounts can’t book appointments', ErrorCodes.BOOKING_NOT_ALLOWED, 403);
  }
};
