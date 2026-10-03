import { assertBusinessFeature } from '@buku/billing';
import { recordAudit, requireBusinessPermission, type Database } from '@buku/database';
import { auditCtx, type RequestContext } from '../http/context.js';
import { assertNotSuspended } from '../businesses.js';

/**
 * How a business takes bookings (D-037, D-035, product decisions H). No row
 * means the defaults; the database enforces the allowed ranges.
 */
export interface BookingSettingsView {
  confirmationMode: 'automatic' | 'manual';
  bookingHorizonDays: number;
  maxFutureBookingsPerCustomer: number;
  cancellationWindowHours: number;
  minNoticeMinutes: number;
  slotStepMinutes: number;
  noShowGraceMinutes: number;
  /** Customers who show up less often than this (percent) need approval; null = off (D-078). */
  approvalBelowShowUpPercent: number | null;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettingsView = {
  confirmationMode: 'automatic',
  bookingHorizonDays: 365,
  maxFutureBookingsPerCustomer: 3,
  cancellationWindowHours: 12,
  minNoticeMinutes: 60,
  slotStepMinutes: 15,
  noShowGraceMinutes: 15,
  approvalBelowShowUpPercent: null,
};

export class SettingsService {
  constructor(private readonly db: Database) {}

  /** Settings in effect (stored or default). */
  async effective(businessId: string): Promise<BookingSettingsView> {
    const row = await this.db.bookingSettings.findUnique({ where: { businessId } });
    if (!row) return { ...DEFAULT_BOOKING_SETTINGS };
    return {
      confirmationMode: row.confirmationMode,
      bookingHorizonDays: row.bookingHorizonDays,
      maxFutureBookingsPerCustomer: row.maxFutureBookingsPerCustomer,
      cancellationWindowHours: row.cancellationWindowHours,
      minNoticeMinutes: row.minNoticeMinutes,
      slotStepMinutes: row.slotStepMinutes,
      noShowGraceMinutes: row.noShowGraceMinutes,
      approvalBelowShowUpPercent: row.approvalBelowShowUpPercent,
    };
  }

  async get(businessId: string, actorId: string): Promise<BookingSettingsView> {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    return this.effective(businessId);
  }

  async update(
    businessId: string,
    actorId: string,
    changes: Partial<BookingSettingsView>,
    ctx: RequestContext,
  ): Promise<BookingSettingsView> {
    await requireBusinessPermission(this.db, businessId, actorId, 'booking.settings');
    await assertNotSuspended(this.db, businessId);
    // Holding bookings for approval (all, or from unreliable customers) is a plan feature.
    if (changes.confirmationMode === 'manual' || (changes.approvalBelowShowUpPercent ?? null) !== null)
      await assertBusinessFeature(this.db, businessId, 'manual_approval');
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    await this.db.$transaction(async (tx) => {
      await tx.bookingSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await recordAudit(tx, {
        userId: actorId,
        action: 'booking.settings_updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: data,
        ...auditCtx(ctx),
      });
    });
    return this.effective(businessId);
  }
}
