-- A USER SHARD (docs/DATABASE.md §6, DB-010; diagram §9.2): everything that belongs to one person.
-- Applied to every user shard by scripts/provision-shards.ts. Generated part first (with the
-- time-partitioned tables declared PARTITION BY RANGE), then the rules Prisma can't express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" BIGINT NOT NULL,
    "managed_by_business_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(6),
    "phone_verified_at" TIMESTAMPTZ(6),
    "whatsapp_opt_in_at" TIMESTAMPTZ(6),
    "terms_accepted_at" TIMESTAMPTZ(6),
    "password_changed_at" TIMESTAMPTZ(6),
    "locked_until" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "purged_at" TIMESTAMPTZ(6),
    "failed_login_count" SMALLINT NOT NULL DEFAULT 0,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "public_id" CHAR(12) NOT NULL,
    "role" VARCHAR(20) NOT NULL DEFAULT 'user',
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "locale" VARCHAR(10) NOT NULL DEFAULT 'en',
    "terms_version" VARCHAR(20),
    "name" VARCHAR(200) NOT NULL,
    "username" VARCHAR(40),
    "email_hash" BYTEA,
    "phone_hash" BYTEA,
    "unverified_phone_hash" BYTEA,
    "email_enc" BYTEA,
    "phone_enc" BYTEA,
    "unverified_phone_enc" BYTEA,
    "password_hash" VARCHAR(255),
    "avatar_url" VARCHAR(2000),
    "avatar_storage_key" VARCHAR(300),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "user_id" BIGINT NOT NULL,
    "last_used_step" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "confirmed_at" TIMESTAMPTZ(6),
    "secret_enc" BYTEA NOT NULL,
    "recovery_hashes" BYTEA[],

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provider" VARCHAR(20) NOT NULL,
    "subject_hash" BYTEA NOT NULL,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "user_id" BIGINT NOT NULL,
    "family_id" BIGINT NOT NULL,
    "replaced_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "mfa" BOOLEAN NOT NULL DEFAULT false,
    "token_hash" BYTEA NOT NULL,
    "revoked_reason" VARCHAR(50),
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "device_info" JSONB,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id","expires_at")
) PARTITION BY RANGE ("expires_at");

-- CreateTable
CREATE TABLE "push_tokens" (
    "id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "platform" VARCHAR(10) NOT NULL,
    "token" VARCHAR(4096) NOT NULL,

    CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "suggestions_consent_at" TIMESTAMPTZ(6),
    "marketing_consent_at" TIMESTAMPTZ(6),
    "push_booking_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "push_reminders" BOOLEAN NOT NULL DEFAULT true,
    "push_queue_updates" BOOLEAN NOT NULL DEFAULT true,
    "push_business_alerts" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_updates" BOOLEAN NOT NULL DEFAULT true,
    "sms_reminders" BOOLEAN NOT NULL DEFAULT true,
    "email_booking_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "email_reminders" BOOLEAN NOT NULL DEFAULT true,
    "email_business_alerts" BOOLEAN NOT NULL DEFAULT true,
    "suggestions" BOOLEAN NOT NULL DEFAULT false,
    "marketing_emails" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" BIGINT NOT NULL,
    "appointment_id" BIGINT,
    "queue_ticket_id" BIGINT,
    "push_token_id" BIGINT,
    "sent_at" TIMESTAMPTZ(6),
    "delivered_at" TIMESTAMPTZ(6),
    "read_at" TIMESTAMPTZ(6),
    "type" VARCHAR(50) NOT NULL,
    "channel" VARCHAR(10) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "whatsapp_pricing" VARCHAR(20),
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(4000) NOT NULL,
    "data" JSONB,
    "external_id" VARCHAR(500),
    "failure_reason" VARCHAR(1000),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "notification_marks" (
    "user_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "key" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(50) NOT NULL,

    CONSTRAINT "notification_marks_pkey" PRIMARY KEY ("user_id","key")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "user_id" BIGINT NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL,
    "last_inbound_at" TIMESTAMPTZ(6),
    "opted_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "phone_hash" BYTEA NOT NULL,
    "phone_enc" BYTEA NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "favourites" (
    "user_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favourites_pkey" PRIMARY KEY ("user_id","business_id")
);

-- CreateTable
CREATE TABLE "user_appointments" (
    "user_id" BIGINT NOT NULL,
    "appointment_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "version" BIGINT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "appointment_public_id" CHAR(12) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "business_name" VARCHAR(200) NOT NULL,
    "service_name" VARCHAR(200) NOT NULL,

    CONSTRAINT "user_appointments_pkey" PRIMARY KEY ("user_id","appointment_id")
);

-- CreateTable
CREATE TABLE "user_time_reservations" (
    "id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "appointment_id" BIGINT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_time_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_active_tickets" (
    "user_id" BIGINT NOT NULL,
    "ticket_id" BIGINT NOT NULL,
    "ticket_created_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "session_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_active_tickets_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "user_business_roles" (
    "user_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "version" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "business_name" VARCHAR(200) NOT NULL,

    CONSTRAINT "user_business_roles_pkey" PRIMARY KEY ("user_id","business_id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" BIGINT,
    "resource_id" BIGINT,
    "action" VARCHAR(100) NOT NULL,
    "resource_type" VARCHAR(50) NOT NULL,
    "ip_address" INET,
    "user_agent" VARCHAR(500),
    "request_id" VARCHAR(128),
    "old_values" JSONB,
    "new_values" JSONB,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aggregate_id" BIGINT NOT NULL,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "aggregate_type" VARCHAR(50) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "topic" VARCHAR(100) NOT NULL,
    "partition_key" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "headers" JSONB,
    "last_error" VARCHAR(2000),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "processed_events" (
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumer" VARCHAR(100) NOT NULL,
    "event_id" VARCHAR(200) NOT NULL,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("consumer","event_id","occurred_at")
) PARTITION BY RANGE ("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_public_id_key" ON "users"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_hash_key" ON "users"("email_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_hash_key" ON "users"("phone_hash");

-- CreateIndex
CREATE UNIQUE INDEX "users_avatar_storage_key_key" ON "users"("avatar_storage_key");

-- CreateIndex
CREATE UNIQUE INDEX "users_managed_by_business_id_username_key" ON "users"("managed_by_business_id", "username");

-- CreateIndex
CREATE INDEX "oauth_accounts_user_id_idx" ON "oauth_accounts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_subject_hash_key" ON "oauth_accounts"("provider", "subject_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "push_tokens_token_key" ON "push_tokens"("token");

-- CreateIndex
CREATE INDEX "push_tokens_user_id_is_active_idx" ON "push_tokens"("user_id", "is_active");

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "notification_marks_user_id_kind_created_at_idx" ON "notification_marks"("user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "notification_marks_created_at_brin" ON "notification_marks" USING BRIN ("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_phone_hash_key" ON "whatsapp_contacts"("phone_hash");

-- CreateIndex
CREATE INDEX "user_appointments_user_id_start_at_idx" ON "user_appointments"("user_id", "start_at");

-- CreateIndex
CREATE UNIQUE INDEX "user_appointments_appointment_public_id_key" ON "user_appointments"("appointment_public_id");

-- CreateIndex
CREATE INDEX "user_time_reservations_user_id_start_at_idx" ON "user_time_reservations"("user_id", "start_at");

-- CreateIndex
CREATE INDEX "user_time_reservations_end_at_idx" ON "user_time_reservations"("end_at");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_marks" ADD CONSTRAINT "notification_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favourites" ADD CONSTRAINT "favourites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_appointments" ADD CONSTRAINT "user_appointments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_time_reservations" ADD CONSTRAINT "user_time_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_active_tickets" ADD CONSTRAINT "user_active_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_business_roles" ADD CONSTRAINT "user_business_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ═══════════════════════ Rules Prisma can't express ═══════════════════════

-- Every element of a bytea[] has exactly this many bytes (used by CHECK constraints).
CREATE FUNCTION "bytea_all_length"(arr BYTEA[], n INTEGER) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT coalesce(bool_and(octet_length(x) = n), true) FROM unnest(arr) AS x $$;

ALTER TABLE "users"
  ADD CONSTRAINT "users_id_positive" CHECK ("id" > 0),
  ADD CONSTRAINT "users_public_id_format" CHECK ("public_id" ~ '^[0-9A-Za-z]{12}$'),
  ADD CONSTRAINT "users_role" CHECK ("role" IN ('user', 'staff', 'business_owner', 'super_admin')),
  ADD CONSTRAINT "users_status" CHECK ("status" IN ('active', 'suspended', 'deleted')),
  ADD CONSTRAINT "users_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "users_timezone_format" CHECK ("timezone" ~ '^[A-Za-z0-9_+/-]{1,60}$'),
  ADD CONSTRAINT "users_locale_format" CHECK ("locale" ~ '^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$'),
  ADD CONSTRAINT "users_failed_logins" CHECK ("failed_login_count" BETWEEN 0 AND 1000),
  -- An employee account (D-034) has both its business and a username; nobody else has either.
  ADD CONSTRAINT "users_employee_login" CHECK (("username" IS NULL) = ("managed_by_business_id" IS NULL)),
  ADD CONSTRAINT "users_username_format" CHECK ("username" ~ '^[a-z0-9][a-z0-9._-]{2,39}$'),
  ADD CONSTRAINT "users_hash_sizes" CHECK (
    octet_length("email_hash") = 16 AND octet_length("phone_hash") = 16 AND octet_length("unverified_phone_hash") = 16),
  ADD CONSTRAINT "users_email_pairs" CHECK (("email_hash" IS NULL) = ("email_enc" IS NULL)),
  ADD CONSTRAINT "users_phone_pairs" CHECK (("phone_hash" IS NULL) = ("phone_enc" IS NULL)),
  ADD CONSTRAINT "users_unverified_phone_pairs" CHECK (("unverified_phone_hash" IS NULL) = ("unverified_phone_enc" IS NULL)),
  ADD CONSTRAINT "users_purged_after_deleted" CHECK ("purged_at" IS NULL OR "deleted_at" IS NOT NULL);
-- Accounts waiting to be purged; a phone someone added but hasn't verified.
CREATE INDEX "users_awaiting_purge_idx" ON "users" ("deleted_at") WHERE "deleted_at" IS NOT NULL AND "purged_at" IS NULL;
CREATE INDEX "users_unverified_phone_hash_idx" ON "users" ("unverified_phone_hash") WHERE "unverified_phone_hash" IS NOT NULL;

ALTER TABLE "user_mfa"
  ADD CONSTRAINT "user_mfa_recovery_hashes" CHECK (
    cardinality("recovery_hashes") <= 20 AND "bytea_all_length"("recovery_hashes", 32));

ALTER TABLE "oauth_accounts"
  ADD CONSTRAINT "oauth_accounts_provider" CHECK ("provider" IN ('google', 'apple')),
  ADD CONSTRAINT "oauth_accounts_subject_hash_size" CHECK (octet_length("subject_hash") = 16);

ALTER TABLE "refresh_tokens"
  ADD CONSTRAINT "refresh_tokens_hash_size" CHECK (octet_length("token_hash") = 32),
  ADD CONSTRAINT "refresh_tokens_expiry_after_creation" CHECK ("expires_at" > "created_at");

ALTER TABLE "push_tokens"
  ADD CONSTRAINT "push_tokens_platform" CHECK ("platform" IN ('ios', 'android', 'web')),
  ADD CONSTRAINT "push_tokens_token_present" CHECK (length("token") >= 1);

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_channel" CHECK ("channel" IN ('push', 'sms', 'email', 'in_app', 'whatsapp')),
  ADD CONSTRAINT "notifications_status" CHECK ("status" IN ('pending', 'sent', 'delivered', 'failed', 'read')),
  ADD CONSTRAINT "notifications_whatsapp_pricing" CHECK ("whatsapp_pricing" IN ('window', 'template'));
-- The unread badge; messages still to send; delivery receipts by the provider's ID.
CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id") WHERE "read_at" IS NULL;
CREATE INDEX "notifications_pending_idx" ON "notifications" ("created_at") WHERE "status" = 'pending';
CREATE INDEX "notifications_external_id_idx" ON "notifications" ("external_id") WHERE "external_id" IS NOT NULL;

ALTER TABLE "notification_marks" ADD CONSTRAINT "notification_marks_key_present" CHECK (length("key") >= 1);

ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_hash_size" CHECK (octet_length("phone_hash") = 16);

ALTER TABLE "user_appointments"
  ADD CONSTRAINT "user_appointments_status" CHECK (
    "status" IN ('pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show')),
  ADD CONSTRAINT "user_appointments_times" CHECK ("end_at" > "start_at"),
  ADD CONSTRAINT "user_appointments_public_id_format" CHECK ("appointment_public_id" ~ '^[0-9A-Za-z]{12}$');

-- One appointment at a time per person, across every business (D-036, DB-014). '[)': back to
-- back is fine. A claim is either held (expires_at set, no appointment yet) or booked.
ALTER TABLE "user_time_reservations"
  ADD CONSTRAINT "user_time_reservations_times" CHECK ("end_at" > "start_at"),
  ADD CONSTRAINT "user_time_reservations_held_or_booked" CHECK (("appointment_id" IS NULL) = ("expires_at" IS NOT NULL)),
  ADD CONSTRAINT "user_time_reservations_no_overlap"
    EXCLUDE USING gist ("user_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&);
-- The sweeper: lapsed holds.
CREATE INDEX "user_time_reservations_held_idx" ON "user_time_reservations" ("expires_at") WHERE "expires_at" IS NOT NULL;

ALTER TABLE "user_business_roles"
  ADD CONSTRAINT "user_business_roles_role" CHECK ("role" IN ('owner', 'manager', 'front_desk', 'staff')),
  ADD CONSTRAINT "user_business_roles_status" CHECK ("status" IN ('active', 'disabled'));

-- ── Audit log: append-only for every role ──
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log entries can''t be changed or deleted' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

-- ── Outbox: each service sees and changes only the events it wrote (D-092) ──
ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_attempts" CHECK ("attempts" >= 0);
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" ("source", "created_at") WHERE "published_at" IS NULL;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_own_rows" ON "outbox_events"
  USING (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service')
  WITH CHECK (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service');

-- ═══════════════════════ Partitions (DB-006, pg_partman) ═══════════════════════
-- Made ahead and dropped behind by pg_partman, run hourly by pg_cron (scheduled per shard by
-- provisioning). infinite_time_partitions: keep making them even through a quiet spell.
SELECT partman.create_parent(p_parent_table := 'public.notifications', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.audit_logs', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
-- Sessions slide for up to two years (SESSION_IDLE_TIMEOUT_DAYS ≤ 730): months made that far ahead.
-- Tokens never expire in the past, so it starts at this month.
SELECT partman.create_parent(p_parent_table := 'public.refresh_tokens', p_control := 'expires_at',
  p_interval := '1 month', p_premake := 25, p_start_partition := to_char(date_trunc('month', now()), 'YYYY-MM-DD'));
SELECT partman.create_parent(p_parent_table := 'public.outbox_events', p_control := 'created_at',
  p_interval := '1 day', p_premake := 7);
SELECT partman.create_parent(p_parent_table := 'public.processed_events', p_control := 'occurred_at',
  p_interval := '1 day', p_premake := 7);
UPDATE partman.part_config SET infinite_time_partitions = true
 WHERE parent_table IN ('public.notifications', 'public.audit_logs', 'public.refresh_tokens',
                        'public.outbox_events', 'public.processed_events');
-- Kept: notifications 6 months; tokens 7 days past expiry; the outbox and the idempotency
-- ledger 14 days. The audit log is not dropped here: D4 copies each month to locked storage first.
UPDATE partman.part_config SET retention = '6 months', retention_keep_table = false WHERE parent_table = 'public.notifications';
UPDATE partman.part_config SET retention = '7 days', retention_keep_table = false WHERE parent_table = 'public.refresh_tokens';
UPDATE partman.part_config SET retention = '14 days', retention_keep_table = false
 WHERE parent_table IN ('public.outbox_events', 'public.processed_events');

-- ═══════════════════════ Who may do what ═══════════════════════
-- Shard databases grant nothing by default (DB-023): only these parent tables, never a partition
-- directly. buku_app is the tools' and tests' role; each service's own rights come from
-- scripts/apply-access.ts.
GRANT SELECT, INSERT, UPDATE, DELETE ON "users", "user_mfa", "oauth_accounts", "refresh_tokens", "push_tokens",
  "notification_preferences", "notifications", "notification_marks", "whatsapp_contacts", "favourites",
  "user_appointments", "user_time_reservations", "user_active_tickets", "user_business_roles",
  "outbox_events", "processed_events" TO buku_app;
GRANT SELECT, INSERT ON "audit_logs" TO buku_app;
