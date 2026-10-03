import { logger, type FieldCipher } from '@buku/common';
import type { Database, Transaction } from '@buku/database';
import { planChannels, pushAllowed, type Reach } from './channels.js';
import { renderEmail, type EmailLinks } from './email/render.js';
import type { EmailSender } from './email/sender.js';
import type { Message } from './messages.js';
import type { PushSender } from './push/sender.js';
import type { NotificationSettings } from './settings.js';
import type { WhatsAppSender } from './whatsapp/sender.js';
import { WHATSAPP_TEMPLATES } from './whatsapp/templates.js';

/**
 * Delivering a message to people (D-071, D-073):
 *
 *  1. INBOX — always: one `in_app` row per recipient, written in the same
 *     transaction that marks the event (or scheduled message) as done, so it
 *     is never half-delivered or delivered twice.
 *  2. AFTER the commit, the outside channels chosen by `planChannels`:
 *     push to their devices, email, WhatsApp. Each send is recorded (push with
 *     its device and Expo ticket; WhatsApp with how it was priced).
 *
 * Deleted accounts get nothing. Outside channels are best effort: a failed
 * send is recorded, the inbox still has the message.
 */

export interface Delivery {
  userId: string;
  message: Message;
  appointmentId?: string | undefined;
  queueEntryId?: string | undefined;
}

export interface NotifierDeps {
  db: Database;
  push: PushSender;
  email: EmailSender;
  whatsapp: WhatsAppSender;
  settings: NotificationSettings;
  cipher: FieldCipher;
  links: EmailLinks;
  whatsappLanguage?: string;
}

/** A device seen within this many days means "uses the app". */
const APP_ACTIVE_DAYS = 60;
/** Treat the 24-hour window as closed a little early (clocks, queues). */
const WINDOW_MS = 24 * 3_600_000 - 10 * 60_000;

export const EMAIL_CONTEXT = 'users.email';
export const WHATSAPP_PHONE_CONTEXT = 'whatsapp.phone';

export class Notifier {
  private readonly log = logger.child({ module: 'notifier' });
  private readonly db: Database;
  private readonly push: PushSender;

  constructor(private readonly deps: NotifierDeps) {
    this.db = deps.db;
    this.push = deps.push;
  }

  /** Step 1, inside the transaction: the inbox rows. Returns what to send afterwards. */
  async record(tx: Transaction, deliveries: Delivery[]): Promise<Delivery[]> {
    const ids = [...new Set(deliveries.map((d) => d.userId))];
    // Soft-deleted accounts are filtered out by the database client.
    const live = new Set(
      (await tx.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id),
    );
    const kept = deliveries.filter((d) => live.has(d.userId));
    // Suggestions reach the inbox only for people who opted in (an email-only
    // recipient gets the email, not an unasked-for inbox item).
    const suggestionIds = kept.filter((d) => d.message.category === 'suggestion').map((d) => d.userId);
    const optedIn = new Set(
      suggestionIds.length
        ? (
            await tx.notificationPreference.findMany({
              where: { userId: { in: suggestionIds }, suggestions: true },
              select: { userId: true },
            })
          ).map((p) => p.userId)
        : [],
    );
    const forInbox = kept.filter((d) => d.message.category !== 'suggestion' || optedIn.has(d.userId));
    if (forInbox.length) {
      await tx.notification.createMany({
        data: forInbox.map((d) => ({
          ...refs(d),
          channel: 'in_app' as const,
          status: 'delivered' as const,
          sentAt: new Date(),
          deliveredAt: new Date(),
        })),
      });
    }
    return kept;
  }

  /** Step 2, after the commit: push, email and WhatsApp, as each person's reach and preferences allow. */
  async send(deliveries: Delivery[], now = new Date()): Promise<void> {
    if (!deliveries.length) return;
    const ids = [...new Set(deliveries.map((d) => d.userId))];
    const settings = await this.deps.settings.get();
    const [users, prefs, tokens, contacts] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, emailEncrypted: true, emailVerifiedAt: true },
      }),
      this.db.notificationPreference.findMany({ where: { userId: { in: ids } } }),
      this.db.pushToken.findMany({ where: { userId: { in: ids }, isActive: true } }),
      settings.whatsappEnabled
        ? this.db.whatsappContact.findMany({ where: { userId: { in: ids }, optedOutAt: null } })
        : Promise.resolve([]),
    ]);
    const prefOf = new Map(prefs.map((p) => [p.userId, p]));
    const userOf = new Map(users.map((u) => [u.id, u]));
    const contactOf = new Map(contacts.map((c) => [c.userId, c]));
    const activeSince = now.getTime() - APP_ACTIVE_DAYS * 86_400_000;

    // WhatsApp money: this month's use so far, counted up as we send.
    const usage = contacts.length ? await this.deps.settings.whatsappUsage(now) : null;
    let windowSent = usage?.windowMessages ?? 0;
    let spentCents = usage?.estimatedCents ?? 0;
    const cost = settings.whatsappMessageCostCents;

    const pushes: { delivery: Delivery; token: { id: string; token: string } }[] = [];
    const emails: { delivery: Delivery; to: string }[] = [];
    const chats: { delivery: Delivery; phone: string; pricing: 'window' | 'template' }[] = [];

    for (const d of deliveries) {
      const user = userOf.get(d.userId);
      if (!user) continue;
      const devices = tokens.filter((t) => t.userId === d.userId && this.push.accepts(t.token));
      const contact = contactOf.get(d.userId);
      const reach: Reach = {
        hasApp: devices.some((t) => t.lastSeenAt.getTime() >= activeSince),
        email: user.emailVerifiedAt ? this.decrypt(user.emailEncrypted, EMAIL_CONTEXT) : null,
        whatsapp: contact
          ? {
              phone: this.decrypt(contact.phoneEncrypted, WHATSAPP_PHONE_CONTEXT) ?? '',
              windowOpen: (contact.lastInboundAt?.getTime() ?? 0) > now.getTime() - WINDOW_MS,
            }
          : null,
        prefs: prefOf.get(d.userId) ?? null,
      };
      if (reach.whatsapp && !reach.whatsapp.phone) reach.whatsapp = null;
      const windowFree = windowSent < settings.whatsappFreeWindowPerMonth;
      const plan = planChannels(d.message, reach, {
        emailEnabled: settings.emailEnabled,
        whatsappEnabled: settings.whatsappEnabled,
        whatsappPaidTypes: settings.whatsappPaidTypes,
        whatsappPaidAllowed: spentCents + cost <= settings.whatsappMonthlyBudgetCents,
        whatsappWindowFree: windowFree,
      });
      // Push goes to every active device, even one not seen lately (it's free);
      // "has the app" only decides whether other channels must fill in.
      if (pushAllowed(d.message.category, reach.prefs))
        for (const token of devices) pushes.push({ delivery: d, token });
      if (plan.email && reach.email) emails.push({ delivery: d, to: reach.email });
      if (plan.whatsapp && reach.whatsapp) {
        chats.push({ delivery: d, phone: reach.whatsapp.phone, pricing: plan.whatsapp });
        if (plan.whatsapp === 'window') {
          windowSent++;
          if (!windowFree) spentCents += cost;
        } else spentCents += cost;
      }
    }

    await Promise.all([
      this.sendPushes(pushes, now),
      this.sendEmails(emails, now),
      this.sendWhatsapp(chats, now),
    ]);
  }

  private async sendPushes(sends: { delivery: Delivery; token: { id: string; token: string } }[], now: Date) {
    if (!sends.length) return;
    const tickets = await this.push.send(
      sends.map((s) => ({
        token: s.token.token,
        title: s.delivery.message.title,
        body: s.delivery.message.body,
        data: s.delivery.message.data,
      })),
    );
    await this.db.notification.createMany({
      data: sends.map((s, i) => {
        const t = tickets[i]!;
        return {
          ...refs(s.delivery),
          channel: 'push' as const,
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

  private async sendEmails(sends: { delivery: Delivery; to: string }[], now: Date) {
    if (!sends.length) return;
    const results = await Promise.all(
      sends.map((s) =>
        this.deps.email.send(renderEmail(s.to, s.delivery.userId, s.delivery.message, this.deps.links)),
      ),
    );
    await this.db.notification.createMany({
      data: sends.map((s, i) => {
        const r = results[i]!;
        return {
          ...refs(s.delivery),
          channel: 'email' as const,
          status: r.ok ? ('sent' as const) : ('failed' as const),
          externalId: r.ok ? r.id : null,
          failureReason: r.ok ? null : r.error,
          sentAt: r.ok ? now : null,
        };
      }),
    });
  }

  private async sendWhatsapp(
    sends: { delivery: Delivery; phone: string; pricing: 'window' | 'template' }[],
    now: Date,
  ) {
    if (!sends.length) return;
    const wa = this.deps.whatsapp;
    const results = await Promise.all(
      sends.map((s) => {
        const m = s.delivery.message;
        const template = WHATSAPP_TEMPLATES[m.type];
        return s.pricing === 'window'
          ? wa.sendText(s.phone, `*${m.title}*\n${m.body}`)
          : wa.sendTemplate(s.phone, template!.name, this.deps.whatsappLanguage ?? 'en', m.vars ?? []);
      }),
    );
    await this.db.notification.createMany({
      data: sends.map((s, i) => {
        const r = results[i]!;
        return {
          ...refs(s.delivery),
          channel: 'whatsapp' as const,
          whatsappPricing: s.pricing,
          status: r.ok ? ('sent' as const) : ('failed' as const),
          externalId: r.ok ? r.id : null,
          failureReason: r.ok ? null : r.error,
          sentAt: r.ok ? now : null,
        };
      }),
    });
  }

  private decrypt(value: string | null, context: string): string | null {
    if (!value) return null;
    try {
      return this.deps.cipher.decrypt(value, context);
    } catch (err) {
      this.log.error({ err, context }, 'could not decrypt a contact detail');
      return null;
    }
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

/** The columns every record of a delivery shares. */
const refs = (d: Delivery) => ({
  userId: d.userId,
  appointmentId: d.appointmentId ?? null,
  queueEntryId: d.queueEntryId ?? null,
  type: d.message.type,
  title: d.message.title,
  body: d.message.body,
  data: d.message.data,
});
