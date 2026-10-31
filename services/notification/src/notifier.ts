import { logger, type FieldCipher } from '@buku/common';
import { type DataPlane, type UserShardClient, type UserTx } from '@buku/database';
import { planChannels, pushAllowed, type Reach } from './channels.js';
import { renderEmail, type EmailLinks } from './email/render.js';
import type { EmailSender } from './email/sender.js';
import type { Message } from './messages.js';
import type { PushSender } from './push/sender.js';
import type { NotificationSettings } from './settings.js';
import type { WhatsAppSender } from './whatsapp/sender.js';
import { WHATSAPP_TEMPLATES } from './whatsapp/templates.js';

/**
 * Delivering a message to people (D-071, D-073), on database v2 (D3f): everything about a person's
 * messages lives on their own user shard.
 *
 *  1. INBOX — always: one `in_app` row per recipient, written on their shard in the same
 *     transaction that records the message as handled there (the event, or the scheduled
 *     message's mark), so it is never half-delivered or delivered twice.
 *  2. AFTER that commit, the outside channels chosen by `planChannels`: push to their devices,
 *     email, WhatsApp. Each send is recorded on their shard (push with its device and Expo
 *     ticket; WhatsApp with how it was priced).
 *
 * Closed accounts get nothing. Outside channels are best effort: a failed send is recorded, the
 * inbox still has the message.
 */

export interface Delivery {
  userId: bigint;
  message: Message;
  /** What it is about (on a business shard). */
  appointmentId?: bigint | undefined;
  queueTicketId?: bigint | undefined;
}

export interface NotifierDeps {
  plane: DataPlane;
  push: PushSender;
  email: EmailSender;
  whatsapp: WhatsAppSender;
  settings: NotificationSettings;
  cipher: FieldCipher;
  links: EmailLinks;
  whatsappLanguage?: string;
}

/**
 * Inside a recipient shard's transaction: which of these people the message is still news to
 * (an event not yet handled on this shard; a scheduled message not yet marked as sent to them).
 */
export type Claim = (tx: UserTx, userIds: bigint[]) => Promise<readonly bigint[]>;

/** A device seen within this many days means "uses the app". */
const APP_ACTIVE_DAYS = 60;
/** Treat the 24-hour window as closed a little early (clocks, queues). */
const WINDOW_MS = 24 * 3_600_000 - 10 * 60_000;

/** Encryption contexts (DB-008): the same as auth-service's for the email it stores. */
export const EMAIL_CONTEXT = 'users.email';
export const WHATSAPP_PHONE_CONTEXT = 'whatsapp.phone';

export class Notifier {
  private readonly log = logger.child({ module: 'notifier' });

  constructor(private readonly deps: NotifierDeps) {}

  /**
   * The whole delivery: each shard's recipients in one transaction there (`claim` decides who it
   * is still news to; their inbox rows follow), then their outside channels after that commit.
   * Returns what was delivered. A shard that fails throws after the others are done: run again,
   * it delivers only what is missing.
   */
  async deliver(deliveries: Delivery[], claim: Claim): Promise<Delivery[]> {
    const delivered: Delivery[] = [];
    const failures: unknown[] = [];
    for (const [db, ids] of await this.deps.plane.usersByShard(deliveries.map((d) => d.userId))) {
      const here = deliveries.filter((d) => ids.includes(d.userId));
      try {
        const kept = await db.$transaction(async (tx) => {
          const fresh = new Set(await claim(tx, ids));
          return this.record(
            tx,
            here.filter((d) => fresh.has(d.userId)),
          );
        });
        delivered.push(...kept);
        // After the commit. A failed push must not make the message go again (the inbox is done).
        await this.send(kept).catch((err: unknown) => this.log.error({ err }, 'sending failed'));
      } catch (err) {
        failures.push(err);
      }
    }
    if (failures.length) {
      throw failures[0] instanceof Error
        ? failures[0]
        : new Error('a delivery failed on a user shard', { cause: failures[0] });
    }
    return delivered;
  }

  /** Step 1, inside a transaction on the recipients' shard: their inbox rows. Returns what to send. */
  async record(tx: UserTx, deliveries: Delivery[]): Promise<Delivery[]> {
    if (!deliveries.length) return [];
    const ids = [...new Set(deliveries.map((d) => d.userId))];
    const live = new Set(
      (await tx.user.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })).map(
        (u) => u.id,
      ),
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
      const now = new Date();
      await tx.notification.createMany({
        data: forInbox.map((d) => ({
          id: this.deps.plane.id(),
          ...refs(d),
          channel: 'in_app',
          status: 'delivered',
          sentAt: now,
          deliveredAt: now,
        })),
      });
    }
    return kept;
  }

  /** Step 2, after the commit: push, email and WhatsApp, as each person's reach and preferences allow. */
  async send(deliveries: Delivery[], now = new Date()): Promise<void> {
    if (!deliveries.length) return;
    const settings = await this.deps.settings.get();
    // WhatsApp money: this month's use so far, counted up as we send (only asked when it may be used).
    let usage: { windowSent: number; spentCents: number } | null = null;
    const cost = settings.whatsappMessageCostCents;

    for (const [db, ids] of await this.deps.plane.usersByShard(deliveries.map((d) => d.userId))) {
      const [users, prefs, tokens, contacts] = [
        await db.user.findMany({
          where: { id: { in: ids }, deletedAt: null },
          select: { id: true, publicId: true, emailEnc: true, emailVerifiedAt: true },
        }),
        await db.notificationPreference.findMany({ where: { userId: { in: ids } } }),
        await db.pushToken.findMany({ where: { userId: { in: ids }, isActive: true } }),
        settings.whatsappEnabled
          ? await db.whatsappContact.findMany({ where: { userId: { in: ids }, optedOutAt: null } })
          : [],
      ];
      if (contacts.length && !usage) {
        const u = await this.deps.settings.whatsappUsage(now);
        usage = { windowSent: u.windowMessages, spentCents: u.estimatedCents };
      }
      const prefOf = new Map(prefs.map((p) => [p.userId, p]));
      const userOf = new Map(users.map((u) => [u.id, u]));
      const contactOf = new Map(contacts.map((c) => [c.userId, c]));
      const activeSince = now.getTime() - APP_ACTIVE_DAYS * 86_400_000;

      const pushes: { delivery: Delivery; token: { id: bigint; token: string } }[] = [];
      const emails: { delivery: Delivery; to: string; publicId: string }[] = [];
      const chats: { delivery: Delivery; phone: string; pricing: 'window' | 'template' }[] = [];

      for (const d of deliveries.filter((x) => ids.includes(x.userId))) {
        const user = userOf.get(d.userId);
        if (!user) continue;
        const devices = tokens.filter((t) => t.userId === d.userId && this.deps.push.accepts(t.token));
        const contact = contactOf.get(d.userId);
        const reach: Reach = {
          hasApp: devices.some((t) => t.lastSeenAt.getTime() >= activeSince),
          email: user.emailVerifiedAt ? this.decrypt(user.emailEnc, EMAIL_CONTEXT) : null,
          whatsapp: contact
            ? {
                phone: this.decrypt(contact.phoneEnc, WHATSAPP_PHONE_CONTEXT) ?? '',
                windowOpen: (contact.lastInboundAt?.getTime() ?? 0) > now.getTime() - WINDOW_MS,
              }
            : null,
          prefs: prefOf.get(d.userId) ?? null,
        };
        if (reach.whatsapp && !reach.whatsapp.phone) reach.whatsapp = null;
        const windowFree = (usage?.windowSent ?? 0) < settings.whatsappFreeWindowPerMonth;
        const plan = planChannels(d.message, reach, {
          emailEnabled: settings.emailEnabled,
          whatsappEnabled: settings.whatsappEnabled,
          whatsappPaidTypes: settings.whatsappPaidTypes,
          whatsappPaidAllowed: (usage?.spentCents ?? 0) + cost <= settings.whatsappMonthlyBudgetCents,
          whatsappWindowFree: windowFree,
        });
        // Push goes to every active device, even one not seen lately (it's free);
        // "has the app" only decides whether other channels must fill in.
        if (pushAllowed(d.message.category, reach.prefs))
          for (const token of devices) pushes.push({ delivery: d, token });
        if (plan.email && reach.email) emails.push({ delivery: d, to: reach.email, publicId: user.publicId });
        if (plan.whatsapp && reach.whatsapp && usage) {
          chats.push({ delivery: d, phone: reach.whatsapp.phone, pricing: plan.whatsapp });
          if (plan.whatsapp === 'window') {
            usage.windowSent++;
            if (!windowFree) usage.spentCents += cost;
          } else usage.spentCents += cost;
        }
      }

      await Promise.all([
        this.sendPushes(db, pushes, now),
        this.sendEmails(db, emails, now),
        this.sendWhatsapp(db, chats, now),
      ]);
    }
  }

  private async sendPushes(
    db: UserShardClient,
    sends: { delivery: Delivery; token: { id: bigint; token: string } }[],
    now: Date,
  ) {
    if (!sends.length) return;
    const tickets = await this.deps.push.send(
      sends.map((s) => ({
        token: s.token.token,
        title: s.delivery.message.title,
        body: s.delivery.message.body,
        data: s.delivery.message.data,
      })),
    );
    await db.notification.createMany({
      data: sends.map((s, i) => {
        const t = tickets[i]!;
        return {
          id: this.deps.plane.id(),
          ...refs(s.delivery),
          channel: 'push',
          pushTokenId: s.token.id,
          status: t.ok ? 'sent' : 'failed',
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
    if (gone.length)
      await this.deactivate(
        db,
        gone.map((s) => s.token.id),
      );
  }

  private async sendEmails(
    db: UserShardClient,
    sends: { delivery: Delivery; to: string; publicId: string }[],
    now: Date,
  ) {
    if (!sends.length) return;
    const results = await Promise.all(
      sends.map((s) =>
        // The unsubscribe link names the person by their public ID (DB-042).
        this.deps.email.send(renderEmail(s.to, s.publicId, s.delivery.message, this.deps.links)),
      ),
    );
    await db.notification.createMany({
      data: sends.map((s, i) => {
        const r = results[i]!;
        return {
          id: this.deps.plane.id(),
          ...refs(s.delivery),
          channel: 'email',
          status: r.ok ? 'sent' : 'failed',
          externalId: r.ok ? r.id : null,
          failureReason: r.ok ? null : r.error,
          sentAt: r.ok ? now : null,
        };
      }),
    });
  }

  private async sendWhatsapp(
    db: UserShardClient,
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
    await db.notification.createMany({
      data: sends.map((s, i) => {
        const r = results[i]!;
        return {
          id: this.deps.plane.id(),
          ...refs(s.delivery),
          channel: 'whatsapp',
          whatsappPricing: s.pricing,
          status: r.ok ? 'sent' : 'failed',
          externalId: r.ok ? r.id : null,
          failureReason: r.ok ? null : r.error,
          sentAt: r.ok ? now : null,
        };
      }),
    });
  }

  private decrypt(value: Uint8Array | null, context: string): string | null {
    if (!value) return null;
    try {
      return this.deps.cipher.decryptBytes(value, context);
    } catch (err) {
      this.log.error({ err, context }, 'could not decrypt a contact detail');
      return null;
    }
  }

  /**
   * Receipts for pushes sent 15 minutes to 24 hours ago, shard by shard: delivered or failed;
   * devices that no longer exist are switched off. Run periodically.
   */
  async checkReceipts(now = new Date()): Promise<{ checked: number; delivered: number; failed: number }> {
    const totals = { checked: 0, delivered: 0, failed: 0 };
    await this.deps.plane.acrossUsers(async (db) => {
      const pending = await db.notification.findMany({
        where: {
          channel: 'push',
          status: 'sent',
          externalId: { not: null },
          sentAt: {
            lte: new Date(now.getTime() - 15 * 60_000),
            gte: new Date(now.getTime() - 24 * 3_600_000),
          },
          createdAt: { gte: new Date(now.getTime() - 25 * 3_600_000) }, // partition pruning
        },
        select: { id: true, createdAt: true, externalId: true, pushTokenId: true },
        take: 5000,
      });
      if (!pending.length) return;
      totals.checked += pending.length;
      const receipts = await this.deps.push.receipts(pending.map((p) => p.externalId!));
      const goneTokens: bigint[] = [];
      for (const p of pending) {
        const r = receipts.get(p.externalId!);
        if (!r) continue; // not ready yet
        const where = { id: p.id, createdAt: p.createdAt };
        if (r.ok) {
          totals.delivered++;
          await db.notification.updateMany({ where, data: { status: 'delivered', deliveredAt: now } });
        } else {
          totals.failed++;
          await db.notification.updateMany({ where, data: { status: 'failed', failureReason: r.error } });
          if (r.deviceGone && p.pushTokenId) goneTokens.push(p.pushTokenId);
        }
      }
      if (goneTokens.length) await this.deactivate(db, goneTokens);
    });
    return totals;
  }

  private async deactivate(db: UserShardClient, tokenIds: bigint[]) {
    const { count } = await db.pushToken.updateMany({
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
  queueTicketId: d.queueTicketId ?? null,
  type: d.message.type,
  title: d.message.title,
  body: d.message.body,
  data: d.message.data,
});
