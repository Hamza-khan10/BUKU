/**
 * Single source of truth for every Kafka topic: name, partitions, retention.
 *
 * `pnpm kafka:topics` (and the kafka-init container) create/verify topics
 * FROM THIS FILE — there is no second list to keep in sync. Code must never
 * use raw topic strings; import `TOPICS.X` instead.
 *
 * Partition counts are upper bounds on consumer parallelism per group, and
 * can be increased later but never decreased — so they are sized for growth.
 * Ordering is guaranteed only WITHIN a partition, which is why every event is
 * keyed by its aggregate id (e.g. appointmentId): all events for one
 * appointment land in one partition, in order.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export interface TopicSpec {
  partitions: number;
  retentionMs: number;
}

export const TOPIC_SPECS = {
  // ── Bookings ──
  'bookings.created': { partitions: 12, retentionMs: 7 * DAY },
  'bookings.confirmed': { partitions: 12, retentionMs: 7 * DAY },
  'bookings.cancelled': { partitions: 12, retentionMs: 7 * DAY },
  'bookings.rescheduled': { partitions: 6, retentionMs: 7 * DAY },
  'bookings.completed': { partitions: 6, retentionMs: 30 * DAY },
  'bookings.reminder': { partitions: 6, retentionMs: 1 * DAY },
  'bookings.no_show': { partitions: 6, retentionMs: 30 * DAY },

  // ── Reviews ──
  /** A customer reviewed a visit (the business is told). */
  'reviews.created': { partitions: 3, retentionMs: 30 * DAY },
  /** The business replied to a review (the reviewer is told). */
  'reviews.responded': { partitions: 3, retentionMs: 30 * DAY },

  // ── Queues ──
  'queue.session.opened': { partitions: 3, retentionMs: 1 * DAY },
  'queue.session.closed': { partitions: 3, retentionMs: 1 * DAY },
  'queue.entry.joined': { partitions: 12, retentionMs: 1 * DAY },
  'queue.entry.called': { partitions: 12, retentionMs: 1 * DAY },
  'queue.entry.served': { partitions: 6, retentionMs: 1 * DAY },
  'queue.entry.completed': { partitions: 6, retentionMs: 30 * DAY },
  'queue.entry.left': { partitions: 6, retentionMs: 1 * DAY },
  'queue.entry.no_show': { partitions: 6, retentionMs: 1 * DAY },
  'queue.position.updated': { partitions: 24, retentionMs: 1 * HOUR },

  // ── Notifications ──
  'notifications.send': { partitions: 12, retentionMs: 3 * DAY },
  'notifications.delivered': { partitions: 6, retentionMs: 7 * DAY },

  // ── Users & businesses ──
  'users.registered': { partitions: 6, retentionMs: 30 * DAY },
  'users.verified': { partitions: 3, retentionMs: 30 * DAY },
  'users.deleted': { partitions: 3, retentionMs: 30 * DAY },
  'businesses.created': { partitions: 3, retentionMs: 30 * DAY },
  'businesses.verified': { partitions: 3, retentionMs: 30 * DAY },
  'businesses.updated': { partitions: 6, retentionMs: 7 * DAY },
  'businesses.suspended': { partitions: 3, retentionMs: 30 * DAY },
  /** Someone left a business's team (auth-service); their employee photo is removed. */
  'businesses.member_removed': { partitions: 3, retentionMs: 30 * DAY },

  // ── Payments ──
  'payments.initiated': { partitions: 6, retentionMs: 90 * DAY },
  'payments.completed': { partitions: 6, retentionMs: 90 * DAY },
  'payments.failed': { partitions: 6, retentionMs: 90 * DAY },
  'payments.refunded': { partitions: 3, retentionMs: 90 * DAY },

  // ── Analytics ──
  'analytics.events': { partitions: 24, retentionMs: 90 * DAY },
  'analytics.search': { partitions: 12, retentionMs: 30 * DAY },
  'analytics.ad.impressions': { partitions: 12, retentionMs: 30 * DAY },

  // ── AI receptionist ──
  'ai.call.started': { partitions: 3, retentionMs: 30 * DAY },
  'ai.call.completed': { partitions: 6, retentionMs: 30 * DAY },
  'ai.call.failed': { partitions: 3, retentionMs: 30 * DAY },

  // ── Webhooks ──
  'webhooks.dispatch': { partitions: 6, retentionMs: 7 * DAY },
  'webhooks.delivered': { partitions: 3, retentionMs: 7 * DAY },
  'webhooks.failed': { partitions: 6, retentionMs: 30 * DAY },

  // ── Dead-letter queues ──
  'dlq.failed-events': { partitions: 6, retentionMs: 30 * DAY },
  'dlq.notifications': { partitions: 6, retentionMs: 30 * DAY },
  'dlq.webhooks': { partitions: 6, retentionMs: 30 * DAY },
} as const satisfies Record<string, TopicSpec>;

export type Topic = keyof typeof TOPIC_SPECS;

/** `TOPICS.BOOKINGS_CREATED === 'bookings.created'` etc. */
type ConstName<S extends string> = Uppercase<
  S extends `${infer A}.${infer B}`
    ? `${A}_${ConstName<B>}`
    : S extends `${infer A}-${infer B}`
      ? `${A}_${ConstName<B>}`
      : S
>;

function toConstName(topic: string): string {
  return topic.replace(/[.-]/g, '_').toUpperCase();
}

export const TOPICS = Object.fromEntries(
  (Object.keys(TOPIC_SPECS) as Topic[]).map((t) => [toConstName(t), t]),
) as { readonly [K in Topic as ConstName<K>]: K };

export const ALL_TOPICS = Object.keys(TOPIC_SPECS) as Topic[];

export function isTopic(value: string): value is Topic {
  return Object.hasOwn(TOPIC_SPECS, value);
}

/** Consumer group naming convention: buku-{service}-{env}. */
export function consumerGroupId(
  service: string,
  env: string = process.env.NODE_ENV ?? 'development',
): string {
  return `buku-${service}-${env}`;
}
