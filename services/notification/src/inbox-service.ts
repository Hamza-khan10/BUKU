import { AppError } from '@buku/common';
import type { Database } from '@buku/database';

/**
 * A person's inbox (every message also lands here, whatever their push
 * settings) and their notification preferences. Only ever their own.
 */

export interface PreferencesInput {
  pushBookingConfirmation?: boolean | undefined;
  pushReminders?: boolean | undefined;
  pushQueueUpdates?: boolean | undefined;
  pushBusinessAlerts?: boolean | undefined;
  whatsappUpdates?: boolean | undefined;
  smsReminders?: boolean | undefined;
  emailBookingConfirmation?: boolean | undefined;
  marketingEmails?: boolean | undefined;
}

/** Inbox rows only (push/WhatsApp rows are delivery records, not shown). */
const inbox = (userId: string) => ({ userId, channel: 'in_app' as const });

export class InboxService {
  constructor(private readonly db: Database) {}

  async list(userId: string, query: { unread?: boolean | undefined; page: number; limit: number }) {
    const where = { ...inbox(userId), ...(query.unread && { readAt: null }) };
    const [rows, total, unread] = await Promise.all([
      this.db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        select: { id: true, type: true, title: true, body: true, data: true, readAt: true, createdAt: true },
      }),
      this.db.notification.count({ where }),
      this.unreadCount(userId),
    ]);
    return {
      items: rows.map((r) => ({
        ...r,
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

  unreadCount(userId: string): Promise<number> {
    return this.db.notification.count({ where: { ...inbox(userId), readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.db.notification.updateMany({
      where: { ...inbox(userId), id },
      data: { readAt: new Date(), status: 'read' },
    });
    // Someone else's id looks exactly like a missing one.
    if (count === 0 && !(await this.db.notification.count({ where: { ...inbox(userId), id } }))) {
      throw AppError.notFound('Notification');
    }
  }

  async markAllRead(userId: string): Promise<number> {
    const { count } = await this.db.notification.updateMany({
      where: { ...inbox(userId), readAt: null },
      data: { readAt: new Date(), status: 'read' },
    });
    return count;
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.db.notification.deleteMany({ where: { ...inbox(userId), id } });
    if (count === 0) throw AppError.notFound('Notification');
  }

  async preferences(userId: string) {
    const row = await this.db.notificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return prefView(row);
  }

  /** Marketing needs explicit opt-in; the moment of consent is recorded (and cleared on opt-out). */
  async updatePreferences(userId: string, input: PreferencesInput) {
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const current = await this.db.notificationPreference.findUnique({ where: { userId } });
    const consent =
      input.marketingEmails === undefined
        ? {}
        : { marketingConsentAt: input.marketingEmails ? (current?.marketingConsentAt ?? new Date()) : null };
    const row = await this.db.notificationPreference.upsert({
      where: { userId },
      create: { userId, ...data, ...consent },
      update: { ...data, ...consent },
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
    marketingEmails: p.marketingEmails,
    marketingConsentAt: p.marketingConsentAt?.toISOString() ?? null,
    /** Being called in a queue is always sent; it can't be switched off. */
    queueCalledAlwaysOn: true,
  };
}
