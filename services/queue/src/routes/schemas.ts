import { zBody, zSafeText, zUuid } from '@buku/common';
import { z } from 'zod';

/** Request contracts for queue-service (source for docs/API_REFERENCE.md). */

export const IdOrSlugParams = z.object({ idOrSlug: z.string().min(1).max(200) });
export const IdParams = z.object({ id: zUuid });
export const EntryParams = z.object({ id: zUuid, entryId: zUuid });
export const TicketParams = z.object({ id: zUuid });

export const JoinBody = zBody({
  businessId: zUuid,
  /** The phone's position, for the distance rule (D-038). */
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const WalkInBody = zBody({
  /** A name to call out (optional). */
  name: zSafeText({ kind: 'personName', min: 1, max: 100 }).optional(),
  priority: z.boolean().optional(),
});

export const PriorityBody = zBody({ priority: z.boolean() });

export const QueueSettingsBody = zBody({
  remoteJoinRadiusMeters: z.number().int().min(100).max(100_000).optional(),
  maxQueueSize: z.number().int().min(1).max(10_000).optional(),
  gracePeriodSeconds: z.number().int().min(0).max(3600).optional(),
  ticketPrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{1,3}$/, '1–3 letters')
    .optional(),
  avgServiceSeconds: z.number().int().min(30).max(14_400).optional(),
}).refine((b) => Object.values(b).some((v) => v !== undefined), 'at least one field is required');
