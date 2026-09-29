import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { isTopic, type Topic } from './topics.js';

/**
 * Every event on every topic is wrapped in the same envelope (modelled on
 * CloudEvents). Consumers can rely on these fields regardless of topic:
 *
 *   id            unique per event — the idempotency key consumers dedupe on
 *   type          the topic name, e.g. "bookings.created"
 *   version       schema version of `data`; bump on breaking changes and keep
 *                 consumers able to read the previous version during rollout
 *   source        producing service, e.g. "booking-service"
 *   occurredAt    when the business fact happened (not when it was published)
 *   subject       the aggregate id (appointmentId, queueEntryId, ...)
 *   correlationId ties the event to the HTTP request that caused it (tracing)
 *   data          the payload; never secrets, and PII only when essential
 */
export const EventEnvelopeSchema = z.object({
  id: z.uuid(),
  type: z.string().refine(isTopic, 'unknown topic'),
  version: z.number().int().min(1),
  source: z.string().min(1).max(100),
  occurredAt: z.iso.datetime({ offset: true }),
  subject: z.string().min(1).max(100),
  correlationId: z.string().max(128).optional(),
  data: z.unknown(),
});

export interface EventEnvelope<T = unknown> {
  id: string;
  type: Topic;
  version: number;
  source: string;
  occurredAt: string;
  subject: string;
  correlationId?: string;
  data: T;
}

export interface CreateEventInput<T> {
  type: Topic;
  source: string;
  subject: string;
  data: T;
  version?: number;
  correlationId?: string;
  occurredAt?: Date;
}

export function createEvent<T>(input: CreateEventInput<T>): EventEnvelope<T> {
  return {
    id: randomUUID(),
    type: input.type,
    version: input.version ?? 1,
    source: input.source,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    subject: input.subject,
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    data: input.data,
  };
}

/** Parse and validate raw message bytes; throws on anything malformed. */
export function parseEnvelope(raw: Buffer | string | null | undefined): EventEnvelope {
  if (raw == null) throw new Error('Empty Kafka message');
  const json: unknown = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8'));
  return EventEnvelopeSchema.parse(json);
}
