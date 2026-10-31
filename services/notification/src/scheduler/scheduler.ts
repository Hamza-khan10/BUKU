import { randomUUID } from 'node:crypto';
import type { BusinessTx, DataPlane } from '@buku/database';
import type { Redis } from 'ioredis';
import { isQuietHour } from '../channels.js';
import { toAccount, toCustomer, toTeam, type Message, type PlanNotice } from '../messages.js';
import type { Delivery, Notifier } from '../notifier.js';
import type { NotificationSettings } from '../settings.js';
import { approvers, loadVisit } from '../visits.js';
import {
  dueReminder,
  NOTICE_BEFORE,
  NOTICE_RECENT_MS,
  REBOOK_GRACE_MS,
  type ReminderKind,
} from './timing.js';

/**
 * Messages sent because of the time, not an event (D-073): appointment
 * reminders, "book again", review requests and plan notices.
 *
 * Database v2 (D3f): what is due is read on every business shard (notification-service's
 * cross-business role), a page at a time. Each message has a key (e.g. "appt:<id>:r24"); each
 * recipient's mark of that key is stored on their own shard in the same transaction as their
 * inbox row, so a message reaches each person exactly once even with several instances running
 * the jobs, retries, or a restart mid-run. A short Valkey lock just stops instances doing the
 * same work twice.
 */

const PAGE = 500;
const MARK_RETENTION_DAYS = 400;
const BOOKABLE = ['pending', 'verified'] as const;

export class Scheduler {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      redis: Redis;
      notifier: Notifier;
      settings: NotificationSettings;
    },
  ) {}

  /**
   * Send `deliveries` once for `key`: each recipient who has no mark of it yet gets it, and the
   * mark. Returns false if it had already reached everyone.
   */
  async once(
    key: string,
    kind: string,
    deliveries: Delivery[],
    /** When it counts as sent (for frequency caps); defaults to now. */
    at?: Date,
  ): Promise<boolean> {
    if (!deliveries.length) return false;
    let fresh = 0;
    await this.deps.notifier.deliver(deliveries, async (tx, ids) => {
      const marked = await tx.notificationMark.createManyAndReturn({
        data: ids.map((userId) => ({ userId, key, kind, ...(at && { createdAt: at }) })),
        skipDuplicates: true,
        select: { userId: true },
      });
      fresh += marked.length;
      return marked.map((m) => m.userId);
    });
    return fresh > 0;
  }

  /** Remember a message that was decided against (so it isn't looked at again). */
  async skip(userId: bigint, key: string, kind: string): Promise<void> {
    await (
      await this.deps.plane.user(userId)
    ).notificationMark.createMany({ data: [{ userId, key, kind }], skipDuplicates: true });
  }

  /** Which of these (person, key) marks exist already, as "userId:key". */
  async sentKeys(pairs: { userId: bigint; key: string }[]): Promise<Set<string>> {
    const done = new Set<string>();
    for (const [db, ids] of await this.deps.plane.usersByShard(pairs.map((p) => p.userId))) {
      const keys = [...new Set(pairs.filter((p) => ids.includes(p.userId)).map((p) => p.key))];
      const rows = await db.notificationMark.findMany({
        where: { userId: { in: ids }, key: { in: keys } },
        select: { userId: true, key: true },
      });
      for (const r of rows) done.add(`${r.userId}:${r.key}`);
    }
    return done;
  }

  /** Runs `job` unless another instance is already running it. */
  async exclusive<T>(name: string, ttlMs: number, job: () => Promise<T>): Promise<T | null> {
    const lock = `lock:notification:${name}`;
    const token = randomUUID();
    if ((await this.deps.redis.set(lock, token, 'PX', ttlMs, 'NX')) !== 'OK') return null;
    try {
      return await job();
    } finally {
      // Only release our own lock (it may have expired and been taken by another instance).
      await this.deps.redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        lock,
        token,
      );
    }
  }

  // ── Appointment reminders (every minute) ──────────────────────────────────

  async appointmentReminders(now = new Date()): Promise<Record<ReminderKind, number>> {
    const settings = await this.deps.settings.get();
    const counts: Record<ReminderKind, number> = { r24: 0, r2: 0, pending: 0 };
    for (const { run } of await this.deps.plane.businessShards()) {
      let after: { startAt: Date; id: bigint } | undefined;
      for (;;) {
        const page = await run((tx) =>
          tx.appointment.findMany({
            where: {
              status: { in: ['confirmed', 'pending'] },
              checkedInAt: null,
              startAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) },
              ...(after && {
                OR: [{ startAt: { gt: after.startAt } }, { startAt: after.startAt, id: { gt: after.id } }],
              }),
            },
            select: {
              id: true,
              businessId: true,
              status: true,
              startAt: true,
              createdAt: true,
              userId: true,
              business: { select: { timezone: true, ownerUserId: true } },
            },
            orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
            take: PAGE,
          }),
        );
        if (!page.length) break;
        after = page.at(-1)!;

        const due = page.flatMap((a) => {
          const kind = dueReminder(a, now, {
            reminder24h: settings.reminder24h,
            reminder2h: settings.reminder2h,
            quiet: isQuietHour(now, a.business.timezone, settings.quietStartHour, settings.quietEndHour),
          });
          // A request's nudge goes to the approvers: the owner is always one of them.
          const first = kind === 'pending' ? a.business.ownerUserId : a.userId;
          return kind ? [{ a, kind, key: `appt:${a.id}:${kind}`, first }] : [];
        });
        const done = await this.sentKeys(due.map((d) => ({ userId: d.first, key: d.key })));
        for (const d of due) {
          if (done.has(`${d.first}:${d.key}`)) continue;
          if (await this.remind(d.a.businessId, d.a.id, d.kind, d.key)) counts[d.kind]++;
        }
        if (page.length < PAGE) break;
      }
    }
    return counts;
  }

  private async remind(
    businessId: bigint,
    appointmentId: bigint,
    kind: ReminderKind,
    key: string,
  ): Promise<boolean> {
    // Read again: it may have been cancelled or moved since the page was read.
    const loaded = await this.deps.plane.inBusiness(businessId, async (tx) => {
      const l = await loadVisit(tx, appointmentId);
      return l && { ...l, team: kind === 'pending' ? await approvers(tx, l.appointment.business) : [] };
    });
    if (!loaded) return false;
    const { appointment: a, visit, team } = loaded;
    if (kind === 'pending') {
      if (a.status !== 'pending') return false;
      const message = toTeam.stillPending(visit);
      return this.once(
        key,
        'pending_request',
        team.filter((id) => id !== a.userId).map((userId) => ({ userId, message, appointmentId: a.id })),
      );
    }
    if (a.status !== 'confirmed' || a.checkedInAt) return false;
    const message = kind === 'r24' ? toCustomer.reminder24h(visit) : toCustomer.reminder2h(visit);
    return this.once(key, `reminder_${kind}`, [{ userId: a.userId, message, appointmentId: a.id }]);
  }

  // ── "Book again" (every 5 minutes) ────────────────────────────────────────

  async rebookReminders(now = new Date()): Promise<number> {
    const settings = await this.deps.settings.get();
    let sent = 0;
    for (const { run } of await this.deps.plane.businessShards()) {
      const rows = await run((tx) =>
        tx.appointment.findMany({
          where: {
            rebookReminderAt: { lte: now, gte: new Date(now.getTime() - REBOOK_GRACE_MS) },
            business: { deletedAt: null, status: { in: [...BOOKABLE] } },
          },
          select: {
            id: true,
            userId: true,
            businessId: true,
            serviceId: true,
            business: { select: { publicId: true, name: true, timezone: true } },
            service: { select: { name: true, isActive: true } },
          },
          take: PAGE,
        }),
      );
      const done = await this.sentKeys(rows.map((r) => ({ userId: r.userId, key: `appt:${r.id}:rebook` })));
      for (const r of rows) {
        const key = `appt:${r.id}:rebook`;
        if (done.has(`${r.userId}:${key}`)) continue;
        if (isQuietHour(now, r.business.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
        // Already booked there again, or the service is gone: nothing to remind about.
        const upcoming = await this.deps.plane.inBusiness(r.businessId, (tx) =>
          tx.appointment.count({
            where: {
              userId: r.userId,
              businessId: r.businessId,
              status: { in: ['pending', 'confirmed'] },
              startAt: { gt: now },
            },
          }),
        );
        if (upcoming || !r.service.isActive) {
          await this.skip(r.userId, key, 'rebook_skipped');
          continue;
        }
        const message = toCustomer.bookAgain({
          businessId: r.business.publicId,
          businessName: r.business.name,
          serviceId: r.serviceId.toString(),
          serviceName: r.service.name,
        });
        if (await this.once(key, 'rebook', [{ userId: r.userId, message, appointmentId: r.id }])) sent++;
      }
    }
    return sent;
  }

  // ── "How was your visit?" (every 5 minutes) ───────────────────────────────

  /**
   * From 30 minutes after a visit ends, for up to 3 days: visits that happened
   * (completed, or checked in) and aren't reviewed yet. Once each; not at night.
   */
  async reviewRequests(now = new Date()): Promise<number> {
    const settings = await this.deps.settings.get();
    let sent = 0;
    for (const { run } of await this.deps.plane.businessShards()) {
      const rows = await run(async (tx) => {
        const visits = await tx.appointment.findMany({
          where: {
            endAt: {
              lte: new Date(now.getTime() - 30 * 60_000),
              gte: new Date(now.getTime() - 3 * 86_400_000),
            },
            // The visit started at most 3 days and a day's length ago (partition pruning).
            startAt: { gte: new Date(now.getTime() - 4 * 86_400_000) },
            OR: [{ status: 'completed' }, { status: 'confirmed', checkedInAt: { not: null } }],
          },
          select: { id: true, userId: true, businessId: true, business: { select: { timezone: true } } },
          take: PAGE,
        });
        const reviewed = await reviewedOf(
          tx,
          visits.map((v) => v.id),
        );
        return visits.filter((v) => !reviewed.has(v.id));
      });
      const done = await this.sentKeys(rows.map((r) => ({ userId: r.userId, key: `appt:${r.id}:review` })));
      for (const r of rows) {
        const key = `appt:${r.id}:review`;
        if (done.has(`${r.userId}:${key}`)) continue;
        if (isQuietHour(now, r.business.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
        const loaded = await this.deps.plane.inBusiness(r.businessId, (tx) => loadVisit(tx, r.id));
        if (!loaded) continue;
        const message = toCustomer.reviewRequest(loaded.visit);
        if (await this.once(key, 'review_request', [{ userId: r.userId, message, appointmentId: r.id }]))
          sent++;
      }
    }
    return sent;
  }

  // ── Plan notices (every 15 minutes) ───────────────────────────────────────

  /** To a business's owner, about its plan (subscriptions live on the business's shard). */
  async planNotices(now = new Date()): Promise<number> {
    const settings = await this.deps.settings.get();
    const billing = await this.deps.plane.directory.billingSettings.findUnique({
      where: { audience: 'business' },
      select: { enabled: true },
    });
    if (!billing?.enabled) return 0; // billing off: plans don't matter, nothing to say
    const at = (ms: number) => new Date(now.getTime() + ms);
    let sent = 0;
    for (const { run } of await this.deps.plane.businessShards()) {
      const subs = await run(async (tx) => {
        const subs = await tx.subscription.findMany({
          where: {
            OR: [
              {
                provider: 'trial',
                status: 'trialing',
                currentPeriodEnd: { gt: now, lte: at(NOTICE_BEFORE.trialEnding) },
              },
              {
                provider: 'manual',
                status: 'active',
                currentPeriodEnd: { gt: now, lte: at(NOTICE_BEFORE.grantEnding) },
              },
              {
                provider: { notIn: ['trial', 'manual'] },
                status: 'active',
                cancelAtPeriodEnd: true,
                currentPeriodEnd: { gt: now, lte: at(NOTICE_BEFORE.planEnding) },
              },
              { provider: 'trial', status: 'expired', updatedAt: { gte: at(-NOTICE_RECENT_MS) } },
              { status: 'past_due', updatedAt: { gte: at(-NOTICE_RECENT_MS) } },
            ],
          },
          include: {
            business: { select: { id: true, publicId: true, name: true, ownerUserId: true, timezone: true } },
          },
          take: PAGE,
        });
        const plans = await tx.plan.findMany({
          where: { id: { in: [...new Set(subs.map((s) => s.planId))] } },
          select: { id: true, name: true },
        });
        const nameOf = new Map(plans.map((p) => [p.id, p.name]));
        const out = [];
        for (const s of subs)
          out.push({
            ...s,
            planName: nameOf.get(s.planId) ?? 'your plan',
            other: await hasOtherPlan(tx, s, now),
          });
        return out;
      });

      for (const s of subs) {
        const end = s.currentPeriodEnd?.getTime() ?? 0;
        const [kind, key] =
          s.status === 'past_due'
            ? ['payment_failed', `sub:${s.id}:past_due:${(s.providerUpdatedAt ?? s.updatedAt).getTime()}`]
            : s.status === 'expired'
              ? ['trial_over', `sub:${s.id}:trial_over`]
              : s.provider === 'trial'
                ? ['trial_ending', `sub:${s.id}:trial_ending:${end}`]
                : s.provider === 'manual'
                  ? ['plan_gift_ending', `sub:${s.id}:gift_ending:${end}`]
                  : ['plan_ending', `sub:${s.id}:ending:${end}`];
        const recipient = s.business.ownerUserId;
        // Already moved on to another plan (e.g. bought one during the trial): nothing to warn about.
        if (kind !== 'payment_failed' && kind !== 'plan_ending' && s.other) {
          await this.skip(recipient, key, `${kind}_skipped`);
          continue;
        }
        const timezone = s.business.timezone;
        if (isQuietHour(now, timezone, settings.quietStartHour, settings.quietEndHour)) continue;
        const notice: PlanNotice = {
          businessId: s.business.publicId,
          businessName: s.business.name,
          planName: s.planName,
          endsAt: s.currentPeriodEnd ?? now,
          timezone,
        };
        const message: Message =
          kind === 'payment_failed'
            ? toAccount.paymentFailed(notice)
            : kind === 'trial_over'
              ? toAccount.trialOver(notice)
              : kind === 'trial_ending'
                ? toAccount.trialEnding(notice)
                : kind === 'plan_gift_ending'
                  ? toAccount.grantEnding(notice)
                  : toAccount.planEnding(notice);
        if (await this.once(key, kind, [{ userId: recipient, message }])) sent++;
      }
    }
    return sent;
  }

  /** Daily: forget keys long past mattering (suggestion caps look back far less than this). */
  async purgeMarks(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - MARK_RETENTION_DAYS * 86_400_000);
    const counts = await this.deps.plane.acrossUsers(
      async (db) => (await db.notificationMark.deleteMany({ where: { createdAt: { lt: cutoff } } })).count,
    );
    return counts.reduce((n, c) => n + c, 0);
  }
}

/** Which of these appointments already have a review. */
async function reviewedOf(tx: BusinessTx, appointmentIds: bigint[]): Promise<Set<bigint>> {
  if (!appointmentIds.length) return new Set();
  const rows = await tx.review.findMany({
    where: { appointmentId: { in: appointmentIds } },
    select: { appointmentId: true },
  });
  return new Set(rows.map((r) => r.appointmentId));
}

/** Another live plan of the business that outlasts this one. */
async function hasOtherPlan(
  tx: BusinessTx,
  s: { id: bigint; businessId: bigint; currentPeriodEnd: Date | null },
  now: Date,
): Promise<boolean> {
  const after = s.currentPeriodEnd && s.currentPeriodEnd > now ? s.currentPeriodEnd : now;
  const other = await tx.subscription.count({
    where: {
      id: { not: s.id },
      businessId: s.businessId,
      status: { in: ['active', 'trialing', 'past_due'] },
      OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: after } }],
    },
  });
  return other > 0;
}
