/**
 * What each service may do in the database (D-092): every service signs in as
 * its own role (buku_svc_<name>) and gets exactly this — the tables it owns,
 * the ones it reads (some only column by column), the few cross-service writes
 * its job needs (column by column), and the database functions it runs. A
 * service that is taken over can't read another's secrets or change another's
 * data. Nothing else is granted: a new table is usable by no service until it
 * is added here (a test checks every table has an owner).
 *
 * Applied by scripts/apply-access.ts. The outbox is shared but row-limited:
 * each service sees only the events it wrote (row-level security, migration
 * 20261007100000).
 */

export const SERVICES = [
  'auth',
  'booking',
  'queue',
  'notification',
  'business',
  'billing',
  'search',
  'ads',
  'analytics',
] as const;
export type ServiceName = (typeof SERVICES)[number];

/** The database role a service signs in as. */
export const roleOf = (service: ServiceName) => `buku_svc_${service}`;

/** A table, or only these columns of it. */
type Reads = Readonly<Record<string, readonly string[] | '*'>>;

export interface Access {
  /** Read and change (SELECT, INSERT, UPDATE, DELETE). */
  owns: readonly string[];
  /** Read only: the whole table ('*') or these columns. */
  reads?: Reads;
  /** Add rows to (no reading or changing them). */
  inserts?: readonly string[];
  /** Change only these columns (or every column: '*') of another's rows. */
  updates?: Readonly<Record<string, readonly string[] | '*'>>;
  /** Delete another's rows (an account's own data, when it is deleted). */
  deletes?: readonly string[];
  /** Database functions it calls. */
  executes?: readonly string[];
  /** Partitioned tables' default partitions it may count (partition upkeep). */
  partitions?: readonly string[];
}

/** What any other service may read about a person: never credentials, contact hashes or lock state. */
const PERSON = [
  'id',
  'name',
  'role',
  'status',
  'timezone',
  'locale',
  'deleted_at',
  'created_at',
  'updated_at',
  'managed_by_business_id',
  'must_change_password',
] as const;

/** Plans and settings, for "is this allowed on their plan" (@buku/billing). */
const PLAN_READS: Reads = { billing_settings: '*', subscriptions: '*', plans: '*' };

export const ACCESS: Readonly<Record<ServiceName, Access>> = {
  auth: {
    owns: [
      'users',
      'oauth_accounts',
      'refresh_tokens',
      'push_tokens',
      'user_mfa',
      'business_members',
      'outbox_events',
    ],
    reads: {
      ...PLAN_READS,
      audit_logs: '*', // a person's own security log, in "download my data"
      businesses: '*',
      appointments: '*',
      queue_entries: '*',
      queue_sessions: '*',
      reviews: '*',
      favourites: '*',
      notifications: '*',
      notification_preferences: '*',
      whatsapp_contacts: '*',
      services: '*',
      staff: '*',
    },
    // A new account starts with the default notification settings.
    inserts: ['audit_logs', 'notification_preferences'],
    // Deleting an account: the words people wrote are removed, the records stay (D-043).
    updates: { reviews: ['comment'], appointments: ['notes'], queue_entries: ['notes'] },
    deletes: [
      'favourites',
      'notifications',
      'notification_marks',
      'notification_preferences',
      'whatsapp_contacts',
    ],
    // A review changing refreshes its business's rating (the trigger calls it; it runs as its owner).
    executes: ['recalc_business_rating(uuid)'],
  },
  booking: {
    owns: [
      'services',
      'service_categories',
      'staff',
      'staff_services',
      'availability_rules',
      'availability_exceptions',
      'booking_settings',
      'appointments',
      'appointment_status_history',
      'staff_attendance',
      'reviews',
      'resources',
      'outbox_events',
    ],
    reads: {
      ...PLAN_READS,
      users: PERSON,
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      business_search_stats: '*',
      staff_photos: '*',
      queue_entries: '*',
      categories: '*',
    },
    inserts: ['audit_logs'],
    // A review changing refreshes its business's rating (the trigger calls it; it runs as its owner).
    executes: ['recalc_business_rating(uuid)'],
  },
  queue: {
    owns: ['queue_settings', 'queue_sessions', 'queue_entries', 'outbox_events'],
    reads: {
      ...PLAN_READS,
      users: PERSON,
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      staff: '*',
      staff_attendance: '*',
      appointments: '*',
    },
    inserts: ['audit_logs'],
  },
  notification: {
    owns: [
      'notifications',
      'notification_marks',
      'notification_preferences',
      'notification_settings',
      'whatsapp_contacts',
      'processed_events',
    ],
    reads: {
      ...PLAN_READS,
      // Emails go to a verified address: the encrypted email and when it was verified.
      users: [...PERSON, 'email_encrypted', 'email_verified_at'],
      push_tokens: '*',
      appointments: '*',
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      booking_settings: '*',
      services: '*',
      staff: '*',
      staff_services: '*',
      reviews: '*',
      queue_entries: '*',
      queue_sessions: '*',
      favourites: '*',
      categories: '*',
    },
    inserts: ['audit_logs'],
    updates: { push_tokens: ['is_active', 'last_seen_at'] },
    // Retention and partition upkeep (D-080): fixed periods, run, never shortened.
    executes: [
      'delete_expired_rows(integer)',
      'drop_expired_partitions()',
      'ensure_monthly_partitions(integer, integer)',
    ],
    partitions: ['audit_logs_default', 'notifications_default', 'ad_events_default'],
  },
  business: {
    owns: [
      'businesses',
      'business_hours',
      'business_photos',
      'business_documents',
      'business_legal_profiles',
      'business_reports',
      'staff_photos',
      'favourites',
      'outbox_events',
    ],
    reads: {
      ...PLAN_READS,
      users: PERSON,
      business_members: '*',
      business_search_stats: '*', // reliability on the business's page (D-077)
      staff: '*',
      services: '*',
      categories: '*',
      reviews: '*',
      appointments: '*',
      queue_entries: '*',
    },
    inserts: ['audit_logs'],
  },
  billing: {
    owns: [
      'plans',
      'plan_prices',
      'billing_settings',
      'subscriptions',
      'plan_requests',
      'billing_cost_items',
      'billing_channel_fees',
      'payments',
      'processed_events',
    ],
    reads: {
      users: PERSON,
      businesses: '*',
      business_members: '*',
      business_photos: '*',
      services: '*',
      staff: '*',
      appointments: '*',
      queue_entries: '*',
    },
    inserts: ['audit_logs'],
  },
  search: {
    owns: ['business_search_stats'],
    reads: {
      businesses: '*',
      categories: '*',
      services: '*',
      business_hours: '*',
      business_photos: '*',
      availability_exceptions: '*',
      queue_settings: '*',
      queue_sessions: '*',
      queue_entries: '*',
      appointments: '*',
      reviews: '*',
    },
  },
  ads: { owns: ['business_ads', 'ad_events'], reads: { businesses: '*' } },
  analytics: { owns: [] },
};

/**
 * Tables no service writes at run time: filled by migrations and seeds
 * (categories), or kept for features that are not built yet.
 */
export const NOT_WRITTEN_AT_RUN_TIME = [
  'categories',
  'webhooks',
  'webhook_deliveries',
  'ai_receptionist_configs',
  'ai_call_logs',
  'audit_logs', // appended to by everyone (inserts), changed by no one
] as const;
