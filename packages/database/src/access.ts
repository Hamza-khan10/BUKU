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
    // Owners add the kind of business BUKU doesn't list yet (D-098): added to, never changed.
    inserts: ['audit_logs', 'categories'],
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
 * What every service may do in the DIRECTORY database (docs/DATABASE.md §6): read where people and
 * businesses live, lease an ID generator, place a new row, and find, claim or release handles
 * (DB-018). Nothing is ever written to its tables directly; who may place which family
 * (registry.entities.placed_by) and who may write which kind of handle
 * (lookup.handle_kinds.writers) are rows, checked by the functions themselves, so they change
 * without a deploy. The same rights as buku_app's (the directory migrations grant those).
 */
export const DIRECTORY_ACCESS = {
  schemas: ['registry', 'lookup'],
  reads: [
    'registry.regions',
    'registry.entities',
    'registry.clusters',
    'registry.shards',
    'registry.version',
    'lookup.handle_kinds',
  ],
  executes: [
    'registry.route(text, bigint)',
    'registry.region_of(bigint)',
    'registry.lease_generator(text, smallint, integer)',
    'registry.renew_generator(smallint, text, integer)',
    'registry.release_generator(smallint, text)',
    'registry.place(text, bigint)',
    'lookup.claim(text, bytea, bigint, boolean)',
    'lookup.release(text, bytea, bigint)',
    'lookup.release_all(text, bigint)',
    'lookup.find(text, bytea)',
  ],
} as const;

/**
 * Tables no service changes at run time: filled by migrations and seeds, only ever added to
 * (categories: owners' suggestions, D-098; audit_logs), or kept for features not built yet.
 */
export const NOT_WRITTEN_AT_RUN_TIME = [
  'categories', // added to by business (inserts), changed by no one
  'webhooks',
  'webhook_deliveries',
  'ai_receptionist_configs',
  'ai_call_logs',
  'audit_logs', // appended to by everyone (inserts), changed by no one
] as const;

// ═══════════════════════════════ DATABASE v2 (D2d) ═══════════════════════════════
// The same rule as above, per kind of database (docs/DATABASE.md DB-010, DB-015, DB-041): each
// service gets exactly what it needs on user shards, business shards and the catalog, and the
// few reference tables it edits on the directory. Applied by scripts/apply-access.ts to every
// shard in the registry. Tables outside `public` are written schema-qualified ('reference.plans').

/** What any service may read about a person on a user shard: never credentials, hashes or locks. */
const SHARD_PERSON = [
  'id',
  'public_id',
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

/** Every reference table (DB-015): copied read-only to business shards and the catalog. */
export const REFERENCE_TABLES = [
  'reference.currencies',
  'reference.categories',
  'reference.plans',
  'reference.plan_prices',
  'reference.billing_settings',
  'reference.billing_channel_fees',
  'reference.billing_cost_items',
  'reference.notification_settings',
] as const;
const REFERENCE_READS: Reads = Object.fromEntries(REFERENCE_TABLES.map((t) => [t, '*']));

/** Each service's own idempotency rows and outbox events (row-level security keeps them apart). */
const CONSUMES = ['processed_events'] as const;
const PUBLISHES = ['outbox_events'] as const;

/** A user shard: one person's account and their view of everything else (§9.2). */
export const USER_SHARD_ACCESS: Readonly<Record<ServiceName, Access>> = {
  auth: {
    owns: [
      'users',
      'user_mfa',
      'oauth_accounts',
      'refresh_tokens',
      'push_tokens',
      'user_business_roles',
      ...PUBLISHES,
      ...CONSUMES,
    ],
    // "Download my data": everything that is the person's.
    reads: {
      audit_logs: '*',
      favourites: '*',
      notifications: '*',
      notification_preferences: '*',
      whatsapp_contacts: '*',
      user_appointments: '*',
      user_active_tickets: '*',
      // Only what erasing them needs: a DELETE reads the columns it filters on.
      notification_marks: ['user_id'],
      user_time_reservations: ['user_id'],
      user_visit_outcomes: ['user_id'],
    },
    // A new account starts with the default notification settings.
    inserts: ['audit_logs', 'notification_preferences'],
    // Deleting an account (D-043): what is the person's goes.
    deletes: [
      'favourites',
      'notifications',
      'notification_marks',
      'notification_preferences',
      'whatsapp_contacts',
      'user_appointments',
      'user_time_reservations',
      'user_active_tickets',
      'user_visit_outcomes',
    ],
  },
  booking: {
    // Claims the person's time before writing the appointment (DB-014), keeps their list, and
    // records how each visit ended for their reliability (D-078, D3d).
    owns: ['user_time_reservations', 'user_appointments', 'user_visit_outcomes', ...PUBLISHES, ...CONSUMES],
    reads: { users: SHARD_PERSON },
    inserts: ['audit_logs'],
  },
  queue: {
    // One queue at a time, across every business (DB-014); how each ticket ended goes into the
    // person's reliability, which the front desk sees as a label (D-078, D3e).
    owns: ['user_active_tickets', ...PUBLISHES, ...CONSUMES],
    reads: { users: SHARD_PERSON, user_visit_outcomes: '*' },
    inserts: ['audit_logs', 'user_visit_outcomes'],
  },
  notification: {
    owns: [
      'notifications',
      'notification_marks',
      'notification_preferences',
      'whatsapp_contacts',
      ...CONSUMES,
    ],
    reads: {
      // Emails and texts go to verified addresses only.
      users: [
        ...SHARD_PERSON,
        'email_enc',
        'email_verified_at',
        'phone_enc',
        'phone_verified_at',
        'whatsapp_opt_in_at',
      ],
      push_tokens: '*',
      favourites: '*',
      user_appointments: '*',
      user_business_roles: '*',
      // Suggestions and "what's coming up" (D-075, D3f): where people go, and their place in line.
      user_visit_outcomes: '*',
      user_active_tickets: '*',
    },
    inserts: ['audit_logs'],
    updates: { push_tokens: ['is_active', 'last_seen_at'] },
  },
  business: {
    owns: ['favourites', ...PUBLISHES, ...CONSUMES],
    // An owner's own view of their businesses (DB-014, D3c): written when they register one, its
    // name kept when it changes; members' rows are auth-service's (D3b).
    reads: { users: SHARD_PERSON, user_business_roles: '*' },
    inserts: ['audit_logs', 'user_business_roles'],
    updates: { user_business_roles: ['business_name', 'version', 'updated_at'] },
    deletes: ['user_business_roles'],
  },
  billing: {
    owns: [...CONSUMES],
    // A customer's account page counts their visits (shown only: customers are free, D-101).
    reads: { users: SHARD_PERSON, user_appointments: '*', user_visit_outcomes: '*' },
    inserts: ['audit_logs'],
  },
  search: { owns: [] },
  ads: { owns: [] },
  analytics: { owns: [] },
};

/**
 * A business shard: everything that is one business's (§9.3). Row-level security still shows each
 * transaction one business; `appointment_index` and `staff_open_shifts` are written only by their
 * triggers; the reference copy only by replication.
 */
export const BUSINESS_SHARD_ACCESS: Readonly<Record<ServiceName, Access>> = {
  auth: {
    owns: ['business_members', ...PUBLISHES, ...CONSUMES],
    // "Download my data" and erasing an account touch what the person did at businesses (their
    // appointments found through the index, D3b); team logins follow the business's plan.
    reads: {
      ...REFERENCE_READS,
      businesses: '*',
      appointment_index: '*',
      appointments: '*',
      queue_tickets: '*',
      queue_sessions: '*',
      reviews: '*',
      services: '*',
      staff: '*',
      subscriptions: '*',
    },
    inserts: ['audit_logs'],
    // Deleting an account: the words people wrote and the name they booked under are removed,
    // the records stay (D-043).
    updates: { reviews: ['comment'], appointments: ['notes', 'customer_name'], queue_tickets: ['notes'] },
  },
  booking: {
    owns: [
      'services',
      'service_groups',
      'staff',
      'staff_services',
      'resources',
      'availability_rules',
      'availability_exceptions',
      'booking_settings',
      'appointments',
      'appointment_events',
      'staff_shifts',
      'reviews',
      ...PUBLISHES,
      ...CONSUMES,
    ],
    reads: {
      ...REFERENCE_READS,
      appointment_index: '*',
      staff_open_shifts: '*',
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      business_search_stats: '*',
      staff_photos: '*',
      queue_tickets: '*',
      subscriptions: '*',
    },
    inserts: ['audit_logs'],
  },
  queue: {
    owns: ['queue_settings', 'queue_sessions', 'queue_tickets', ...PUBLISHES, ...CONSUMES],
    reads: {
      ...REFERENCE_READS,
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      staff: '*',
      staff_shifts: '*',
      staff_open_shifts: '*',
      appointments: '*',
      subscriptions: '*',
    },
    inserts: ['audit_logs'],
  },
  notification: {
    owns: [...CONSUMES],
    reads: {
      ...REFERENCE_READS,
      appointments: '*',
      businesses: '*',
      business_hours: '*',
      business_members: '*',
      booking_settings: '*',
      services: '*',
      staff: '*',
      staff_services: '*',
      reviews: '*',
      queue_tickets: '*',
      queue_sessions: '*',
      subscriptions: '*',
    },
    inserts: ['audit_logs'],
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
      ...PUBLISHES,
      ...CONSUMES,
    ],
    reads: {
      ...REFERENCE_READS,
      business_members: '*',
      business_search_stats: '*', // reliability on the business's page (D-077)
      staff: '*',
      services: '*',
      reviews: '*',
      appointments: '*',
      queue_tickets: '*',
      subscriptions: '*',
    },
    inserts: ['audit_logs'],
  },
  billing: {
    owns: ['subscriptions', 'plan_requests', 'payments', ...PUBLISHES, ...CONSUMES],
    reads: {
      ...REFERENCE_READS,
      businesses: '*',
      business_members: '*',
      business_photos: '*',
      services: '*',
      staff: '*',
      appointments: '*',
      queue_tickets: '*',
    },
    inserts: ['audit_logs'],
  },
  search: {
    owns: ['business_search_stats', ...CONSUMES],
    reads: {
      ...REFERENCE_READS,
      businesses: '*',
      services: '*',
      business_hours: '*',
      business_photos: '*',
      availability_exceptions: '*',
      queue_settings: '*',
      queue_sessions: '*',
      queue_tickets: '*',
      appointments: '*',
      reviews: '*',
    },
  },
  ads: { owns: ['business_ads', 'ad_events', ...PUBLISHES], reads: { ...REFERENCE_READS, businesses: '*' } },
  analytics: { owns: [] },
};

/** Business-shard tables no service writes: kept by triggers or replication, or not built yet. */
export const BUSINESS_SHARD_NOT_WRITTEN = [
  'appointment_index', // its trigger on appointments (DB-024)
  'staff_open_shifts', // its trigger on staff_shifts
  'audit_logs', // appended to by everyone, changed by no one
  'ai_receptionist_configs',
  'ai_call_logs',
  'webhooks',
  'webhook_deliveries',
  'ai.business_knowledge_chunks',
  ...REFERENCE_TABLES, // replication
] as const;

/** User-shard tables no service changes at run time. */
export const USER_SHARD_NOT_WRITTEN = ['audit_logs'] as const;

/**
 * The catalog (DB-041): the search service keeps it from the business shards' events; ads reads
 * which ads may run where. Nobody else.
 */
export const CATALOG_ACCESS: Readonly<Record<ServiceName, Access>> = {
  auth: { owns: [] },
  booking: { owns: [] },
  queue: { owns: [] },
  notification: { owns: [] },
  business: { owns: [] },
  billing: { owns: [] },
  search: {
    owns: [
      'catalog.businesses',
      'catalog.services',
      'catalog.hours',
      'catalog.closures',
      'catalog.queues',
      'catalog.ads',
    ],
    reads: REFERENCE_READS,
  },
  ads: { owns: [], reads: { ...REFERENCE_READS, 'catalog.ads': '*', 'catalog.businesses': '*' } },
  analytics: { owns: [] },
};

/**
 * Reference data each service edits on the directory (DB-015), besides what every service may do
 * there (DIRECTORY_ACCESS). Every change reaches the copies by replication.
 */
export const DIRECTORY_REFERENCE_ACCESS: Readonly<Partial<Record<ServiceName, Access>>> = {
  billing: {
    owns: [
      'reference.plans',
      'reference.plan_prices',
      'reference.billing_settings',
      'reference.billing_channel_fees',
      'reference.billing_cost_items',
    ],
  },
  // Owners add kinds of business BUKU doesn't list yet (D-098); admins review them.
  business: { owns: [], inserts: ['reference.categories'], updates: { 'reference.categories': '*' } },
  notification: { owns: [], updates: { 'reference.notification_settings': '*' } },
};

/**
 * Services that also work across businesses on business shards, and why (DB-020). Each gets a
 * second role, `buku_svc_<name>_all`, with the same rights plus membership of
 * buku_all_businesses; its login role may switch to it (SET LOCAL ROLE, `forAllBusinesses`) but
 * doesn't inherit it, so a request handler that forgets its business still sees nothing, and only
 * a job that says so sees every business, for that one transaction.
 */
export const CROSS_BUSINESS: Readonly<Partial<Record<ServiceName, string>>> = {
  auth: 'exporting or erasing an account touches every business the person used',
  booking: 'sweeping appointments nobody confirmed or attended, across businesses',
  queue: 'closing yesterday’s queues everywhere',
  notification: 'reminders and suggestions for every business’s appointments',
  business: 'admins reviewing new businesses, documents and reports',
  billing: 'renewals, trials ending, and admins’ plan requests',
  search: 'ranking statistics and rebuilding the catalog',
  ads: 'admins approving ads, and their budgets',
};

/** The role a service switches to for work across businesses. */
export const allBusinessesRoleOf = (service: ServiceName) => `buku_svc_${service}_all`;
