import { AppError } from '@buku/common';
import type { DataPlane } from '@buku/database';

/**
 * A person's inbox (every message also lands here, whatever their push
 * settings) and their notification preferences. Only ever their own, on their own shard (D3f).
 * A message goes by its decimal ID (DB-042).
 */

export interface PreferencesInput {
  pushBookingConfirmation?: boolean | undefined;
  pushReminders?: boolean | undefined;
  pushQueueUpdates?: boolean | undefined;
  pushBusinessAlerts?: boolean | undefined;
  whatsappUpdates?: boolean | undefined;
  smsReminders?: boolean | undefined;
  emailBookingConfirmation?: boolean | undefined;
  emailReminders?: boolean | undefined;
  emailBusinessAlerts?: boolean | undefined;
  suggestions?: boolean | undefined;
  marketingEmails?: boolean | undefined;
}

export const UNSUBSCRIBABLE = [
  'emailBookingConfirmation',
  'emailReminders',
  'emailBusinessAlerts',
  'marketingEmails',
] as const;
export type UnsubscribablePref = (typeof UNSUBSCRIBABLE)[number];

/** Inbox rows only (push/WhatsApp rows are delivery records, not shown). */
const inbox = (userId: bigint) => ({ userId, channel: 'in_app' });

export class InboxService {
  constructor(private readonly plane: DataPlane) {}

  async list(userId: bigint, query: { unread?: boolean | undefined; page: number; limit: number }) {
    const db = await this.plane.user(userId);
    const where = { ...inbox(userId), ...(query.unread && { readAt: null }) };
    const rows = await db.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
    });
    const total = await db.notification.count({ where });
    const unread = await this.unreadCount(userId);
    return {
      items: rows.map((r) => ({
        ...r,
        id: r.id.toString(),
        readAt: r.readAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
        unread,
      },
    };
  }

  async unreadCount(userId: bigint): Promise<number> {
    return (await this.plane.user(userId)).notification.count({ where: { ...inbox(userId), readAt: null } });
  }

  async markRead(userId: bigint, id: bigint): Promise<void> {
    const db = await this.plane.user(userId);
    const { count } = await db.notification.updateMany({
      where: { ...inbox(userId), id },
      data: { readAt: new Date(), status: 'read' },
    });
    // Someone else's ID looks exactly like a missing one.
    if (count === 0 && !(await db.notification.count({ where: { ...inbox(userId), id } }))) {
      throw AppError.notFound('Notification');
    }
  }

  async markAllRead(userId: bigint): Promise<number> {
    const { count } = await (
      await this.plane.user(userId)
    ).notification.updateMany({
      where: { ...inbox(userId), readAt: null },
      data: { readAt: new Date(), status: 'read' },
    });
    return count;
  }

  async remove(userId: bigint, id: bigint): Promise<void> {
    const { count } = await (
      await this.plane.user(userId)
    ).notification.deleteMany({ where: { ...inbox(userId), id } });
    if (count === 0) throw AppError.notFound('Notification');
  }

  async preferences(userId: bigint) {
    const row = await (
      await this.plane.user(userId)
    ).notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return prefView(row);
  }

  /** From the signed link in an email: switch off exactly that kind of email. */
  async unsubscribe(userId: bigint, pref: UnsubscribablePref): Promise<void> {
    await this.updatePreferences(userId, { [pref]: false });
  }

  /** Suggestions and marketing need explicit opt-in; the moment of consent is recorded (and cleared on opt-out). */
  async updatePreferences(userId: bigint, input: PreferencesInput) {
    const db = await this.plane.user(userId);
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const row = await db.$transaction(async (tx) => {
      const current = await tx.notificationPreference.findUnique({ where: { userId } });
      const consent = {
        ...(input.marketingEmails !== undefined && {
          marketingConsentAt: input.marketingEmails ? (current?.marketingConsentAt ?? new Date()) : null,
        }),
        ...(input.suggestions !== undefined && {
          suggestionsConsentAt: input.suggestions ? (current?.suggestionsConsentAt ?? new Date()) : null,
        }),
      };
      return tx.notificationPreference.upsert({
        where: { userId },
        create: { userId, ...data, ...consent },
        update: { ...data, ...consent },
      });
    });
    return prefView(row);
  }
}

function prefView(p: {
  pushBookingConfirmation: boolean;
  pushReminders: boolean;
  pushQueueUpdates: boolean;
  pushBusinessAlerts: boolean;
  whatsappUpdates: boolean;
  smsReminders: boolean;
  emailBookingConfirmation: boolean;
  emailReminders: boolean;
  emailBusinessAlerts: boolean;
  suggestions: boolean;
  suggestionsConsentAt: Date | null;
  marketingEmails: boolean;
  marketingConsentAt: Date | null;
}) {
  return {
    pushBookingConfirmation: p.pushBookingConfirmation,
    pushReminders: p.pushReminders,
    pushQueueUpdates: p.pushQueueUpdates,
    pushBusinessAlerts: p.pushBusinessAlerts,
    whatsappUpdates: p.whatsappUpdates,
    smsReminders: p.smsReminders,
    emailBookingConfirmation: p.emailBookingConfirmation,
    emailReminders: p.emailReminders,
    emailBusinessAlerts: p.emailBusinessAlerts,
    /** Opt-in: "time for your usual…", openings at places they go (in the app, push, WhatsApp). */
    suggestions: p.suggestions,
    suggestionsConsentAt: p.suggestionsConsentAt?.toISOString() ?? null,
    marketingEmails: p.marketingEmails,
    marketingConsentAt: p.marketingConsentAt?.toISOString() ?? null,
    /** Being called in a queue, and notices about the account's plan, are always sent. */
    queueCalledAlwaysOn: true,
  };
}
