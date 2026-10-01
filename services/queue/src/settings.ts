import { recordAudit, requireBusinessPermission, type Database } from '@buku/database';
import { auditCtx, type RequestContext } from './http/context.js';

/** How a business runs its queue. No row → these defaults (D-038, decision H). */
export interface QueueSettingsView {
  remoteJoinRadiusMeters: number;
  maxQueueSize: number;
  gracePeriodSeconds: number;
  ticketPrefix: string;
  avgServiceSeconds: number;
}

export const DEFAULT_QUEUE_SETTINGS: QueueSettingsView = {
  remoteJoinRadiusMeters: 5000,
  maxQueueSize: 200,
  gracePeriodSeconds: 300,
  ticketPrefix: 'A',
  avgServiceSeconds: 300,
};

export class QueueSettingsService {
  constructor(private readonly db: Database) {}

  async effective(businessId: string): Promise<QueueSettingsView> {
    const row = await this.db.queueSettings.findUnique({ where: { businessId } });
    if (!row) return { ...DEFAULT_QUEUE_SETTINGS };
    const { remoteJoinRadiusMeters, maxQueueSize, gracePeriodSeconds, ticketPrefix, avgServiceSeconds } = row;
    return { remoteJoinRadiusMeters, maxQueueSize, gracePeriodSeconds, ticketPrefix, avgServiceSeconds };
  }

  async get(businessId: string, actorId: string) {
    await requireBusinessPermission(this.db, businessId, actorId, 'business.view_private');
    return this.effective(businessId);
  }

  /** Takes effect from the next time the queue is opened. */
  async update(
    businessId: string,
    actorId: string,
    changes: Partial<QueueSettingsView>,
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, actorId, 'queue.settings');
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    await this.db.$transaction(async (tx) => {
      await tx.queueSettings.upsert({ where: { businessId }, create: { businessId, ...data }, update: data });
      await recordAudit(tx, {
        userId: actorId,
        action: 'queue.settings_updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: data,
        ...auditCtx(ctx),
      });
    });
    return this.effective(businessId);
  }
}
