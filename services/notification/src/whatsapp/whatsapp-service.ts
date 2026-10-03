import { randomInt } from 'node:crypto';
import {
  AppError,
  ErrorCodes,
  logger,
  normalizePhone,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import { recordAudit, type Database } from '@buku/database';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { auditCtx, type RequestContext } from '../http/context.js';
import { localTime } from '../messages.js';
import { WHATSAPP_PHONE_CONTEXT } from '../notifier.js';
import type { WhatsAppSender } from './sender.js';

/**
 * Connecting WhatsApp, and what people send us there (D-074).
 *
 * CONNECTING: the app asks for a one-time code and opens WhatsApp with
 * "BUKU <code>" typed in, addressed to our number. When that message
 * arrives, the number that sent it is proven to be theirs (nobody can
 * connect someone else's number), and their free 24-hour window is open.
 *
 * INCOMING: every message from a connected person reopens their 24-hour
 * window (so our next messages to them are free). We answer:
 *  • STOP / START — WhatsApp messages off / on;
 *  • anything else — their upcoming bookings and queue tickets (free, useful,
 *    and a reason to keep the window open).
 * Unknown numbers get one line on how to connect. Replies are rate-limited
 * per number; repeated deliveries of the same webhook are ignored.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_TTL_SECONDS = 15 * 60;
const REPLIES_PER_HOUR = 6;
const STOP_WORDS = new Set(['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE']);
const CODE_IN_TEXT = /\bBUKU\s+([A-Z0-9]{6})\b/;

/** What Meta posts to the webhook; only the fields we use are checked. */
const WebhookBody = z.object({
  object: z.string(),
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              field: z.string(),
              value: z
                .object({
                  messages: z
                    .array(
                      z.object({
                        from: z.string().regex(/^\d{6,15}$/),
                        id: z.string().min(1).max(200),
                        timestamp: z.string().regex(/^\d{1,12}$/),
                        type: z.string().max(30),
                        text: z.object({ body: z.string().max(4096) }).optional(),
                        button: z.object({ text: z.string().max(200) }).optional(),
                      }),
                    )
                    .max(100)
                    .optional(),
                  statuses: z
                    .array(
                      z.object({
                        id: z.string().min(1).max(500),
                        status: z.string().max(30),
                        errors: z.array(z.object({ code: z.number() })).optional(),
                      }),
                    )
                    .max(500)
                    .optional(),
                })
                .loose(),
            }),
          )
          .max(100),
      }),
    )
    .max(100),
});

export interface WhatsAppServiceDeps {
  db: Database;
  redis: Redis;
  sender: WhatsAppSender;
  cipher: FieldCipher;
  indexer: BlindIndexer;
  /** Our number, E.164 (undefined: connecting isn't available). */
  businessNumber: string | undefined;
}

export class WhatsAppService {
  private readonly log = logger.child({ module: 'whatsapp' });

  constructor(private readonly deps: WhatsAppServiceDeps) {}

  // ── For the signed-in person ──────────────────────────────────────────────

  async status(userId: string) {
    const c = await this.deps.db.whatsappContact.findUnique({ where: { userId } });
    if (!c) return { connected: false as const, available: Boolean(this.deps.businessNumber) };
    const phone = this.deps.cipher.decrypt(c.phoneEncrypted, WHATSAPP_PHONE_CONTEXT);
    return {
      connected: true as const,
      available: Boolean(this.deps.businessNumber),
      phone: mask(phone),
      connectedAt: c.linkedAt.toISOString(),
      stopped: c.optedOutAt !== null,
    };
  }

  /** A one-time code, and the WhatsApp link with it typed in. A new code replaces the last one. */
  async startLink(userId: string) {
    const number = this.deps.businessNumber;
    if (!number) {
      throw new AppError('WhatsApp isn’t available yet', ErrorCodes.SERVICE_UNAVAILABLE, 503);
    }
    const r = this.deps.redis;
    const previous = await r.get(`wa:link:user:${userId}`);
    if (previous) await r.del(`wa:link:${previous}`);
    let code = '';
    for (let tries = 0; tries < 5; tries++) {
      code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      if ((await r.set(`wa:link:${code}`, userId, 'EX', CODE_TTL_SECONDS, 'NX')) === 'OK') break;
      code = '';
    }
    if (!code) throw new AppError('Please try again', ErrorCodes.SERVICE_UNAVAILABLE, 503);
    await r.set(`wa:link:user:${userId}`, code, 'EX', CODE_TTL_SECONDS);
    const text = `BUKU ${code}`;
    return {
      code,
      text,
      link: `https://wa.me/${number.slice(1)}?text=${encodeURIComponent(text)}`,
      expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  async disconnect(userId: string, ctx: RequestContext): Promise<void> {
    await this.deps.db.$transaction(async (tx) => {
      const { count } = await tx.whatsappContact.deleteMany({ where: { userId } });
      if (!count) throw AppError.notFound('WhatsApp connection');
      await recordAudit(tx, {
        userId,
        action: 'whatsapp.disconnected',
        resourceType: 'whatsapp_contact',
        resourceId: userId,
        ...auditCtx(ctx),
      });
    });
  }

  // ── Webhook from Meta ─────────────────────────────────────────────────────

  /** Signature already checked by the route. Never throws on content: Meta would retry forever. */
  async handleWebhook(raw: unknown, now = new Date()): Promise<{ messages: number; statuses: number }> {
    const parsed = WebhookBody.safeParse(raw);
    if (!parsed.success || parsed.data.object !== 'whatsapp_business_account') {
      this.log.warn('unrecognised WhatsApp webhook ignored');
      return { messages: 0, statuses: 0 };
    }
    let messages = 0;
    let statuses = 0;
    for (const entry of parsed.data.entry) {
      for (const change of entry.changes) {
        if (change.field !== 'messages') continue;
        for (const s of change.value.statuses ?? []) {
          await this.onStatus(s, now);
          statuses++;
        }
        for (const m of change.value.messages ?? []) {
          // Meta retries: each message is handled once.
          if ((await this.deps.redis.set(`wa:in:${m.id}`, '1', 'EX', 3 * 86_400, 'NX')) !== 'OK') continue;
          // Old messages (a replayed webhook) change nothing.
          if (now.getTime() - Number(m.timestamp) * 1000 > 86_400_000) continue;
          await this.onMessage(`+${m.from}`, (m.text?.body ?? m.button?.text ?? '').trim(), now).catch(
            (err: unknown) => this.log.error({ err }, 'incoming WhatsApp message failed'),
          );
          messages++;
        }
      }
    }
    return { messages, statuses };
  }

  private async onStatus(
    s: { id: string; status: string; errors?: { code: number }[] | undefined },
    now: Date,
  ) {
    const where = {
      channel: 'whatsapp' as const,
      externalId: s.id,
      createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
    };
    if (s.status === 'delivered') {
      await this.deps.db.notification.updateMany({
        where: { ...where, status: 'sent' },
        data: { status: 'delivered', deliveredAt: now },
      });
    } else if (s.status === 'read') {
      await this.deps.db.notification.updateMany({
        where: { ...where, status: { in: ['sent', 'delivered'] } },
        data: { status: 'read', readAt: now },
      });
    } else if (s.status === 'failed') {
      await this.deps.db.notification.updateMany({
        where,
        data: { status: 'failed', failureReason: `meta_${s.errors?.[0]?.code ?? 'failed'}` },
      });
    }
  }

  private async onMessage(phone: string, text: string, now: Date) {
    const e164 = normalizePhone(phone);
    const hash = this.deps.indexer.hash(WHATSAPP_PHONE_CONTEXT, e164);
    const upper = text.toUpperCase().replace(/\s+/g, ' ');

    const code = CODE_IN_TEXT.exec(upper)?.[1];
    if (code) {
      const userId = await this.deps.redis.getdel(`wa:link:${code}`);
      if (!userId) return this.reply(e164, hash, null, LINES.codeExpired);
      await this.deps.redis.del(`wa:link:user:${userId}`);
      await this.connect(userId, e164, hash, now);
      return this.reply(e164, hash, userId, LINES.connected);
    }

    const contact = await this.deps.db.whatsappContact.findUnique({ where: { phoneHash: hash } });
    if (!contact) return this.reply(e164, hash, null, LINES.unknown);
    // Their message opens (or extends) the free 24-hour window.
    await this.deps.db.whatsappContact.update({
      where: { userId: contact.userId },
      data: { lastInboundAt: now },
    });
    if (STOP_WORDS.has(upper)) {
      await this.deps.db.whatsappContact.update({
        where: { userId: contact.userId },
        data: { optedOutAt: now },
      });
      return this.reply(e164, hash, contact.userId, LINES.stopped);
    }
    if (START_WORDS.has(upper)) {
      await this.deps.db.whatsappContact.update({
        where: { userId: contact.userId },
        data: { optedOutAt: null },
      });
      return this.reply(e164, hash, contact.userId, LINES.started);
    }
    return this.reply(e164, hash, contact.userId, await this.upcoming(contact.userId, now));
  }

  /** The number now belongs to this account (moved from another one if it was there). */
  private async connect(userId: string, phone: string, hash: string, now: Date) {
    await this.deps.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user) return; // account deleted in the meantime
      await tx.whatsappContact.deleteMany({ where: { phoneHash: hash, userId: { not: userId } } });
      const data = {
        phoneEncrypted: this.deps.cipher.encrypt(phone, WHATSAPP_PHONE_CONTEXT),
        phoneHash: hash,
        linkedAt: now,
        lastInboundAt: now,
        optedOutAt: null,
      };
      await tx.whatsappContact.upsert({ where: { userId }, create: { userId, ...data }, update: data });
      // Connecting is asking for WhatsApp messages.
      await tx.notificationPreference.upsert({
        where: { userId },
        create: { userId, whatsappUpdates: true },
        update: { whatsappUpdates: true },
      });
      await recordAudit(tx, {
        userId,
        action: 'whatsapp.connected',
        resourceType: 'whatsapp_contact',
        resourceId: userId,
      });
    });
  }

  private async upcoming(userId: string, now: Date): Promise<string> {
    const [appointments, tickets] = await Promise.all([
      this.deps.db.appointment.findMany({
        where: { userId, status: { in: ['confirmed', 'pending'] }, startAt: { gt: now } },
        orderBy: { startAt: 'asc' },
        take: 3,
        include: {
          business: { select: { name: true, timezone: true } },
          service: { select: { name: true } },
        },
      }),
      this.deps.db.queueEntry.findMany({
        where: { userId, status: { in: ['waiting', 'called'] } },
        include: { session: { include: { business: { select: { name: true } } } } },
        take: 3,
      }),
    ]);
    if (!appointments.length && !tickets.length) return LINES.nothingUpcoming;
    const lines = [
      ...appointments.map(
        (a) =>
          `• ${a.service.name} at ${a.business.name}, ${localTime(a.startAt, a.business.timezone)}${
            a.status === 'pending'
              ? ' (waiting for the business to confirm)'
              : ` — code ${a.confirmationCode}`
          }`,
      ),
      ...tickets.map(
        (t) =>
          `• Queue at ${t.session.business.name}: ticket ${t.ticketPrefix}-${String(t.ticketNumber).padStart(3, '0')}${
            t.status === 'called' ? ' — it’s your turn!' : ''
          }`,
      ),
    ];
    return `Your upcoming visits:\n${lines.join('\n')}\n\nManage them in the BUKU app. Reply STOP to turn off WhatsApp messages.`;
  }

  /** A free reply (they just messaged us). Rate-limited per number; recorded for known accounts. */
  private async reply(phone: string, hash: string, userId: string | null, text: string) {
    const key = `wa:reply:${hash}`;
    const n = await this.deps.redis.incr(key);
    if (n === 1) await this.deps.redis.expire(key, 3600);
    if (n > REPLIES_PER_HOUR) return;
    const r = await this.deps.sender.sendText(phone, text);
    if (!userId) return;
    await this.deps.db.notification.create({
      data: {
        userId,
        type: 'whatsapp_reply',
        channel: 'whatsapp',
        whatsappPricing: 'window',
        title: 'WhatsApp reply',
        body: text,
        status: r.ok ? 'sent' : 'failed',
        externalId: r.ok ? r.id : null,
        failureReason: r.ok ? null : r.error,
        sentAt: r.ok ? new Date() : null,
      },
    });
  }
}

const LINES = {
  connected:
    '✅ WhatsApp is connected to your BUKU account. You’ll get booking updates here.\n\nSend any message to see your upcoming visits. Reply STOP to turn WhatsApp messages off.',
  codeExpired:
    'That code has expired or was already used. In the BUKU app, go to Settings → WhatsApp and try again.',
  unknown:
    'Hi! This is BUKU. To get booking updates here, open the BUKU app → Settings → WhatsApp → Connect.',
  stopped: 'WhatsApp messages from BUKU are off. Reply START any time to turn them back on.',
  started: 'WhatsApp messages from BUKU are back on. Reply STOP to turn them off.',
  nothingUpcoming:
    'You have no upcoming visits. Book in the BUKU app any time. Reply STOP to turn off WhatsApp messages.',
};

/** "+92 ••••• 4567": enough to recognise, not enough to copy. */
function mask(e164: string): string {
  return `${e164.slice(0, 3)} ••••• ${e164.slice(-4)}`;
}
