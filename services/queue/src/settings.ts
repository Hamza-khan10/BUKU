import type { Actor } from '@buku/common';
import {
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
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

/** Settings in effect (stored or default), read in the business's own transaction. */
export async function effectiveQueueSettings(tx: BusinessTx, businessId: bigint): Promise<QueueSettingsView> {
  const row = await tx.queueSettings.findUnique({ where: { businessId } });
  if (!row) return { ...DEFAULT_QUEUE_SETTINGS };
  const { remoteJoinRadiusMeters, maxQueueSize, gracePeriodSeconds, ticketPrefix, avgServiceSeconds } = row;
  return { remoteJoinRadiusMeters, maxQueueSize, gracePeriodSeconds, ticketPrefix, avgServiceSeconds };
}

export class QueueSettingsService {
  constructor(private readonly plane: DataPlane) {}

  async get(businessId: bigint, actor: Actor): Promise<QueueSettingsView> {
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.view_private');
      return effectiveQueueSettings(tx, businessId);
    });
  }

  /** Takes effect from the next time the queue is opened. */
  async update(
    businessId: bigint,
    actor: Actor,
    changes: Partial<QueueSettingsView>,
    ctx: RequestContext,
  ): Promise<QueueSettingsView> {
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    return this.plane.inBusiness(businessId, async (tx) => {
      await requireBusinessPermissionOnShard(tx, businessId, actor, 'queue.settings');
      await tx.queueSettings.upsert({ where: { businessId }, create: { businessId, ...data }, update: data });
      await recordShardAudit(tx, this.plane.id(), {
        userId: actor.id,
        action: 'queue.settings_updated',
        resourceType: 'business',
        resourceId: businessId,
        newValues: data,
        ...auditCtx(ctx),
      });
      // The business now runs a queue, as search shows it (DB-041, D3h).
      await enqueueShardEvent(
        tx,
        this.plane.id(),
        createEvent({
          type: TOPICS.QUEUE_SETTINGS_UPDATED,
          source: 'queue-service',
          subject: businessId.toString(),
          data: { businessId: businessId.toString() },
          ...(ctx.requestId && { correlationId: ctx.requestId }),
        }),
        'queue_settings',
      );
      return effectiveQueueSettings(tx, businessId);
    });
  }
}
