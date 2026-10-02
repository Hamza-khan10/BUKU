import { logger } from '@buku/common';
import type { Database, Transaction } from '@buku/database';
import type { Category, Message } from './messages.js';
import type { PushSender } from './push/sender.js';

/**
 * Delivering a message to people (D-071):
 *
 *  1. INBOX — always: one `in_app` row per recipient, written in the same
 *     transaction that marks the event as processed (an event is never
 *     half-delivered or delivered twice to the inbox).
 *  2. PUSH — after the commit, to each of the recipient's active devices, if
 *     their preferences allow this category ("it's your turn" always goes).
 *     Each push is recorded with its device and Expo ticket; receipts later
 *     mark it delivered or failed, and switch off devices that no longer exist.
 *
 * Deleted accounts get nothing. Push is best effort: a failed send is
 * recorded, the inbox still has the message.
 */

export interface Delivery {
  userId: string;
  message: Message;
  appointmentId?: string | undefined;
  queueEntryId?: string | undefined;
}

const PREF: Record<
  Exclude<Category, 'queue_called'>,
  'pushBookingConfirmation' | 'pushReminders' | 'pushQueueUpdates' | 'pushBusinessAlerts'
> = {
  booking: 'pushBookingConfirmation',
  reminder: 'pushReminders',
  queue: 'pushQueueUpdates',
  business: 'pushBusinessAlerts',
};

export class Notifier {
  private readonly log = logger.child({ module: 'notifier' });

  constructor(
    private readonly db: Database,
    private readonly push: PushSender,
  ) {}

  /** Step 1, inside the event's transaction: the inbox rows. Returns what to push afterwards. */
  async record(tx: Transaction, deliveries: Delivery[]): Promise<Delivery[]> {
    const ids = [...new Set(deliveries.map((d) => d.userId))];
    // Soft-deleted accounts are filtered out by the database client.
    const live = new Set(
      (await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id),
    );
    const kept = deliveries.filter((d) => live.has(d.userId));
    if (kept.length) {
      await tx.notification.createMany({
        data: kept.map((d) => ({
          userId: d.userId,
          appointmentId: d.appointmentId ?? null,
          queueEntryId: d.queueEntryId ?? null,
          type: d.message.type,
          channel: 'in_app' as const,
          title: d.message.title,
          body: d.message.body,
          data: d.message.data,
          status: 'delivered' as const,
          sentAt: new Date(),
          deliveredAt: new Date(),
        })),
      });
    }
    return kept;
  }

  /** Step 2, after the commit: push to devices, as preferences allow. */
  async send(deliveries: Delivery[]): Promise<void> {
    if (!deliveries.length) return;
    const ids = [...new Set(deliveries.map((d) => d.userId))];
    const [prefs, tokens] = await Promise.all([
      this.db.notificationPreference.findMany({ where: { userId: { in: ids } } }),
      this.db.pushToken.findMany({ where: { userId: { in: ids }, isActive: true } }),
    ]);
    const prefOf = new Map(prefs.map((p) => [p.userId, p]));
    const sends: { delivery: Delivery; token: { id: string; token: string } }[] = [];
    for (const d of deliveries) {
      const p = prefOf.get(d.userId);
      const allowed = d.message.category === 'queue_called' || !p || p[PREF[d.message.category]];
      if (!allowed) continue;
      for (const t of tokens)
        if (t.userId === d.userId && this.push.accepts(t.token)) sends.push({ delivery: d, token: t });
    }
    if (!sends.length) return;

    const tickets = await this.push.send(
      sends.map((s) => ({
        token: s.token.token,
        title: s.delivery.message.title,
        body: s.delivery.message.body,
        data: s.delivery.message.data,
      })),
    );
    const now = new Date();
    await this.db.notification.createMany({
      data: sends.map((s, i) => {
        const t = tickets[i]!;
        return {
          userId: s.delivery.userId,
          appointmentId: s.delivery.appointmentId ?? null,
          queueEntryId: s.delivery.queueEntryId ?? null,
          type: s.delivery.message.type,
          channel: 'push' as const,
          title: s.delivery.message.title,
          body: s.delivery.message.body,
          data: s.delivery.message.data,
          pushTokenId: s.token.id,
          status: t.ok ? ('sent' as const) : ('failed' as const),
          externalId: t.ok ? t.id : null,
          failureReason: t.ok ? null : t.error,
          sentAt: t.ok ? now : null,
        };
      }),
    });
    const gone = sends.filter((_, i) => {
      const t = tickets[i]!;
      return !t.ok && t.deviceGone;
    });
    if (gone.length) await this.deactivate(gone.map((s) => s.token.id));
  }

  /**
   * Receipts for pushes sent 15 minutes to 24 hours ago: delivered or failed;
   * devices that no longer exist are switched off. Run periodically.
   */
  async checkReceipts(now = new Date()): Promise<{ checked: number; delivered: number; failed: number }> {
    const pending = await this.db.notification.findMany({
      where: {
        channel: 'push',
        status: 'sent',
        externalId: { not: null },
        sentAt: { lte: new Date(now.getTime() - 15 * 60_000), gte: new Date(now.getTime() - 24 * 3_600_000) },
        createdAt: { gte: new Date(now.getTime() - 25 * 3_600_000) }, // partition pruning
      },
      select: { id: true, createdAt: true, externalId: true, pushTokenId: true },
      take: 5000,
    });
    if (!pending.length) return { checked: 0, delivered: 0, failed: 0 };
    const receipts = await this.push.receipts(pending.map((p) => p.externalId!));
    let delivered = 0;
    let failed = 0;
    const goneTokens: string[] = [];
    for (const p of pending) {
      const r = receipts.get(p.externalId!);
      if (!r) continue; // not ready yet
      const where = { id: p.id, createdAt: p.createdAt };
      if (r.ok) {
        delivered++;
        await this.db.notification.updateMany({ where, data: { status: 'delivered', deliveredAt: now } });
      } else {
        failed++;
        await this.db.notification.updateMany({ where, data: { status: 'failed', failureReason: r.error } });
        if (r.deviceGone && p.pushTokenId) goneTokens.push(p.pushTokenId);
      }
    }
    if (goneTokens.length) await this.deactivate(goneTokens);
    return { checked: pending.length, delivered, failed };
  }

  private async deactivate(tokenIds: string[]) {
    const { count } = await this.db.pushToken.updateMany({
      where: { id: { in: [...new Set(tokenIds)] } },
      data: { isActive: false },
    });
    this.log.info({ devices: count }, 'devices that no longer exist were switched off');
  }
}
