import type { Database, Transaction } from '@buku/database';
import type { Visit } from './messages.js';

/** An appointment with what its messages show, and who they go to. Read-only. */
export async function loadVisit(tx: Database | Transaction, appointmentId: string) {
  const a = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      business: { select: { id: true, name: true, timezone: true, ownerId: true } },
      service: { select: { name: true } },
      staff: { select: { displayName: true, userId: true } },
      user: { select: { id: true, name: true } },
    },
  });
  if (!a) return null;
  const visit: Visit = {
    appointmentId: a.id,
    businessId: a.businessId,
    businessName: a.business.name,
    serviceName: a.service.name,
    staffName: a.staff?.displayName ?? null,
    customerName: a.user.name,
    code: a.confirmationCode,
    startAt: a.startAt,
    timezone: a.business.timezone,
  };
  return {
    appointment: a,
    visit,
    /** The employee doing it, if their profile is linked to a team account; else the owner. */
    doer: a.staff?.userId ?? a.business.ownerId,
  };
}

/** Owner, managers and front desk: the people who approve booking requests. */
export async function approvers(
  tx: Database | Transaction,
  business: { id: string; ownerId: string },
): Promise<string[]> {
  const members = await tx.businessMember.findMany({
    where: { businessId: business.id, status: 'active', role: { in: ['manager', 'front_desk'] } },
    select: { userId: true },
  });
  return [...new Set([business.ownerId, ...members.map((m) => m.userId)])];
}
