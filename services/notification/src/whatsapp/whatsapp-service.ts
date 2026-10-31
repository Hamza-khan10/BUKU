import { randomInt } from 'node:crypto';
import {
  AppError,
  ErrorCodes,
  logger,
  normalizePhone,
  type BlindIndexer,
  type FieldCipher,
} from '@buku/common';
import { recordShardAudit, ShardNotFoundError, type DataPlane, type UserShardClient } from '@buku/database';
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
 *
 * Database v2 (D3f): the connection is on the person's own shard; the `user.whatsapp` handle (the
 * number's blind index, DB-018) says whose number it is, so an incoming message finds its shard,
 * and a number belongs to one account at a time. A closed account lets its number go at once.
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I
const CODE_TTL_SECONDS = 15 * 60;
const REPLIES_PER_HOUR = 6;
const STOP_WORDS = new Set(['STOP', 'STOP ALL', 'UNSUBSCRIBE', 'OPT OUT', 'OPTOUT']);
const START_WORDS = new Set(['START', 'UNSTOP', 'SUBSCRIBE']);
const CODE_IN_TEXT = /\bBUKU\s+([A-Z0-9]{6})\b/;
const HANDLE = 'user.whatsapp';
const LIVE_TICKET = ['waiting', 'called'] as const;

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
                        /** Whose message it was: finds the person's shard. */
                        recipient_id: z
                          .string()
                          .regex(/^\d{6,15}$/)
                          .optional(),
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
  plane: DataPlane;
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

  async status(userId: bigint) {
    const c = await (await this.deps.plane.user(userId)).whatsappContact.findUnique({ where: { userId } });
    if (!c) return { connected: false as const, available: Boolean(this.deps.businessNumber) };
    const phone = this.deps.cipher.decryptBytes(c.phoneEnc, WHATSAPP_PHONE_CONTEXT);
    return {
      connected: true as const,
      available: Boolean(this.deps.businessNumber),
      phone: mask(phone),
      connectedAt: c.linkedAt.toISOString(),
      stopped: c.optedOutAt !== null,
    };
  }

  /** A one-time code, and the WhatsApp link with it typed in. A new code replaces the last one. */
  async startLink(userId: bigint) {
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
      if ((await r.set(`wa:link:${code}`, userId.toString(), 'EX', CODE_TTL_SECONDS, 'NX')) === 'OK') break;
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

  async disconnect(userId: bigint, ctx: RequestContext): Promise<void> {
    const db = await this.deps.plane.user(userId);
    const hash = await db.$transaction(async (tx) => {
      const c = await tx.whatsappContact.findUnique({ where: { userId }, select: { phoneHash: true } });
      if (!c) throw AppError.notFound('WhatsApp connection');
      await tx.whatsappContact.deleteMany({ where: { userId } });
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId,
        action: 'whatsapp.disconnected',
        resourceType: 'whatsapp_contact',
        resourceId: userId,
        ...auditCtx(ctx),
      });
      return Buffer.from(c.phoneHash);
    });
    // The row first, then the handle: a handle always leads to a connection (D-113).
    await this.deps.plane.handles.release(HANDLE, hash, userId);
  }

  /** A closed account (users.deleted): its number is let go at once. Returns whether it had one. */
  async forget(userId: bigint): Promise<boolean> {
    const db = await this.deps.plane.user(userId).catch((err: unknown) => {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    });
    if (!db) return false;
    const c = await db.whatsappContact.findUnique({ where: { userId }, select: { phoneHash: true } });
    if (!c) return false;
    await db.whatsappContact.deleteMany({ where: { userId } });
    await this.deps.plane.handles.release(HANDLE, Buffer.from(c.phoneHash), userId);
    return true;
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
          await this.onStatus(s, now).catch((err: unknown) =>
            this.log.error({ err }, 'WhatsApp delivery status failed'),
          );
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

  /** Delivered / read / failed, on the shard of the person the message went to. */
  private async onStatus(
    s: {
      id: string;
      status: string;
      recipient_id?: string | undefined;
      errors?: { code: number }[] | undefined;
    },
    now: Date,
  ) {
    if (!s.recipient_id) return;
    const owner = await this.ownerOf(this.hashOf(`+${s.recipient_id}`));
    if (!owner) return;
    const where = {
      userId: owner.userId,
      channel: 'whatsapp',
      externalId: s.id,
      createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) },
    };
    if (s.status === 'delivered') {
      await owner.db.notification.updateMany({
        where: { ...where, status: 'sent' },
        data: { status: 'delivered', deliveredAt: now },
      });
    } else if (s.status === 'read') {
      await owner.db.notification.updateMany({
        where: { ...where, status: { in: ['sent', 'delivered'] } },
        data: { status: 'read', readAt: now },
      });
    } else if (s.status === 'failed') {
      await owner.db.notification.updateMany({
        where,
        data: { status: 'failed', failureReason: `meta_${s.errors?.[0]?.code ?? 'failed'}` },
      });
    }
  }

  private async onMessage(phone: string, text: string, now: Date) {
    const e164 = normalizePhone(phone);
    const hash = this.hashOf(e164);
    const upper = text.toUpperCase().replace(/\s+/g, ' ');

    const code = CODE_IN_TEXT.exec(upper)?.[1];
    if (code) {
      const linking = await this.deps.redis.getdel(`wa:link:${code}`);
      if (!linking) return this.reply(e164, hash, null, LINES.codeExpired);
      await this.deps.redis.del(`wa:link:user:${linking}`);
      const userId = BigInt(linking);
      const connected = await this.connect(userId, e164, hash, now);
      return this.reply(e164, hash, connected ? userId : null, LINES.connected);
    }

    const owner = await this.ownerOf(hash);
    const contact = owner && (await owner.db.whatsappContact.findUnique({ where: { userId: owner.userId } }));
    if (!owner || !contact || !Buffer.from(contact.phoneHash).equals(hash))
      return this.reply(e164, hash, null, LINES.unknown);
    const { db, userId } = owner;
    // Their message opens (or extends) the free 24-hour window.
    await db.whatsappContact.update({ where: { userId }, data: { lastInboundAt: now } });
    if (STOP_WORDS.has(upper)) {
      await db.whatsappContact.update({ where: { userId }, data: { optedOutAt: now } });
      return this.reply(e164, hash, userId, LINES.stopped);
    }
    if (START_WORDS.has(upper)) {
      await db.whatsappContact.update({ where: { userId }, data: { optedOutAt: null } });
      return this.reply(e164, hash, userId, LINES.started);
    }
    return this.reply(e164, hash, userId, await this.upcoming(db, userId, now));
  }

  /**
   * The number now belongs to this account (moved from another one if it was there): the row on
   * their shard first, then the handle. False if the account was closed meanwhile.
   */
  private async connect(
    userId: bigint,
    phone: string,
    hash: Buffer<ArrayBuffer>,
    now: Date,
  ): Promise<boolean> {
    const db = await this.deps.plane.user(userId).catch((err: unknown) => {
      if (err instanceof ShardNotFoundError) return null;
      throw err;
    });
    if (!db) return false;
    const previous = await this.deps.plane.handles.find(HANDLE, hash);
    if (previous !== null && previous !== userId) {
      const theirs = await this.deps.plane.user(previous).catch(() => null);
      await theirs?.whatsappContact.deleteMany({ where: { userId: previous, phoneHash: hash } });
    }
    const old = await db.$transaction(async (tx) => {
      const user = await tx.user.findFirst({ where: { id: userId, deletedAt: null }, select: { id: true } });
      if (!user) return null; // account closed in the meantime
      const before = await tx.whatsappContact.findUnique({ where: { userId }, select: { phoneHash: true } });
      await tx.whatsappContact.deleteMany({ where: { phoneHash: hash, userId: { not: userId } } });
      const data = {
        phoneEnc: this.deps.cipher.encryptBytes(phone, WHATSAPP_PHONE_CONTEXT),
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
      await recordShardAudit(tx, this.deps.plane.id(), {
        userId,
        action: 'whatsapp.connected',
        resourceType: 'whatsapp_contact',
        resourceId: userId,
      });
      return { previousHash: before ? Buffer.from(before.phoneHash) : null };
    });
    if (!old) return false;
    await this.deps.plane.handles.claim(HANDLE, hash, userId, true);
    // A different number than before: the old one is free again.
    if (old.previousHash && !old.previousHash.equals(hash))
      await this.deps.plane.handles.release(HANDLE, old.previousHash, userId);
    return true;
  }

  /** Their next appointments (from their own list) and their place in line, with the codes. */
  private async upcoming(db: UserShardClient, userId: bigint, now: Date): Promise<string> {
    const appointments = await db.userAppointment.findMany({
      where: { userId, status: { in: ['confirmed', 'pending'] }, startAt: { gt: now } },
      orderBy: { startAt: 'asc' },
      take: 3,
    });
    const lines: string[] = [];
    for (const a of appointments) {
      const there = await this.deps.plane
        .inBusiness(a.businessId, (tx) =>
          tx.appointment.findFirst({
            where: { id: a.appointmentId, startAt: a.startAt },
            select: { code: true, business: { select: { timezone: true } } },
          }),
        )
        .catch(() => null);
      if (!there) continue;
      lines.push(
        `• ${a.serviceName} at ${a.businessName}, ${localTime(a.startAt, there.business.timezone)}${
          a.status === 'pending' ? ' (waiting for the business to confirm)' : ` — code ${there.code}`
        }`,
      );
    }
    const mine = await db.userActiveTicket.findUnique({ where: { userId } });
    const ticket =
      mine &&
      (await this.deps.plane
        .inBusiness(mine.businessId, (tx) =>
          tx.queueTicket.findFirst({
            where: {
              id: mine.ticketId,
              sessionDate: mine.ticketSessionDate,
              status: { in: [...LIVE_TICKET] },
            },
            include: { business: { select: { name: true } } },
          }),
        )
        .catch(() => null));
    if (ticket) {
      lines.push(
        `• Queue at ${ticket.business.name}: ticket ${ticket.ticketPrefix}-${String(ticket.ticketNumber).padStart(3, '0')}${
          ticket.status === 'called' ? ' — it’s your turn!' : ''
        }`,
      );
    }
    if (!lines.length) return LINES.nothingUpcoming;
    return `Your upcoming visits:\n${lines.join('\n')}\n\nManage them in the BUKU app. Reply STOP to turn off WhatsApp messages.`;
  }

  /** A free reply (they just messaged us). Rate-limited per number; recorded for known accounts. */
  private async reply(phone: string, hash: Buffer<ArrayBuffer>, userId: bigint | null, text: string) {
    const key = `wa:reply:${hash.toString('hex')}`;
    const n = await this.deps.redis.incr(key);
    if (n === 1) await this.deps.redis.expire(key, 3600);
    if (n > REPLIES_PER_HOUR) return;
    const r = await this.deps.sender.sendText(phone, text);
    if (!userId) return;
    await (
      await this.deps.plane.user(userId)
    ).notification.create({
      data: {
        id: this.deps.plane.id(),
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

  /** The number's blind index (DB-008): the handle's key and the row's lookup. */
  private hashOf(e164: string): Buffer<ArrayBuffer> {
    return this.deps.indexer.digest16(WHATSAPP_PHONE_CONTEXT, normalizePhone(e164));
  }

  /** Whose number this is, and their shard. */
  private async ownerOf(hash: Buffer<ArrayBuffer>): Promise<{ userId: bigint; db: UserShardClient } | null> {
    const userId = await this.deps.plane.handles.find(HANDLE, hash);
    if (userId === null) return null;
    const db = await this.deps.plane.user(userId).catch(() => null);
    return db && { userId, db };
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
