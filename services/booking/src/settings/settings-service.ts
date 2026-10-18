import { assertFeature, businessEntitlementsOnShard } from '@buku/billing';
import type { Actor } from '@buku/common';
import {
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
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

/** Settings in effect (stored or default), read in the business's own transaction. */
export async function effectiveSettings(tx: BusinessTx, businessId: bigint): Promise<BookingSettingsView> {
  const row = await tx.bookingSettings.findUnique({ where: { businessId } });
  if (!row) return { ...DEFAULT_BOOKING_SETTINGS };
  return {
    confirmationMode: row.confirmationMode as BookingSettingsView['confirmationMode'],
    bookingHorizonDays: row.bookingHorizonDays,
    maxFutureBookingsPerCustomer: row.maxFutureBookingsPerCustomer,
    cancellationWindowHours: row.cancellationWindowHours,
    minNoticeMinutes: row.minNoticeMinutes,
    slotStepMinutes: row.slotStepMinutes,
    noShowGraceMinutes: row.noShowGraceMinutes,
    approvalBelowShowUpPercent: row.approvalBelowShowUpPercent,
  };
}

export class SettingsService {
  constructor(private readonly plane: DataPlane) {}

  /** Settings in effect, in a transaction of their own. */
  effective(businessId: bigint): Promise<BookingSettingsView> {
    return this.plane.inBusiness(businessId, (tx) => effectiveSettings(tx, businessId));
  }

  async get(businessId: bigint, actor: Actor): Promise<BookingSettingsView> {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return effectiveSettings(tx, businessId);
    });
  }

  async update(
    businessId: bigint,
    actor: Actor,
    changes: Partial<BookingSettingsView>,
    ctx: RequestContext,
  ): Promise<BookingSettingsView> {
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'booking.settings');
      await assertNotSuspended(tx, businessId);
      // Holding bookings for approval (all, or from unreliable customers) is a plan feature.
      if (changes.confirmationMode === 'manual' || (changes.approvalBelowShowUpPercent ?? null) !== null)
        assertFeature(await businessEntitlementsOnShard(tx, businessId), 'manual_approval');
      await tx.bookingSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await recordShardAudit(tx, this.plane.id(), {
        userId: actor.id,
        action: 'booking.settings_updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: data,
        ...auditCtx(ctx),
      });
      return effectiveSettings(tx, businessId);
    });
  }
}
