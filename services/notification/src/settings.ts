import { AppError } from '@buku/common';
import { recordShardAudit, type DataPlane } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';
import { PAYABLE_TYPES } from './whatsapp/templates.js';

/**
 * Admin settings for notifications (D-073), one row of reference data on the directory (DB-015,
 * D3f): notification-service edits it there and every shard gets a copy by replication. Read on
 * every send, so it's cached briefly; a change applies everywhere within CACHE_MS. Also the
 * month's WhatsApp usage and estimated spend, which the budget is checked against.
 */

export interface Settings {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappPaidTypes: string[];
  whatsappMonthlyBudgetCents: number;
  whatsappMessageCostCents: number;
  whatsappFreeWindowPerMonth: number;
  reminder24h: boolean;
  reminder2h: boolean;
  quietStartHour: number;
  quietEndHour: number;
  suggestionsEnabled: boolean;
  suggestionMinDays: number;
  suggestionMaxPer30Days: number;
  suggestionMaxIgnored: number;
  updatedAt: string;
}

export type SettingsInput = Partial<Omit<Settings, 'updatedAt'>>;

export interface WhatsappUsage {
  month: string;
  windowMessages: number;
  templateMessages: number;
  /** Window messages beyond the free allowance plus every template, at the configured price. */
  estimatedCents: number;
  budgetCents: number;
}

const CACHE_MS = 30_000;
const ROW = { id: 1 } as const;

export class NotificationSettings {
  private cached: { at: number; value: Settings } | null = null;

  constructor(private readonly plane: DataPlane) {}

  async get(): Promise<Settings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const value = view(await this.plane.directory.notificationSettings.findUniqueOrThrow({ where: ROW }));
    this.cached = { at: Date.now(), value };
    return value;
  }

  async update(input: SettingsInput, adminId: bigint, ctx: RequestContext): Promise<Settings> {
    const unknown = (input.whatsappPaidTypes ?? []).filter((t) => !PAYABLE_TYPES.includes(t));
    if (unknown.length) {
      throw AppError.badRequest(
        `No WhatsApp template exists for: ${unknown.join(', ')}. Allowed: ${PAYABLE_TYPES.join(', ')}`,
      );
    }
    const data = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (data.whatsappPaidTypes) data.whatsappPaidTypes = [...new Set(input.whatsappPaidTypes)];
    const { before, row } = await this.plane.directory.$transaction(async (tx) => {
      const before = await tx.notificationSettings.findUniqueOrThrow({ where: ROW });
      const row = await tx.notificationSettings.update({
        where: ROW,
        data: { ...data, updatedById: adminId },
      });
      return { before, row };
    });
    this.cached = null;
    // The directory keeps no audit log: the entry goes to the admin's own shard.
    await recordShardAudit(await this.plane.user(adminId), this.plane.id(), {
      userId: adminId,
      action: 'notifications.settings_updated',
      resourceType: 'notification_settings',
      oldValues: pick(view(before), Object.keys(data)),
      newValues: pick(view(row), Object.keys(data)),
      ...auditCtx(ctx),
    });
    return view(row);
  }

  /** This calendar month (UTC) so far, counted on every user shard. */
  async whatsappUsage(now = new Date()): Promise<WhatsappUsage> {
    const settings = await this.get();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const counts = { window: 0, template: 0 };
    await this.plane.acrossUsers(async (db) => {
      const rows = await db.notification.groupBy({
        by: ['whatsappPricing'],
        where: { channel: 'whatsapp', createdAt: { gte: start }, status: { not: 'failed' } },
        _count: { _all: true },
      });
      for (const r of rows)
        if (r.whatsappPricing === 'window' || r.whatsappPricing === 'template')
          counts[r.whatsappPricing] += r._count._all;
    });
    const paid = Math.max(0, counts.window - settings.whatsappFreeWindowPerMonth) + counts.template;
    return {
      month: start.toISOString().slice(0, 7),
      windowMessages: counts.window,
      templateMessages: counts.template,
      estimatedCents: Math.round(paid * settings.whatsappMessageCostCents * 100) / 100,
      budgetCents: settings.whatsappMonthlyBudgetCents,
    };
  }
}

function view(r: {
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  whatsappPaidTypes: string[];
  whatsappMonthlyBudgetCents: number;
  whatsappMessageCostCents: { toNumber(): number } | number;
  whatsappFreeWindowPerMonth: number;
  reminder24h: boolean;
  reminder2h: boolean;
  quietStartHour: number;
  quietEndHour: number;
  suggestionsEnabled: boolean;
  suggestionMinDays: number;
  suggestionMaxPer30Days: number;
  suggestionMaxIgnored: number;
  updatedAt: Date;
}): Settings {
  return {
    emailEnabled: r.emailEnabled,
    whatsappEnabled: r.whatsappEnabled,
    whatsappPaidTypes: r.whatsappPaidTypes,
    whatsappMonthlyBudgetCents: r.whatsappMonthlyBudgetCents,
    whatsappMessageCostCents:
      typeof r.whatsappMessageCostCents === 'number'
        ? r.whatsappMessageCostCents
        : r.whatsappMessageCostCents.toNumber(),
    whatsappFreeWindowPerMonth: r.whatsappFreeWindowPerMonth,
    reminder24h: r.reminder24h,
    reminder2h: r.reminder2h,
    quietStartHour: r.quietStartHour,
    quietEndHour: r.quietEndHour,
    suggestionsEnabled: r.suggestionsEnabled,
    suggestionMinDays: r.suggestionMinDays,
    suggestionMaxPer30Days: r.suggestionMaxPer30Days,
    suggestionMaxIgnored: r.suggestionMaxIgnored,
    updatedAt: r.updatedAt.toISOString(),
  };
}

const pick = (o: Settings, keys: string[]) =>
  Object.fromEntries(keys.map((k) => [k, o[k as keyof Settings]]));
