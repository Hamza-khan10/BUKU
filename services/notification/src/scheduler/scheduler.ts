import { randomUUID } from 'node:crypto';
import { logger } from '@buku/common';
import type { Database } from '@buku/database';
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
 * reminders, "book again", and plan notices. Each has a key (e.g.
 * "appt:<id>:r24"); the key is stored in the same transaction as the inbox
 * rows, so a message goes exactly once even with several instances running
 * the jobs, retries, or a restart mid-run. A short Valkey lock just stops
 * instances doing the same work twice.
 */

const PAGE = 500;
const MARK_RETENTION_DAYS = 400;

export class Scheduler {
  private readonly log = logger.child({ module: 'scheduler' });

  constructor(
    private readonly deps: {
      db: Database;
      redis: Redis;
      notifier: Notifier;
      settings: NotificationSettings;
    },
  ) {}

  /** Send `deliveries` once for `key`. Returns false if that key was already sent. */
  async once(key: string, kind: string, userId: string | null, deliveries: Delivery[]): Promise<boolean> {
    let toSend: Delivery[] = [];
    const sent = await this.deps.db.$transaction(async (tx) => {
      const { count } = await tx.notificationMark.createMany({
        data: [{ key, kind, userId }],
        skipDuplicates: true,
      });
      if (count === 0) return false;
      toSend = await this.deps.notifier.record(tx, deliveries);
      return true;
    });
    if (toSend.length) {
      await this.deps.notifier
        .send(toSend)
        .catch((err: unknown) => this.log.error({ err, key }, 'scheduled send failed'));
    }
    return sent;
  }

  /** Keys (of `keys`) already sent. */
  private async sentKeys(keys: string[]): Promise<Set<string>> {
    if (!keys.length) return new Set();
    const rows = await this.deps.db.notificationMark.findMany({
      where: { key: { in: keys } },
      select: { key: true },
    });
    return new Set(rows.map((r) => r.key));
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
    let cursor: string | undefined;
    for (;;) {
      const page = await this.deps.db.appointment.findMany({
        where: {
          status: { in: ['confirmed', 'pending'] },
          checkedInAt: null,
          startAt: { gt: now, lte: new Date(now.getTime() + 24 * 3_600_000) },
        },
        select: {
          id: true,
          status: true,
          startAt: true,
          createdAt: true,
          userId: true,
          business: { select: { timezone: true } },
        },
        orderBy: { id: 'asc' },
        take: PAGE,
        ...(cursor && { skip: 1, cursor: { id: cursor } }),
      });
      if (!page.length) break;
      cursor = page.at(-1)!.id;

      const due = page.flatMap((a) => {
        const kind = dueReminder(a, now, {
          reminder24h: settings.reminder24h,
          reminder2h: settings.reminder2h,
          quiet: isQuietHour(now, a.business.timezone, settings.quietStartHour, settings.quietEndHour),
        });
        return kind ? [{ a, kind, key: `appt:${a.id}:${kind}` }] : [];
      });
      const done = await this.sentKeys(due.map((d) => d.key));
      for (const d of due) {
        if (done.has(d.key)) continue;
        if (await this.remind(d.a.id, d.kind, d.key)) counts[d.kind]++;
      }
      if (page.length < PAGE) break;
    }
    return counts;
  }

  private async remind(appointmentId: string, kind: ReminderKind, key: string): Promise<boolean> {
    // Read again: it may have been cancelled or moved since the page was read.
    const loaded = await loadVisit(this.deps.db, appointmentId);
    if (!loaded) return false;
    const { appointment: a, visit } = loaded;
    if (kind === 'pending') {
      if (a.status !== 'pending') return false;
      const team = await approvers(this.deps.db, a.business);
      const message = toTeam.stillPending(visit);
      return this.once(
        key,
        'pending_request',
        null,
        team.filter((id) => id !== a.userId).map((userId) => ({ userId, message, appointmentId: a.id })),
      );
    }
    if (a.status !== 'confirmed' || a.checkedInAt) return false;
    const message = kind === 'r24' ? toCustomer.reminder24h(visit) : toCustomer.reminder2h(visit);
    return this.once(key, `reminder_${kind}`, a.userId, [{ userId: a.userId, message, appointmentId: a.id }]);
  }

  // ── "Book again" (every 5 minutes) ────────────────────────────────────────

  async rebookReminders(now = new Date()): Promise<number> {
    const settings = await this.deps.settings.get();
    const rows = await this.deps.db.appointment.findMany({
      where: {
        rebookReminderAt: { lte: now, gte: new Date(now.getTime() - REBOOK_GRACE_MS) },
        business: { deletedAt: null, status: { in: ['pending', 'verified'] } },
      },
      select: {
        id: true,
        userId: true,
        businessId: true,
        serviceId: true,
        business: { select: { name: true, timezone: true } },
        service: { select: { name: true, isActive: true } },
      },
      take: PAGE,
    });
    const done = await this.sentKeys(rows.map((r) => `appt:${r.id}:rebook`));
    let sent = 0;
    for (const r of rows) {
      const key = `appt:${r.id}:rebook`;
      if (done.has(key)) continue;
      if (isQuietHour(now, r.business.timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      // Already booked there again, or the service is gone: nothing to remind about.
      const upcoming = await this.deps.db.appointment.count({
        where: {
          userId: r.userId,
          businessId: r.businessId,
          status: { in: ['pending', 'confirmed'] },
          startAt: { gt: now },
        },
      });
      if (upcoming || !r.service.isActive) {
        await this.deps.db.notificationMark.createMany({
          data: [{ key, kind: 'rebook_skipped', userId: r.userId }],
          skipDuplicates: true,
        });
        continue;
      }
      const message = toCustomer.bookAgain({
        businessId: r.businessId,
        businessName: r.business.name,
        serviceId: r.serviceId,
        serviceName: r.service.name,
      });
      if (await this.once(key, 'rebook', r.userId, [{ userId: r.userId, message, appointmentId: r.id }]))
        sent++;
    }
    return sent;
  }

  // ── Plan notices (every 15 minutes) ───────────────────────────────────────

  async planNotices(now = new Date()): Promise<number> {
    const settings = await this.deps.settings.get();
    const billingOn = new Set(
      (
        await this.deps.db.billingSettings.findMany({ where: { enabled: true }, select: { audience: true } })
      ).map((s) => s.audience),
    );
    if (!billingOn.size) return 0; // billing off: plans don't matter, nothing to say
    const audienceFilter = [
      ...(billingOn.has('user') ? [{ userId: { not: null } }] : []),
      ...(billingOn.has('business') ? [{ businessId: { not: null } }] : []),
    ];
    const at = (ms: number) => new Date(now.getTime() + ms);
    const subs = await this.deps.db.subscription.findMany({
      where: {
        AND: [
          { OR: audienceFilter },
          {
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
        ],
      },
      include: {
        plan: { select: { name: true } },
        user: { select: { id: true, timezone: true } },
        business: { select: { id: true, name: true, ownerId: true, timezone: true } },
      },
      take: PAGE,
    });

    let sent = 0;
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
      const recipient = s.business?.ownerId ?? s.user?.id;
      if (!recipient) continue;
      // Already moved on to another plan (e.g. bought one during the trial): nothing to warn about.
      if (kind !== 'payment_failed' && kind !== 'plan_ending' && (await this.hasOtherPlan(s, now))) {
        await this.deps.db.notificationMark.createMany({
          data: [{ key, kind: `${kind}_skipped`, userId: recipient }],
          skipDuplicates: true,
        });
        continue;
      }
      const timezone = s.business?.timezone ?? s.user?.timezone ?? 'UTC';
      if (isQuietHour(now, timezone, settings.quietStartHour, settings.quietEndHour)) continue;
      const notice: PlanNotice = {
        businessId: s.business?.id ?? null,
        businessName: s.business?.name ?? null,
        planName: s.plan.name,
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
      if (await this.once(key, kind, recipient, [{ userId: recipient, message }])) sent++;
    }
    return sent;
  }

  /** Another live plan that outlasts this one. */
  private async hasOtherPlan(
    s: { id: string; userId: string | null; businessId: string | null; currentPeriodEnd: Date | null },
    now: Date,
  ): Promise<boolean> {
    const after = s.currentPeriodEnd && s.currentPeriodEnd > now ? s.currentPeriodEnd : now;
    const other = await this.deps.db.subscription.count({
      where: {
        id: { not: s.id },
        ...(s.businessId ? { businessId: s.businessId } : { userId: s.userId }),
        status: { in: ['active', 'trialing', 'past_due'] },
        OR: [{ currentPeriodEnd: null }, { currentPeriodEnd: { gt: after } }],
      },
    });
    return other > 0;
  }

  /** Daily: forget keys long past mattering (suggestion caps look back far less than this). */
  async purgeMarks(now = new Date()): Promise<number> {
    const { count } = await this.deps.db.notificationMark.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - MARK_RETENTION_DAYS * 86_400_000) } },
    });
    return count;
  }
}
