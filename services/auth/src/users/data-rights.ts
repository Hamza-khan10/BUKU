import { AppError, ErrorCodes, type BlindIndexer, type FieldCipher } from '@buku/common';
import { recordShardAudit, type BusinessTx, type DataPlane } from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
import type { MediaLinks, ObjectStorage } from '@buku/media';
import { auditCtx, auditPerson } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { SessionService } from '../sessions/session-service.js';
import { pushTokenKey, type UserService } from './user-service.js';

/**
 * The "my data" section: a person's rights over the data BUKU holds about them
 * (GDPR-style access, portability and erasure).
 *
 *  • EXPORT  — everything we hold about the user, as one JSON document.
 *  • DELETE  — requires a fresh sign-in. The account is hidden and signed out
 *              everywhere at once; signing in again during the grace period
 *              restores it; after that, personal data is purged for good.
 *  • PURGE   — contact details, credentials, devices, preferences, favourites,
 *              notifications and review texts are removed. Appointment and
 *              queue records stay (businesses need their booking history, and
 *              accounting may require it) but no longer identify the person.
 *
 * Database v2 (D3): the account is on the person's shard; what they did at businesses is on the
 * business shards, found in every business at once through auth-service's cross-business role
 * (DB-020) and the indexes by person (appointment_index, reviews, queue_tickets). That read-only
 * aggregation, and blanking the words people wrote, are a deliberate exception to "each service
 * writes only its own tables" (docs/ARCHITECTURE.md).
 */

export interface DataRightsSettings {
  graceDays: number;
  reauthWindowMinutes: number;
}

const NIL = null;

export class DataRightsService {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      /** To show the connected WhatsApp number in the export. */
      cipher: FieldCipher;
      /** For the handles of the person's devices, given back when they go. */
      indexer: BlindIndexer;
      users: UserService;
      sessions: SessionService;
      /** To delete the private profile picture on purge. */
      storage: ObjectStorage;
      links: MediaLinks;
      settings: DataRightsSettings;
    },
  ) {}

  async exportData(userId: bigint, ctx: RequestContext) {
    const { plane } = this.deps;
    const db = await plane.user(userId);
    const me = await this.deps.users.getMe(userId);
    const [user, identities, sessions, devices, prefs, favourites, notifications, security, whatsapp] =
      await Promise.all([
        db.user.findUniqueOrThrow({ where: { id: userId } }),
        db.oAuthAccount.findMany({ where: { userId }, select: { provider: true, createdAt: true } }),
        this.deps.sessions.list(userId),
        db.pushToken.findMany({
          where: { userId },
          select: { platform: true, isActive: true, createdAt: true, lastSeenAt: true },
        }),
        db.notificationPreference.findUnique({ where: { userId } }),
        db.favourite.findMany({ where: { userId }, select: { businessId: true, createdAt: true } }),
        db.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          select: {
            type: true,
            channel: true,
            title: true,
            body: true,
            status: true,
            createdAt: true,
            readAt: true,
          },
        }),
        db.auditLog.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 1000,
          select: { action: true, ipAddress: true, userAgent: true, createdAt: true },
        }),
        db.whatsappContact.findUnique({ where: { userId } }),
      ]);

    // What they did at businesses, from every business shard.
    const favouriteIds = favourites.map((f) => f.businessId);
    const shards = await plane.acrossBusinesses((tx) => this.atBusinesses(tx, userId, favouriteIds));
    const appointments = shards.flatMap((s) => s.appointments).sort((a, b) => +b.startAt - +a.startAt);
    const places = new Map(shards.flatMap((s) => s.favourites).map((b) => [b.id, b]));

    await auditPerson(plane, userId, {
      userId,
      action: 'user.data_exported',
      resourceType: 'user',
      resourceId: userId,
      ...auditCtx(ctx),
    });

    return {
      format: 'buku-data-export/1',
      exportedAt: new Date().toISOString(),
      account: {
        ...me,
        status: user.status,
        termsVersion: user.termsVersion,
        termsAcceptedAt: user.termsAcceptedAt,
        whatsappOptInAt: user.whatsappOptInAt,
        lastLoginAt: user.lastLoginAt,
      },
      signInMethods: identities.map((i) => ({ provider: i.provider, linkedAt: i.createdAt })),
      sessions,
      pushDevices: devices,
      notificationPreferences: prefs && { ...prefs, userId: undefined },
      whatsapp: whatsapp && {
        // Must match notification-service's WHATSAPP_PHONE_CONTEXT.
        phone: this.deps.cipher.decryptBytes(whatsapp.phoneEnc, 'whatsapp.phone'),
        connectedAt: whatsapp.linkedAt,
        lastMessageFromYouAt: whatsapp.lastInboundAt,
        stoppedAt: whatsapp.optedOutAt,
      },
      appointments: appointments.map(({ priceMinor, ...a }) => ({ ...a, priceMinor: priceMinor.toString() })),
      reviews: shards.flatMap((s) => s.reviews),
      favourites: favourites.map((f) => {
        const place = places.get(f.businessId);
        return { createdAt: f.createdAt, business: place ? { name: place.name, city: place.city } : null };
      }),
      queueEntries: shards.flatMap((s) => s.queueEntries),
      notifications,
      securityLog: security,
    };
  }

  /**
   * Schedule deletion. Requires that this session signed in recently, so a
   * stolen or forgotten-open session can't delete someone's account.
   */
  async requestDeletion(
    userId: bigint,
    sessionId: bigint | undefined,
    feedback: string | undefined,
    ctx: RequestContext,
  ): Promise<{ purgeAfter: string }> {
    const { plane } = this.deps;
    const db = await plane.user(userId);
    const owner = await db.user.findUnique({ where: { id: userId }, select: { managedByBusinessId: true } });
    if (owner?.managedByBusinessId) {
      throw AppError.forbidden('Employee accounts are closed by the business that created them');
    }
    const signedIn = sessionId ? await this.deps.sessions.signedInAt(userId, sessionId) : null;
    const windowMs = this.deps.settings.reauthWindowMinutes * 60_000;
    if (!signedIn || Date.now() - signedIn.getTime() > windowMs) {
      throw new AppError(
        'For your security, please sign in again to delete your account',
        ErrorCodes.REAUTH_REQUIRED,
        403,
        {
          details: { withinMinutes: this.deps.settings.reauthWindowMinutes },
        },
      );
    }

    const now = new Date();
    const purgeAfter = new Date(now.getTime() + this.deps.settings.graceDays * 86_400_000);
    const devices = await db.$transaction(async (tx) => {
      // Deletion never touches `status`: a suspended account stays suspended if restored.
      await tx.user.update({ where: { id: userId }, data: { deletedAt: now } });
      // Stop notifications right away (a restored account connects them again).
      const devices = await tx.pushToken.findMany({ where: { userId }, select: { token: true } });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.whatsappContact.deleteMany({ where: { userId } });
      await enqueueShardEvent(
        tx,
        plane.id(),
        createEvent({
          type: TOPICS.USERS_DELETED,
          source: 'auth-service',
          subject: userId.toString(),
          // Consumers (booking, queue) cancel future bookings and leave queues; notification-service
          // gives back the WhatsApp number's handle, which only it may write.
          data: { userId: userId.toString(), purgeAfter: purgeAfter.toISOString() },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'user',
      );
      await recordShardAudit(tx, plane.id(), {
        userId,
        action: 'user.deletion_requested',
        resourceType: 'user',
        resourceId: userId,
        newValues: { purgeAfter: purgeAfter.toISOString(), ...(feedback && { feedback }) },
        ...auditCtx(ctx),
      });
      await this.deps.sessions.endAllSessions(userId, 'account_deleted', ctx, tx);
      return devices.map((d) => d.token);
    });
    // The devices are free for whoever signs in on them next.
    for (const token of devices)
      await plane.handles.release('user.push_token', pushTokenKey(this.deps.indexer, token), userId);
    return { purgeAfter: purgeAfter.toISOString() };
  }

  /**
   * Irreversibly anonymize accounts whose grace period is over, shard by shard. Idempotent,
   * batch-limited, and safe to run from several replicas (an advisory lock on each shard).
   * Their handles go last, once the account is anonymized: the email can then start a new account.
   */
  async purgeDue(limit = 100): Promise<number> {
    const { plane } = this.deps;
    const cutoff = new Date(Date.now() - this.deps.settings.graceDays * 86_400_000);
    const perShard = await plane.acrossUsers(async (db) => {
      const purged = await db.$transaction(
        async (tx) => {
          const [lock] = await tx.$queryRaw<
            { locked: boolean }[]
          >`SELECT pg_try_advisory_xact_lock(${PURGE_LOCK_KEY}) AS locked`;
          if (!lock?.locked) return [];
          const due = await tx.user.findMany({
            where: { deletedAt: { lt: cutoff }, purgedAt: null },
            select: { id: true, avatarStorageKey: true },
            take: limit,
          });
          for (const { id, avatarStorageKey } of due) {
            // Elsewhere first (each step can run again): the words they wrote at businesses, the file.
            await plane.acrossBusinesses((b) => eraseAtBusinesses(b, id));
            if (avatarStorageKey)
              await this.deps.storage.delete(this.deps.links.privateBucket, avatarStorageKey);
            const mine = { where: { userId: id } };
            await tx.oAuthAccount.deleteMany(mine);
            await tx.userMfa.deleteMany(mine);
            await tx.refreshToken.deleteMany(mine);
            await tx.pushToken.deleteMany(mine);
            await tx.notificationPreference.deleteMany(mine);
            await tx.favourite.deleteMany(mine);
            await tx.notification.deleteMany(mine);
            await tx.notificationMark.deleteMany(mine);
            await tx.whatsappContact.deleteMany(mine);
            await tx.userAppointment.deleteMany(mine);
            await tx.userTimeReservation.deleteMany(mine);
            await tx.userActiveTicket.deleteMany(mine);
            await tx.userBusinessRole.deleteMany(mine);
            await tx.userVisitOutcome.deleteMany(mine);
            await tx.user.update({
              where: { id },
              data: {
                name: 'Deleted user',
                emailEnc: NIL,
                emailHash: NIL,
                emailVerifiedAt: NIL,
                phoneEnc: NIL,
                phoneHash: NIL,
                phoneVerifiedAt: NIL,
                unverifiedPhoneEnc: NIL,
                unverifiedPhoneHash: NIL,
                whatsappOptInAt: NIL,
                passwordHash: NIL,
                username: NIL,
                avatarUrl: NIL,
                avatarStorageKey: NIL,
                purgedAt: new Date(),
              },
            });
            await recordShardAudit(tx, plane.id(), {
              userId: id,
              action: 'user.purged',
              resourceType: 'user',
              resourceId: id,
            });
          }
          return due.map((d) => d.id);
        },
        { timeout: 120_000 },
      );
      for (const id of purged) await plane.handles.releaseAll('user', id);
      return purged.length;
    });
    return perShard.reduce((n, x) => n + x, 0);
  }

  /** One business shard's part of the export: the person's appointments, reviews, queue tickets. */
  private async atBusinesses(tx: BusinessTx, userId: bigint, favouriteIds: bigint[]) {
    const index = await tx.appointmentIndex.findMany({
      where: { userId },
      select: { appointmentId: true, startAt: true },
    });
    const appointments = index.length
      ? await tx.appointment.findMany({
          // The partition key alongside the ID: each appointment straight from its partition.
          where: {
            userId,
            id: { in: index.map((i) => i.appointmentId) },
            startAt: { in: index.map((i) => i.startAt) },
          },
          select: {
            publicId: true,
            code: true,
            status: true,
            startAt: true,
            endAt: true,
            priceMinor: true,
            currency: true,
            notes: true,
            cancelReason: true,
            cancelledAt: true,
            createdAt: true,
            // internal_notes belong to the business, not the customer: never exported.
            business: { select: { name: true, city: true, country: true } },
            service: { select: { name: true } },
          },
        })
      : [];
    const reviews = await tx.review.findMany({
      where: { userId },
      select: {
        overallRating: true,
        comment: true,
        ownerResponse: true,
        createdAt: true,
        business: { select: { publicId: true, name: true } },
      },
    });
    const queueEntries = await tx.queueTicket.findMany({
      where: { userId },
      orderBy: { joinedAt: 'desc' },
      select: {
        ticketPrefix: true,
        ticketNumber: true,
        status: true,
        joinedAt: true,
        completedAt: true,
        sessionDate: true,
        business: { select: { name: true } },
      },
    });
    const favourites = favouriteIds.length
      ? await tx.business.findMany({
          where: { id: { in: favouriteIds } },
          select: { id: true, name: true, city: true },
        })
      : [];
    return { appointments, reviews, queueEntries, favourites };
  }
}

/**
 * Ratings stay (they are part of a business's aggregate); the words people wrote and the name
 * they booked under don't. Only those columns are written (auth-service may change nothing else
 * there, D2d), so plain SQL: Prisma would also stamp `updated_at`.
 */
async function eraseAtBusinesses(tx: BusinessTx, userId: bigint): Promise<void> {
  await tx.$executeRaw`UPDATE reviews SET comment = NULL WHERE user_id = ${userId} AND comment IS NOT NULL`;
  await tx.$executeRaw`UPDATE queue_tickets SET notes = NULL WHERE user_id = ${userId} AND notes IS NOT NULL`;
  await tx.$executeRaw`
    UPDATE appointments a SET notes = NULL, customer_name = NULL
    FROM appointment_index i
    WHERE i.user_id = ${userId} AND a.id = i.appointment_id AND a.start_at = i.start_at
      AND (a.notes IS NOT NULL OR a.customer_name IS NOT NULL)`;
}

// Arbitrary constant, distinct from the outbox relay's.
const PURGE_LOCK_KEY = 314_159_265;

/** Runs `purgeDue` periodically inside auth-service. */
export class AccountPurger {
  private timer: NodeJS.Timeout | undefined;
  constructor(
    private readonly rights: DataRightsService,
    private readonly onError: (err: unknown) => void,
    private readonly intervalMs = 60 * 60 * 1000,
  ) {}
  start(): void {
    const tick = () => {
      this.rights.purgeDue().catch(this.onError);
    };
    tick();
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
  }
  stop(): Promise<void> {
    clearInterval(this.timer);
    return Promise.resolve();
  }
}
