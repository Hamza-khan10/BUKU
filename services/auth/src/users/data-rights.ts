import { AppError, ErrorCodes } from '@buku/common';
import { recordAudit, type Database } from '@buku/database';
import { createEvent, enqueueEvent, TOPICS } from '@buku/kafka';
import type { MediaLinks, ObjectStorage } from '@buku/media';
import type { RequestContext } from '../http/context.js';
import { auditCtx, type SessionService } from '../sessions/session-service.js';
import type { UserService } from './user-service.js';

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
 * Note: the export reads tables owned by other services (appointments,
 * reviews, queues). That read-only aggregation is a deliberate exception to
 * "each service writes only its own tables" (docs/ARCHITECTURE.md).
 */

export interface DataRightsSettings {
  graceDays: number;
  reauthWindowMinutes: number;
}

const NIL = null;

export class DataRightsService {
  constructor(
    private readonly deps: {
      db: Database;
      users: UserService;
      sessions: SessionService;
      /** To delete the private profile picture on purge. */
      storage: ObjectStorage;
      links: MediaLinks;
      settings: DataRightsSettings;
    },
  ) {}

  async exportData(userId: string, ctx: RequestContext) {
    const { db } = this.deps;
    const [
      me,
      user,
      identities,
      sessions,
      devices,
      prefs,
      appointments,
      reviews,
      favourites,
      queueEntries,
      notifications,
      security,
    ] = await Promise.all([
      this.deps.users.getMe(userId),
      db.user.findUniqueOrThrow({ where: { id: userId } }),
      db.oAuthAccount.findMany({ where: { userId }, select: { provider: true, createdAt: true } }),
      this.deps.sessions.list(userId),
      db.pushToken.findMany({
        where: { userId },
        select: { platform: true, isActive: true, createdAt: true, lastSeenAt: true },
      }),
      db.notificationPreference.findUnique({ where: { userId } }),
      db.appointment.findMany({
        where: { userId },
        orderBy: { startAt: 'desc' },
        select: {
          id: true,
          confirmationCode: true,
          status: true,
          startAt: true,
          endAt: true,
          price: true,
          currency: true,
          notes: true,
          cancelReason: true,
          cancelledAt: true,
          createdAt: true,
          // internal_notes belong to the business, not the customer: never exported.
          business: { select: { name: true, city: true, country: true } },
          service: { select: { name: true } },
        },
      }),
      db.review.findMany({
        where: { userId },
        select: {
          businessId: true,
          overallRating: true,
          comment: true,
          ownerResponse: true,
          createdAt: true,
          business: { select: { name: true } },
        },
      }),
      db.favourite.findMany({
        where: { userId },
        select: { createdAt: true, business: { select: { name: true, city: true } } },
      }),
      db.queueEntry.findMany({
        where: { userId },
        orderBy: { joinedAt: 'desc' },
        select: {
          ticketPrefix: true,
          ticketNumber: true,
          status: true,
          joinedAt: true,
          completedAt: true,
          session: { select: { sessionDate: true, business: { select: { name: true } } } },
        },
      }),
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
    ]);

    await recordAudit(db, {
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
      appointments: appointments.map((a) => ({ ...a, price: a.price.toString() })),
      reviews,
      favourites,
      queueEntries,
      notifications,
      securityLog: security,
    };
  }

  /**
   * Schedule deletion. Requires that this session signed in recently, so a
   * stolen or forgotten-open session can't delete someone's account.
   */
  async requestDeletion(
    userId: string,
    sessionId: string | undefined,
    feedback: string | undefined,
    ctx: RequestContext,
  ): Promise<{ purgeAfter: string }> {
    const owner = await this.deps.db.user.findUnique({
      where: { id: userId },
      select: { managedByBusinessId: true },
    });
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
    await this.deps.db.$transaction(async (tx) => {
      // Deletion never touches `status`: a suspended account stays suspended if restored.
      await tx.user.update({ where: { id: userId }, data: { deletedAt: now } });
      await tx.pushToken.deleteMany({ where: { userId } }); // stop notifications right away
      await enqueueEvent(
        tx,
        createEvent({
          type: TOPICS.USERS_DELETED,
          source: 'auth-service',
          subject: userId,
          // Consumers (booking, queue) cancel future bookings and leave queues.
          data: { userId, purgeAfter: purgeAfter.toISOString() },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'user',
      );
      await recordAudit(tx, {
        userId,
        action: 'user.deletion_requested',
        resourceType: 'user',
        resourceId: userId,
        newValues: { purgeAfter: purgeAfter.toISOString(), ...(feedback && { feedback }) },
        ...auditCtx(ctx),
      });
      await this.deps.sessions.endAllSessions(userId, 'account_deleted', ctx, tx);
    });
    return { purgeAfter: purgeAfter.toISOString() };
  }

  /**
   * Irreversibly anonymize accounts whose grace period is over. Idempotent,
   * batch-limited, and safe to run from several replicas (advisory lock).
   */
  async purgeDue(limit = 100): Promise<number> {
    const { db } = this.deps;
    const cutoff = new Date(Date.now() - this.deps.settings.graceDays * 86_400_000);
    return db.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${PURGE_LOCK_KEY}) AS locked`;
        if (!lock?.locked) return 0;
        const due = await tx.user.findMany({
          where: { deletedAt: { lt: cutoff }, purgedAt: null },
          select: { id: true, avatarStorageKey: true },
          take: limit,
        });
        for (const { id, avatarStorageKey } of due) {
          // The file first: if anything below fails, the next run deletes again (idempotent).
          if (avatarStorageKey)
            await this.deps.storage.delete(this.deps.links.privateBucket, avatarStorageKey);
          await tx.oAuthAccount.deleteMany({ where: { userId: id } });
          await tx.refreshToken.deleteMany({ where: { userId: id } });
          await tx.pushToken.deleteMany({ where: { userId: id } });
          await tx.notificationPreference.deleteMany({ where: { userId: id } });
          await tx.favourite.deleteMany({ where: { userId: id } });
          await tx.notification.deleteMany({ where: { userId: id } });
          // Ratings stay (they are part of a business's aggregate), the words don't.
          await tx.review.updateMany({ where: { userId: id }, data: { comment: NIL } });
          await tx.appointment.updateMany({ where: { userId: id }, data: { notes: NIL } });
          await tx.queueEntry.updateMany({ where: { userId: id }, data: { notes: NIL } });
          await tx.user.update({
            where: { id },
            data: {
              name: 'Deleted user',
              emailEncrypted: NIL,
              emailHash: NIL,
              emailVerifiedAt: NIL,
              phoneEncrypted: NIL,
              phoneHash: NIL,
              phoneVerifiedAt: NIL,
              unverifiedPhoneEncrypted: NIL,
              unverifiedPhoneHash: NIL,
              whatsappOptInAt: NIL,
              passwordHash: NIL,
              username: NIL,
              avatarUrl: NIL,
              avatarStorageKey: NIL,
              purgedAt: new Date(),
            },
          });
          await recordAudit(tx, { userId: id, action: 'user.purged', resourceType: 'user', resourceId: id });
        }
        return due.length;
      },
      { timeout: 60_000 },
    );
  }
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
