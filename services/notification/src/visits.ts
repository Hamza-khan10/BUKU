import type { BusinessTx } from '@buku/database';
import type { Visit } from './messages.js';

/**
 * An appointment with what its messages show, and who they go to, read in its business's
 * transaction (database v2, D3f). Messages name the appointment and the business by their public
 * IDs (DB-042); the customer by the name they booked under.
 */
export async function loadVisit(tx: BusinessTx, appointmentId: bigint) {
  const a = await tx.appointment.findFirst({
    where: { id: appointmentId },
    include: {
      business: { select: { id: true, publicId: true, name: true, timezone: true, ownerUserId: true } },
      service: { select: { name: true } },
      staff: { select: { displayName: true, userId: true } },
    },
  });
  if (!a) return null;
  const visit: Visit = {
    appointmentId: a.publicId,
    businessId: a.business.publicId,
    businessName: a.business.name,
    serviceName: a.service.name,
    staffName: a.staff?.displayName ?? null,
    customerName: a.customerName ?? 'A customer',
    code: a.code,
    startAt: a.startAt,
    timezone: a.business.timezone,
  };
  return {
    appointment: a,
    visit,
    /** The employee doing it, if their profile is linked to a team account; else the owner. */
    doer: a.staff?.userId ?? a.business.ownerUserId,
  };
}

/** Owner, managers and front desk: the people who approve booking requests. */
export async function approvers(
  tx: BusinessTx,
  business: { id: bigint; ownerUserId: bigint },
): Promise<bigint[]> {
  const members = await tx.businessMember.findMany({
    where: { businessId: business.id, status: 'active', role: { in: ['manager', 'front_desk'] } },
    select: { userId: true },
  });
  return [...new Set([business.ownerUserId, ...members.map((m) => m.userId)])];
}
