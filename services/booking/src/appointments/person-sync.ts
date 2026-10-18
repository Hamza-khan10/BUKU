import { logger } from '@buku/common';
import { isExclusionViolation, ShardNotFoundError, type DataPlane, type UserTx } from '@buku/database';
import { loadAppointment, type AppointmentRow } from './views.js';

/**
 * The customer's side of one appointment, kept in step with the business's (DB-014, D3d):
 *
 *  • the time it holds on their own shard (`user_time_reservations`: one appointment at a time
 *    anywhere, D-036) — booked while it is live and still to come, released otherwise;
 *  • their own list of appointments (`user_appointments`), which only a newer version replaces;
 *  • how the visit ended, for their reliability (`user_visit_outcomes`, D-078).
 *
 * It works from the appointment as it is now on the business's shard, so running it again, late,
 * or out of order changes nothing. It runs after every change, for every `bookings.*` event (the
 * repair, should a step after the business's commit have been lost), and for claims that lapsed
 * (a claim's ID is its appointment's). With no appointment, a held claim is simply given back.
 */
export class PersonSync {
  constructor(private readonly plane: DataPlane) {}

  async sync(businessId: bigint, appointmentId: bigint, userId?: bigint): Promise<void> {
    const a = await this.plane
      .inBusiness(businessId, (tx) => loadAppointment(tx, appointmentId))
      .catch((err: unknown) => {
        if (err instanceof ShardNotFoundError) return null;
        throw err;
      });
    const person = a?.userId ?? userId;
    if (person === undefined) return;
    const db = await this.plane.user(person).catch((err: unknown) => {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    });
    if (!db) return;
    await db.$transaction(async (tx) => {
      if (!a) {
        // A booking that never happened: its held claim goes.
        await tx.userTimeReservation.deleteMany({ where: { id: appointmentId, appointmentId: null } });
        return;
      }
      await this.list(tx, a);
      await this.claim(tx, a);
      await this.outcome(tx, a);
    });
  }

  /** Like `sync`, but never fails the request that called it: the events repair what it misses. */
  async syncSoon(businessId: bigint, appointmentId: bigint): Promise<void> {
    try {
      await this.sync(businessId, appointmentId);
    } catch (err) {
      logger.warn(
        { err, appointmentId: appointmentId.toString() },
        "couldn't update the customer's side of an appointment yet",
      );
    }
  }

  /** Their list: a row per appointment, replaced only by a newer version of it. */
  private async list(tx: UserTx, a: AppointmentRow) {
    const view = {
      businessId: a.businessId,
      version: BigInt(a.version),
      startAt: a.startAt,
      endAt: a.endAt,
      appointmentPublicId: a.publicId,
      status: a.status,
      businessName: a.business.name,
      serviceName: a.service.name,
    };
    const key = { userId_appointmentId: { userId: a.userId, appointmentId: a.id } };
    const current = await tx.userAppointment.findUnique({ where: key, select: { version: true } });
    if (!current)
      await tx.userAppointment.create({ data: { userId: a.userId, appointmentId: a.id, ...view } });
    else if (current.version <= view.version) await tx.userAppointment.update({ where: key, data: view });
  }

  /** Their time: held as booked while the appointment is live and still to come; free otherwise. */
  private async claim(tx: UserTx, a: AppointmentRow) {
    const holds = (a.status === 'pending' || a.status === 'confirmed') && a.endAt > new Date();
    if (!holds) {
      await tx.userTimeReservation.deleteMany({
        where: { userId: a.userId, OR: [{ id: a.id }, { appointmentId: a.id }] },
      });
      return;
    }
    const booked = {
      appointmentId: a.id,
      businessId: a.businessId,
      startAt: a.startAt,
      endAt: a.endAt,
      expiresAt: null,
    };
    const { count } = await tx.userTimeReservation.updateMany({ where: { id: a.id }, data: booked });
    if (count > 0) return;
    // Lost (swept too early): taken again, unless the time is meanwhile someone else's booking.
    try {
      await tx.$executeRaw`SAVEPOINT reclaim`;
      await tx.userTimeReservation.create({ data: { id: a.id, userId: a.userId, ...booked } });
      await tx.$executeRaw`RELEASE SAVEPOINT reclaim`;
    } catch (err) {
      if (!isExclusionViolation(err)) throw err;
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT reclaim`;
      logger.warn({ appointmentId: a.id.toString() }, 'an appointment overlaps another of the same customer');
    }
  }

  /** How it ended: a visit, a no-show, or a late cancellation by the customer — once each. */
  private async outcome(tx: UserTx, a: AppointmentRow) {
    const kind =
      a.status === 'completed' || (a.status === 'confirmed' && a.checkedInAt !== null)
        ? 'visit'
        : a.status === 'no_show'
          ? 'no_show'
          : a.status === 'cancelled' && a.cancelledBy === 'user' && a.lateCancellation
            ? 'late_cancel'
            : null;
    if (!kind) return;
    const happenedAt = kind === 'late_cancel' ? (a.cancelledAt ?? new Date()) : a.startAt;
    await tx.userVisitOutcome.upsert({
      where: { userId_refId: { userId: a.userId, refId: a.id } },
      create: {
        userId: a.userId,
        refId: a.id,
        businessId: a.businessId,
        happenedAt,
        kind,
        source: 'appointment',
      },
      update: { happenedAt, kind },
    });
  }
}
