-- A BUSINESS SHARD (docs/DATABASE.md §6, DB-010; diagram §9.3): everything that belongs to one
-- business. Applied to every business shard by scripts/provision-shards.ts. Generated part first
-- (the time-partitioned tables declared PARTITION BY RANGE), then the rules Prisma can't express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "businesses" (
    "id" BIGINT NOT NULL,
    "owner_user_id" BIGINT NOT NULL,
    "category_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "verified_at" TIMESTAMPTZ(6),
    "business_terms_accepted_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "public_id" CHAR(12) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(60) NOT NULL DEFAULT 'UTC',
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100),
    "postal_code" VARCHAR(20),
    "address" VARCHAR(500),
    "phone" VARCHAR(20),
    "email" VARCHAR(255),
    "website" VARCHAR(500),
    "description" VARCHAR(5000),
    "logo_storage_key" VARCHAR(300),
    "rejection_reason" VARCHAR(1000),
    "business_terms_version" VARCHAR(20),
    "settings" JSONB NOT NULL DEFAULT '{}',
    "location" geography(Point,4326),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_photos" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(6),
    "size_bytes" INTEGER NOT NULL,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "storage_key" VARCHAR(300) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "alt_text" VARCHAR(300),

    CONSTRAINT "business_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_documents" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "reviewed_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(6),
    "reviewed_at" TIMESTAMPTZ(6),
    "size_bytes" INTEGER NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'awaiting_upload',
    "storage_key" VARCHAR(300) NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "review_note" VARCHAR(1000),

    CONSTRAINT "business_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_legal_profiles" (
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "registration_country" CHAR(2) NOT NULL,
    "registration_type" VARCHAR(100) NOT NULL,
    "legal_name" VARCHAR(300) NOT NULL,
    "registered_address" VARCHAR(500) NOT NULL,
    "responsible_name" VARCHAR(200) NOT NULL,
    "responsible_role" VARCHAR(100) NOT NULL,
    "registration_number_hash" BYTEA NOT NULL,
    "registration_number_enc" BYTEA NOT NULL,
    "tax_id_enc" BYTEA,
    "responsible_email_enc" BYTEA,
    "responsible_phone_enc" BYTEA,

    CONSTRAINT "business_legal_profiles_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "business_members" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',

    CONSTRAINT "business_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_reports" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "reporter_id" BIGINT,
    "reviewed_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(6),
    "reason" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "details" VARCHAR(2000),

    CONSTRAINT "business_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_search_stats" (
    "business_id" BIGINT NOT NULL,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL,
    "bookings_7d" INTEGER NOT NULL DEFAULT 0,
    "bookings_prev_7d" INTEGER NOT NULL DEFAULT 0,
    "queue_joins_7d" INTEGER NOT NULL DEFAULT 0,
    "kept_90d" INTEGER NOT NULL DEFAULT 0,
    "business_cancels_90d" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "business_search_stats_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "business_hours" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "open_time" VARCHAR(5) NOT NULL,
    "close_time" VARCHAR(5) NOT NULL,

    CONSTRAINT "business_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_settings" (
    "business_id" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "booking_horizon_days" SMALLINT NOT NULL DEFAULT 365,
    "max_future_bookings_per_customer" SMALLINT NOT NULL DEFAULT 3,
    "cancellation_window_hours" SMALLINT NOT NULL DEFAULT 12,
    "min_notice_minutes" SMALLINT NOT NULL DEFAULT 60,
    "slot_step_minutes" SMALLINT NOT NULL DEFAULT 15,
    "no_show_grace_minutes" SMALLINT NOT NULL DEFAULT 15,
    "approval_below_show_up_percent" SMALLINT,
    "confirmation_mode" VARCHAR(10) NOT NULL DEFAULT 'automatic',

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "queue_settings" (
    "business_id" BIGINT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "remote_join_radius_meters" INTEGER NOT NULL DEFAULT 5000,
    "grace_period_seconds" INTEGER NOT NULL DEFAULT 300,
    "avg_service_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_queue_size" SMALLINT NOT NULL DEFAULT 200,
    "ticket_prefix" VARCHAR(3) NOT NULL DEFAULT 'A',

    CONSTRAINT "queue_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "service_groups" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "service_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "group_id" BIGINT,
    "price_minor" BIGINT NOT NULL,
    "deposit_minor" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "duration_minutes" SMALLINT NOT NULL,
    "buffer_minutes" SMALLINT NOT NULL DEFAULT 0,
    "max_concurrent" SMALLINT NOT NULL DEFAULT 1,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deposit_required" BOOLEAN NOT NULL DEFAULT false,
    "currency" CHAR(3) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "display_name" VARCHAR(100) NOT NULL,
    "bio" VARCHAR(1000),
    "specializations" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_photos" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "staff_id" BIGINT NOT NULL,
    "consent_confirmed_by_id" BIGINT,
    "consent_confirmed_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "size_bytes" INTEGER NOT NULL,
    "storage_key" VARCHAR(300) NOT NULL,

    CONSTRAINT "staff_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_services" (
    "staff_id" BIGINT NOT NULL,
    "service_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,

    CONSTRAINT "staff_services_pkey" PRIMARY KEY ("staff_id","service_id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(100) NOT NULL,
    "type" VARCHAR(50) NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_rules" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "staff_id" BIGINT,
    "resource_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "day_of_week" SMALLINT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "start_time" VARCHAR(5) NOT NULL,
    "end_time" VARCHAR(5) NOT NULL,

    CONSTRAINT "availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "staff_id" BIGINT,
    "resource_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exception_date" DATE NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),
    "reason" VARCHAR(200),

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" BIGINT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "staff_id" BIGINT NOT NULL,
    "recorded_by_id" BIGINT,
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "note" VARCHAR(300),

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id","started_at")
) PARTITION BY RANGE ("started_at");

-- CreateTable
CREATE TABLE "staff_open_shifts" (
    "staff_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "shift_id" BIGINT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_open_shifts_pkey" PRIMARY KEY ("staff_id","business_id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" BIGINT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "service_id" BIGINT NOT NULL,
    "staff_id" BIGINT,
    "resource_id" BIGINT,
    "rescheduled_from_id" BIGINT,
    "checked_in_by_id" BIGINT,
    "price_minor" BIGINT NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "blocked_until" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "checked_in_at" TIMESTAMPTZ(6),
    "rebook_reminder_at" TIMESTAMPTZ(6),
    "reminder_24h_sent_at" TIMESTAMPTZ(6),
    "reminder_2h_sent_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "late_cancellation" BOOLEAN NOT NULL DEFAULT false,
    "public_id" CHAR(12) NOT NULL,
    "code" VARCHAR(9) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "payment_status" VARCHAR(20) NOT NULL DEFAULT 'unpaid',
    "cancel_reason_code" VARCHAR(30),
    "cancelled_by" VARCHAR(10),
    "currency" CHAR(3) NOT NULL,
    "notes" VARCHAR(2000),
    "internal_notes" VARCHAR(2000),
    "cancel_reason" VARCHAR(1000),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id","start_at")
) PARTITION BY RANGE ("start_at");

-- CreateTable
CREATE TABLE "appointment_index" (
    "appointment_id" BIGINT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "staff_id" BIGINT,
    "resource_id" BIGINT,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "blocked_until" TIMESTAMPTZ(6) NOT NULL,
    "live" BOOLEAN NOT NULL,
    "public_id" CHAR(12) NOT NULL,
    "code" VARCHAR(9) NOT NULL,

    CONSTRAINT "appointment_index_pkey" PRIMARY KEY ("appointment_id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" BIGINT NOT NULL,
    "appointment_id" BIGINT NOT NULL,
    "appointment_start_at" TIMESTAMPTZ(6) NOT NULL,
    "actor_id" BIGINT,
    "from_status" VARCHAR(20),
    "to_status" VARCHAR(20) NOT NULL,
    "actor_type" VARCHAR(10) NOT NULL,
    "reason" VARCHAR(1000),

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "payments" (
    "id" BIGINT NOT NULL,
    "appointment_id" BIGINT NOT NULL,
    "appointment_start_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "platform_fee_minor" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "captured_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "currency" CHAR(3) NOT NULL,
    "method" VARCHAR(30),
    "provider_transaction_id" VARCHAR(200),
    "refund_id" VARCHAR(200),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" BIGINT NOT NULL,
    "appointment_id" BIGINT NOT NULL,
    "appointment_start_at" TIMESTAMPTZ(6) NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "flagged_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "edited_at" TIMESTAMPTZ(6),
    "owner_responded_at" TIMESTAMPTZ(6),
    "flagged_at" TIMESTAMPTZ(6),
    "hidden_at" TIMESTAMPTZ(6),
    "overall_rating" SMALLINT NOT NULL,
    "wait_time_rating" SMALLINT,
    "staff_rating" SMALLINT,
    "cleanliness_rating" SMALLINT,
    "value_rating" SMALLINT,
    "is_flagged" BOOLEAN NOT NULL DEFAULT false,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "comment" VARCHAR(2000),
    "owner_response" VARCHAR(2000),
    "flag_reason" VARCHAR(200),
    "hidden_reason" VARCHAR(300),

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_sessions" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "session_date" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "current_number" INTEGER NOT NULL DEFAULT 0,
    "last_called_number" INTEGER NOT NULL DEFAULT 0,
    "total_served" INTEGER NOT NULL DEFAULT 0,
    "avg_service_seconds" INTEGER NOT NULL DEFAULT 300,
    "grace_period_seconds" INTEGER NOT NULL DEFAULT 300,
    "max_queue_size" SMALLINT NOT NULL DEFAULT 200,
    "status" VARCHAR(10) NOT NULL DEFAULT 'open',
    "ticket_prefix" VARCHAR(5) NOT NULL DEFAULT 'A',

    CONSTRAINT "queue_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_tickets" (
    "id" BIGINT NOT NULL,
    "session_date" DATE NOT NULL,
    "session_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMPTZ(6),
    "served_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "left_at" TIMESTAMPTZ(6),
    "ticket_number" INTEGER NOT NULL,
    "estimated_wait_seconds" INTEGER,
    "actual_service_seconds" INTEGER,
    "last_alerted_ahead" SMALLINT,
    "priority_lane" BOOLEAN NOT NULL DEFAULT false,
    "joined_remotely" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "ticket_prefix" VARCHAR(5) NOT NULL DEFAULT 'A',
    "walk_in_name" VARCHAR(100),
    "notes" VARCHAR(500),

    CONSTRAINT "queue_tickets_pkey" PRIMARY KEY ("id","session_date")
) PARTITION BY RANGE ("session_date");

-- CreateTable
CREATE TABLE "business_ads" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "category_id" BIGINT,
    "weekly_budget_minor" BIGINT,
    "total_budget_minor" BIGINT NOT NULL,
    "amount_spent_minor" BIGINT NOT NULL DEFAULT 0,
    "revenue_attributed_minor" BIGINT NOT NULL DEFAULT 0,
    "impressions" BIGINT NOT NULL DEFAULT 0,
    "clicks" BIGINT NOT NULL DEFAULT 0,
    "bookings" BIGINT NOT NULL DEFAULT 0,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "approved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "currency" CHAR(3) NOT NULL,
    "country" CHAR(2),
    "city" VARCHAR(100),
    "rejection_reason" VARCHAR(1000),
    "payment_method" VARCHAR(30),
    "payment_ref" VARCHAR(200),

    CONSTRAINT "business_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_events" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ad_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "user_id" BIGINT,
    "type" VARCHAR(20) NOT NULL,
    "session_id" VARCHAR(100),
    "ip_hash" BYTEA,

    CONSTRAINT "ad_events_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "ai_receptionist_configs" (
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "total_calls_handled" INTEGER NOT NULL DEFAULT 0,
    "total_bookings_made" INTEGER NOT NULL DEFAULT 0,
    "is_enabled" BOOLEAN NOT NULL DEFAULT false,
    "phone_number" VARCHAR(20),
    "voice_id" VARCHAR(100),
    "greeting_message" VARCHAR(1000),
    "business_context" VARCHAR(8000),
    "active_overrides" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ai_receptionist_configs_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "ai_call_logs" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "business_id" BIGINT NOT NULL,
    "appointment_id" BIGINT,
    "duration_seconds" INTEGER,
    "outcome" VARCHAR(20) NOT NULL,
    "caller_phone_enc" BYTEA,
    "transcript_url" VARCHAR(2000),
    "failure_reason" VARCHAR(1000),

    CONSTRAINT "ai_call_logs_pkey" PRIMARY KEY ("id","created_at")
) PARTITION BY RANGE ("created_at");

-- CreateTable
CREATE TABLE "webhooks" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_triggered_at" TIMESTAMPTZ(6),
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "url" VARCHAR(2000) NOT NULL,
    "secret_enc" BYTEA NOT NULL,
    "events" TEXT[],

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_deliveries" (
    "id" BIGINT NOT NULL,
    "event_at" TIMESTAMPTZ(6) NOT NULL,
    "webhook_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "event_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "response_status" SMALLINT,
    "attempt_count" SMALLINT NOT NULL DEFAULT 1,
    "event_type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "response_body" VARCHAR(2048),

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id","event_at")
) PARTITION BY RANGE ("event_at");

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "price_id" BIGINT,
    "granted_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "provider_updated_at" TIMESTAMPTZ(6),
    "current_period_start" TIMESTAMPTZ(6),
    "current_period_end" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "channel" VARCHAR(10),
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "external_subscription_id" VARCHAR(200),
    "external_customer_id" VARCHAR(200),
    "grant_note" VARCHAR(300),

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_requests" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "requested_by_id" BIGINT NOT NULL,
    "decided_by_id" BIGINT,
    "subscription_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "decided_at" TIMESTAMPTZ(6),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "message" VARCHAR(1000) NOT NULL,
    "decision_note" VARCHAR(500),

    CONSTRAINT "plan_requests_pkey" PRIMARY KEY ("id")
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
CREATE UNIQUE INDEX "businesses_public_id_key" ON "businesses"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "businesses"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_logo_storage_key_key" ON "businesses"("logo_storage_key");

-- CreateIndex
CREATE INDEX "businesses_owner_user_id_idx" ON "businesses"("owner_user_id");

-- CreateIndex
CREATE INDEX "businesses_category_id_idx" ON "businesses"("category_id");

-- CreateIndex
CREATE INDEX "businesses_location_idx" ON "businesses" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "business_photos_storage_key_key" ON "business_photos"("storage_key");

-- CreateIndex
CREATE INDEX "business_photos_business_id_sort_order_idx" ON "business_photos"("business_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "business_documents_storage_key_key" ON "business_documents"("storage_key");

-- CreateIndex
CREATE INDEX "business_documents_business_id_idx" ON "business_documents"("business_id");

-- CreateIndex
CREATE INDEX "business_legal_profiles_registration_number_hash_idx" ON "business_legal_profiles"("registration_number_hash");

-- CreateIndex
CREATE INDEX "business_members_user_id_idx" ON "business_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_members_business_id_user_id_key" ON "business_members"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_reports_business_id_reporter_id_key" ON "business_reports"("business_id", "reporter_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_hours_business_id_day_of_week_open_time_key" ON "business_hours"("business_id", "day_of_week", "open_time");

-- CreateIndex
CREATE UNIQUE INDEX "service_groups_business_id_name_key" ON "service_groups"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_groups_id_business_id_key" ON "service_groups"("id", "business_id");

-- CreateIndex
CREATE INDEX "services_business_id_is_active_sort_order_idx" ON "services"("business_id", "is_active", "sort_order");

-- CreateIndex
CREATE INDEX "services_group_id_idx" ON "services"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "services_id_business_id_key" ON "services"("id", "business_id");

-- CreateIndex
CREATE INDEX "staff_business_id_is_active_idx" ON "staff"("business_id", "is_active");

-- CreateIndex
CREATE INDEX "staff_user_id_idx" ON "staff"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_business_id_user_id_key" ON "staff"("business_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_id_business_id_key" ON "staff"("id", "business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_photos_storage_key_key" ON "staff_photos"("storage_key");

-- CreateIndex
CREATE INDEX "staff_photos_business_id_idx" ON "staff_photos"("business_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_photos_staff_id_business_id_key" ON "staff_photos"("staff_id", "business_id");

-- CreateIndex
CREATE INDEX "staff_services_service_id_idx" ON "staff_services"("service_id");

-- CreateIndex
CREATE INDEX "staff_services_business_id_idx" ON "staff_services"("business_id");

-- CreateIndex
CREATE INDEX "resources_business_id_is_active_idx" ON "resources"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "resources_id_business_id_key" ON "resources"("id", "business_id");

-- CreateIndex
CREATE INDEX "availability_rules_business_id_day_of_week_idx" ON "availability_rules"("business_id", "day_of_week");

-- CreateIndex
CREATE INDEX "availability_rules_staff_id_day_of_week_idx" ON "availability_rules"("staff_id", "day_of_week");

-- CreateIndex
CREATE INDEX "availability_rules_resource_id_idx" ON "availability_rules"("resource_id");

-- CreateIndex
CREATE INDEX "availability_exceptions_business_id_exception_date_idx" ON "availability_exceptions"("business_id", "exception_date");

-- CreateIndex
CREATE INDEX "availability_exceptions_staff_id_exception_date_idx" ON "availability_exceptions"("staff_id", "exception_date");

-- CreateIndex
CREATE INDEX "availability_exceptions_resource_id_idx" ON "availability_exceptions"("resource_id");

-- CreateIndex
CREATE INDEX "staff_shifts_business_id_started_at_idx" ON "staff_shifts"("business_id", "started_at");

-- CreateIndex
CREATE INDEX "staff_shifts_staff_id_started_at_idx" ON "staff_shifts"("staff_id", "started_at");

-- CreateIndex
CREATE INDEX "staff_open_shifts_business_id_idx" ON "staff_open_shifts"("business_id");

-- CreateIndex
CREATE INDEX "appointments_business_id_start_at_idx" ON "appointments"("business_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_staff_id_start_at_idx" ON "appointments"("staff_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_business_id_user_id_start_at_idx" ON "appointments"("business_id", "user_id", "start_at");

-- CreateIndex
CREATE INDEX "appointments_service_id_idx" ON "appointments"("service_id");

-- CreateIndex
CREATE INDEX "appointments_resource_id_idx" ON "appointments"("resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_index_public_id_key" ON "appointment_index"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_index_business_id_code_key" ON "appointment_index"("business_id", "code");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_idx" ON "appointment_events"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_events_business_id_created_at_idx" ON "appointment_events"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_appointment_id_key" ON "payments"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_transaction_id_key" ON "payments"("provider_transaction_id");

-- CreateIndex
CREATE INDEX "payments_business_id_created_at_idx" ON "payments"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reviews_appointment_id_key" ON "reviews"("appointment_id");

-- CreateIndex
CREATE INDEX "reviews_business_id_is_visible_created_at_idx" ON "reviews"("business_id", "is_visible", "created_at");

-- CreateIndex
CREATE INDEX "reviews_business_id_overall_rating_idx" ON "reviews"("business_id", "overall_rating");

-- CreateIndex
CREATE INDEX "reviews_user_id_idx" ON "reviews"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_sessions_business_id_session_date_key" ON "queue_sessions"("business_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_sessions_id_business_id_session_date_key" ON "queue_sessions"("id", "business_id", "session_date");

-- CreateIndex
CREATE INDEX "queue_tickets_session_id_status_idx" ON "queue_tickets"("session_id", "status");

-- CreateIndex
CREATE INDEX "queue_tickets_business_id_session_date_idx" ON "queue_tickets"("business_id", "session_date");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_number_key" ON "queue_tickets"("session_id", "ticket_number", "session_date");

-- CreateIndex
CREATE INDEX "business_ads_business_id_status_idx" ON "business_ads"("business_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "business_ads_id_business_id_key" ON "business_ads"("id", "business_id");

-- CreateIndex
CREATE INDEX "ad_events_ad_id_type_created_at_idx" ON "ad_events"("ad_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "ad_events_business_id_type_created_at_idx" ON "ad_events"("business_id", "type", "created_at");

-- CreateIndex
CREATE INDEX "ai_call_logs_business_id_created_at_idx" ON "ai_call_logs"("business_id", "created_at");

-- CreateIndex
CREATE INDEX "webhooks_business_id_is_active_idx" ON "webhooks"("business_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "webhooks_id_business_id_key" ON "webhooks"("id", "business_id");

-- CreateIndex
CREATE INDEX "webhook_deliveries_business_id_event_at_idx" ON "webhook_deliveries"("business_id", "event_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_deliveries_webhook_id_event_id_event_at_key" ON "webhook_deliveries"("webhook_id", "event_id", "event_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_subscription_id_key" ON "subscriptions"("external_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_business_id_status_idx" ON "subscriptions"("business_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_status_idx" ON "subscriptions"("plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_id_business_id_key" ON "subscriptions"("id", "business_id");

-- CreateIndex
CREATE INDEX "plan_requests_business_id_created_at_idx" ON "plan_requests"("business_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_requests_subscription_id_business_id_key" ON "plan_requests"("subscription_id", "business_id");

-- CreateIndex
CREATE INDEX "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_created_at_idx" ON "audit_logs"("resource_type", "resource_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_type_aggregate_id_idx" ON "outbox_events"("aggregate_type", "aggregate_id");

-- AddForeignKey
ALTER TABLE "business_photos" ADD CONSTRAINT "business_photos_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_documents" ADD CONSTRAINT "business_documents_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_legal_profiles" ADD CONSTRAINT "business_legal_profiles_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_members" ADD CONSTRAINT "business_members_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_reports" ADD CONSTRAINT "business_reports_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_search_stats" ADD CONSTRAINT "business_search_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_hours" ADD CONSTRAINT "business_hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_settings" ADD CONSTRAINT "queue_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_group_id_business_id_fkey" FOREIGN KEY ("group_id", "business_id") REFERENCES "service_groups"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff" ADD CONSTRAINT "staff_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_services" ADD CONSTRAINT "staff_services_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_resource_id_business_id_fkey" FOREIGN KEY ("resource_id", "business_id") REFERENCES "resources"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_resource_id_business_id_fkey" FOREIGN KEY ("resource_id", "business_id") REFERENCES "resources"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_open_shifts" ADD CONSTRAINT "staff_open_shifts_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_business_id_fkey" FOREIGN KEY ("service_id", "business_id") REFERENCES "services"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resource_id_business_id_fkey" FOREIGN KEY ("resource_id", "business_id") REFERENCES "resources"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_index" ADD CONSTRAINT "appointment_index_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_sessions" ADD CONSTRAINT "queue_sessions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_session_id_business_id_session_date_fkey" FOREIGN KEY ("session_id", "business_id", "session_date") REFERENCES "queue_sessions"("id", "business_id", "session_date") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_ads" ADD CONSTRAINT "business_ads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_events" ADD CONSTRAINT "ad_events_ad_id_business_id_fkey" FOREIGN KEY ("ad_id", "business_id") REFERENCES "business_ads"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_receptionist_configs" ADD CONSTRAINT "ai_receptionist_configs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_call_logs" ADD CONSTRAINT "ai_call_logs_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_business_id_fkey" FOREIGN KEY ("webhook_id", "business_id") REFERENCES "webhooks"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_subscription_id_business_id_fkey" FOREIGN KEY ("subscription_id", "business_id") REFERENCES "subscriptions"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════ Rules Prisma can't express ═══════════════════════

-- The business a session works for (DB-020): row-level security compares every row to it.
CREATE FUNCTION "current_business"() RETURNS BIGINT
LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('buku.business_id', true), '')::bigint $$;

-- ── The business ──
ALTER TABLE "businesses"
  ADD CONSTRAINT "businesses_id_positive" CHECK ("id" > 0),
  ADD CONSTRAINT "businesses_public_id_format" CHECK ("public_id" ~ '^[0-9A-Za-z]{12}$'),
  ADD CONSTRAINT "businesses_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 100),
  ADD CONSTRAINT "businesses_name_present" CHECK (length(btrim("name")) BETWEEN 1 AND 200),
  ADD CONSTRAINT "businesses_status" CHECK ("status" IN ('pending', 'verified', 'suspended', 'rejected')),
  ADD CONSTRAINT "businesses_verified_when_verified" CHECK (("status" = 'verified') <= ("verified_at" IS NOT NULL)),
  ADD CONSTRAINT "businesses_country_format" CHECK ("country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "businesses_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "businesses_timezone_format" CHECK ("timezone" ~ '^[A-Za-z0-9_+/-]{1,60}$'),
  ADD CONSTRAINT "businesses_place" CHECK (("lat" IS NULL) = ("lng" IS NULL)
    AND ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180))),
  ADD CONSTRAINT "businesses_rating" CHECK ("avg_rating" BETWEEN 0 AND 5 AND "review_count" >= 0);
CREATE INDEX "businesses_pending_idx" ON "businesses" ("created_at") WHERE "status" = 'pending';
CREATE INDEX "businesses_deleted_idx" ON "businesses" ("deleted_at") WHERE "deleted_at" IS NOT NULL;

-- Where it is, as a point the map queries can use; from lat/lng, never written by the app.
CREATE FUNCTION "businesses_location"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."location" := CASE WHEN NEW."lat" IS NULL THEN NULL
    ELSE extensions.ST_SetSRID(extensions.ST_MakePoint(NEW."lng", NEW."lat"), 4326)::extensions.geography END;
  RETURN NEW;
END $$;
CREATE TRIGGER "businesses_location" BEFORE INSERT OR UPDATE OF "lat", "lng" ON "businesses"
  FOR EACH ROW EXECUTE FUNCTION "businesses_location"();

ALTER TABLE "business_photos"
  ADD CONSTRAINT "business_photos_size" CHECK ("size_bytes" BETWEEN 1 AND 20971520),
  ADD CONSTRAINT "business_photos_order" CHECK ("sort_order" >= 0);
ALTER TABLE "business_documents"
  ADD CONSTRAINT "business_documents_type" CHECK ("type" IN
    ('business_license', 'medical_license', 'id_proof', 'address_proof', 'tax_certificate', 'other')),
  ADD CONSTRAINT "business_documents_status" CHECK ("status" IN ('awaiting_upload', 'pending', 'approved', 'rejected')),
  ADD CONSTRAINT "business_documents_size" CHECK ("size_bytes" BETWEEN 1 AND 20971520);
-- The admins' review queue.
CREATE INDEX "business_documents_pending_idx" ON "business_documents" ("created_at") WHERE "status" = 'pending';
ALTER TABLE "business_legal_profiles"
  ADD CONSTRAINT "business_legal_profiles_country" CHECK ("registration_country" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "business_legal_profiles_hash_size" CHECK (octet_length("registration_number_hash") = 16);
ALTER TABLE "business_members"
  ADD CONSTRAINT "business_members_role" CHECK ("role" IN ('manager', 'front_desk', 'staff')),
  ADD CONSTRAINT "business_members_status" CHECK ("status" IN ('active', 'disabled'));
ALTER TABLE "business_reports"
  ADD CONSTRAINT "business_reports_reason" CHECK ("reason" IN
    ('fake_business', 'wrong_information', 'inappropriate_content', 'scam_or_fraud', 'other')),
  ADD CONSTRAINT "business_reports_status" CHECK ("status" IN ('open', 'reviewed', 'dismissed'));
CREATE INDEX "business_reports_open_idx" ON "business_reports" ("created_at") WHERE "status" = 'open';
ALTER TABLE "business_search_stats"
  ADD CONSTRAINT "business_search_stats_counts" CHECK (
    "bookings_7d" >= 0 AND "bookings_prev_7d" >= 0 AND "queue_joins_7d" >= 0 AND "kept_90d" >= 0
    AND "business_cancels_90d" >= 0);
ALTER TABLE "business_hours"
  ADD CONSTRAINT "business_hours_day" CHECK ("day_of_week" BETWEEN 0 AND 6),
  ADD CONSTRAINT "business_hours_times" CHECK (
    "open_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "close_time" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    AND "open_time" < "close_time");
ALTER TABLE "booking_settings"
  ADD CONSTRAINT "booking_settings_mode" CHECK ("confirmation_mode" IN ('automatic', 'manual')),
  ADD CONSTRAINT "booking_settings_ranges" CHECK (
    "booking_horizon_days" BETWEEN 1 AND 730 AND "max_future_bookings_per_customer" BETWEEN 1 AND 100
    AND "cancellation_window_hours" BETWEEN 0 AND 168 AND "min_notice_minutes" BETWEEN 0 AND 10080
    AND "slot_step_minutes" BETWEEN 5 AND 240 AND "no_show_grace_minutes" BETWEEN 0 AND 240
    AND ("approval_below_show_up_percent" IS NULL OR "approval_below_show_up_percent" BETWEEN 1 AND 100));
ALTER TABLE "queue_settings"
  ADD CONSTRAINT "queue_settings_ranges" CHECK (
    "remote_join_radius_meters" BETWEEN 0 AND 100000 AND "grace_period_seconds" BETWEEN 0 AND 3600
    AND "avg_service_seconds" BETWEEN 30 AND 14400 AND "max_queue_size" BETWEEN 1 AND 2000),
  ADD CONSTRAINT "queue_settings_prefix" CHECK ("ticket_prefix" ~ '^[A-Z]{1,3}$');

-- ── Services, team, schedules ──
ALTER TABLE "service_groups" ADD CONSTRAINT "service_groups_name_present" CHECK (length(btrim("name")) >= 1);
ALTER TABLE "services"
  ADD CONSTRAINT "services_name_present" CHECK (length(btrim("name")) >= 1),
  ADD CONSTRAINT "services_times" CHECK (
    "duration_minutes" BETWEEN 5 AND 1440 AND "buffer_minutes" BETWEEN 0 AND 240 AND "max_concurrent" BETWEEN 1 AND 100),
  ADD CONSTRAINT "services_money" CHECK ("price_minor" >= 0 AND ("deposit_minor" IS NULL OR "deposit_minor" BETWEEN 0 AND "price_minor")),
  ADD CONSTRAINT "services_deposit" CHECK ("deposit_required" <= ("deposit_minor" IS NOT NULL)),
  ADD CONSTRAINT "services_currency_format" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "staff" ADD CONSTRAINT "staff_name_present" CHECK (length(btrim("display_name")) >= 1);
ALTER TABLE "staff_photos" ADD CONSTRAINT "staff_photos_size" CHECK ("size_bytes" BETWEEN 1 AND 20971520);
ALTER TABLE "resources" ADD CONSTRAINT "resources_name_present" CHECK (length(btrim("name")) >= 1);
ALTER TABLE "availability_rules"
  ADD CONSTRAINT "availability_rules_day" CHECK ("day_of_week" BETWEEN 0 AND 6),
  ADD CONSTRAINT "availability_rules_times" CHECK (
    "start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND "end_time" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
    AND "start_time" < "end_time"),
  -- For one employee or one resource, or the whole business; never both.
  ADD CONSTRAINT "availability_rules_target" CHECK ("staff_id" IS NULL OR "resource_id" IS NULL);
ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "availability_exceptions_type" CHECK ("type" IN ('holiday', 'modified', 'extra_hours')),
  ADD CONSTRAINT "availability_exceptions_times" CHECK (
    ("start_time" IS NULL) = ("end_time" IS NULL)
    AND ("start_time" IS NULL OR ("start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         AND "end_time" ~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' AND "start_time" < "end_time"))
    AND ("type" = 'holiday') = ("start_time" IS NULL)),
  ADD CONSTRAINT "availability_exceptions_target" CHECK ("staff_id" IS NULL OR "resource_id" IS NULL);

-- An employee is on one shift at a time: staff_open_shifts (keyed by the employee) holds the
-- open one, kept here; a second open shift is refused by its key.
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_times" CHECK ("ended_at" IS NULL OR "ended_at" > "started_at");
CREATE FUNCTION "staff_open_shift_sync"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."ended_at" IS NULL THEN
    DELETE FROM "staff_open_shifts" WHERE "staff_id" = OLD."staff_id" AND "shift_id" = OLD."id";
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW."ended_at" IS NULL THEN
    INSERT INTO "staff_open_shifts" ("staff_id", "business_id", "shift_id", "started_at")
    VALUES (NEW."staff_id", NEW."business_id", NEW."id", NEW."started_at");
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "staff_shifts_open" AFTER INSERT OR UPDATE OR DELETE ON "staff_shifts"
  FOR EACH ROW EXECUTE FUNCTION "staff_open_shift_sync"();

-- ── Appointments ──
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_id_positive" CHECK ("id" > 0),
  ADD CONSTRAINT "appointments_times" CHECK ("end_at" > "start_at" AND "blocked_until" >= "end_at"),
  ADD CONSTRAINT "appointments_status" CHECK ("status" IN
    ('pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show')),
  ADD CONSTRAINT "appointments_payment_status" CHECK ("payment_status" IN ('unpaid', 'deposit_paid', 'paid', 'refunded')),
  ADD CONSTRAINT "appointments_cancel_reason" CHECK ("cancel_reason_code" IN ('schedule_conflict', 'found_alternative',
    'too_expensive', 'not_needed', 'illness', 'business_unavailable', 'declined', 'other')),
  ADD CONSTRAINT "appointments_cancelled_by" CHECK ("cancelled_by" IN ('user', 'business', 'system')),
  ADD CONSTRAINT "appointments_cancelled" CHECK (("status" = 'cancelled') <= ("cancelled_at" IS NOT NULL)),
  ADD CONSTRAINT "appointments_money" CHECK ("price_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "appointments_version" CHECK ("version" >= 1),
  ADD CONSTRAINT "appointments_public_id_format" CHECK ("public_id" ~ '^[0-9A-Za-z]{12}$'),
  ADD CONSTRAINT "appointments_code_format" CHECK ("code" ~ '^BK-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$');
-- What's still to happen (reminders, the day's list); "book again" reminders.
CREATE INDEX "appointments_live_idx" ON "appointments" ("start_at") WHERE "status" IN ('pending', 'confirmed');
CREATE INDEX "appointments_rebook_idx" ON "appointments" ("rebook_reminder_at") WHERE "rebook_reminder_at" IS NOT NULL;

-- An appointment's time, business, customer and references never change: moving it makes a
-- new appointment. So it never changes partition, and what points at it stays right.
CREATE FUNCTION "appointments_fixed"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" <> OLD."id" OR NEW."start_at" <> OLD."start_at" OR NEW."business_id" <> OLD."business_id"
     OR NEW."user_id" <> OLD."user_id" OR NEW."public_id" <> OLD."public_id" OR NEW."code" <> OLD."code" THEN
    RAISE EXCEPTION 'an appointment''s time, business, customer and references never change; rescheduling makes a new one'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "appointments_fixed" BEFORE UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION "appointments_fixed"();

-- The appointment index (DB-024): kept by this trigger, written by nothing else.
--  • public IDs unique everywhere, codes unique within the business;
--  • one employee, one resource and one customer can't be booked twice at the same time.
--    '[)': back to back is fine. Only live appointments (pending, confirmed) count.
ALTER TABLE "appointment_index"
  ADD CONSTRAINT "appointment_index_times" CHECK ("end_at" > "start_at" AND "blocked_until" >= "end_at"),
  ADD CONSTRAINT "appointment_index_staff_free" EXCLUDE USING gist
    ("staff_id" WITH =, tstzrange("start_at", "blocked_until", '[)') WITH &&) WHERE ("live" AND "staff_id" IS NOT NULL),
  ADD CONSTRAINT "appointment_index_resource_free" EXCLUDE USING gist
    ("resource_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("live" AND "resource_id" IS NOT NULL),
  ADD CONSTRAINT "appointment_index_customer_free" EXCLUDE USING gist
    ("business_id" WITH =, "user_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&) WHERE ("live");
CREATE FUNCTION "appointment_index_sync"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "appointment_index" WHERE "appointment_id" = OLD."id";
    RETURN NULL;
  END IF;
  INSERT INTO "appointment_index" AS i ("appointment_id", "start_at", "business_id", "user_id", "staff_id",
    "resource_id", "end_at", "blocked_until", "live", "public_id", "code")
  VALUES (NEW."id", NEW."start_at", NEW."business_id", NEW."user_id", NEW."staff_id", NEW."resource_id",
    NEW."end_at", NEW."blocked_until", NEW."status" IN ('pending', 'confirmed'), NEW."public_id", NEW."code")
  ON CONFLICT ("appointment_id") DO UPDATE SET "staff_id" = EXCLUDED."staff_id", "resource_id" = EXCLUDED."resource_id",
    "end_at" = EXCLUDED."end_at", "blocked_until" = EXCLUDED."blocked_until", "live" = EXCLUDED."live";
  RETURN NULL;
END $$;
CREATE TRIGGER "appointments_index" AFTER INSERT OR UPDATE OR DELETE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION "appointment_index_sync"();

ALTER TABLE "appointment_events"
  ADD CONSTRAINT "appointment_events_to_status" CHECK ("to_status" IN
    ('pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show')),
  ADD CONSTRAINT "appointment_events_from_status" CHECK ("from_status" IN
    ('pending', 'confirmed', 'rescheduled', 'completed', 'cancelled', 'no_show')),
  ADD CONSTRAINT "appointment_events_actor" CHECK ("actor_type" IN ('user', 'business', 'system'));
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_status" CHECK ("status" IN ('pending', 'authorized', 'captured', 'refunded', 'failed')),
  ADD CONSTRAINT "payments_money" CHECK (
    "amount_minor" >= 0 AND "platform_fee_minor" BETWEEN 0 AND "amount_minor" AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_ratings" CHECK (
    "overall_rating" BETWEEN 1 AND 5 AND coalesce("wait_time_rating", 1) BETWEEN 1 AND 5
    AND coalesce("staff_rating", 1) BETWEEN 1 AND 5 AND coalesce("cleanliness_rating", 1) BETWEEN 1 AND 5
    AND coalesce("value_rating", 1) BETWEEN 1 AND 5),
  ADD CONSTRAINT "reviews_flagged" CHECK ("is_flagged" = ("flagged_at" IS NOT NULL)),
  ADD CONSTRAINT "reviews_hidden" CHECK (("hidden_at" IS NOT NULL) <= (NOT "is_visible"));
CREATE INDEX "reviews_flagged_idx" ON "reviews" ("flagged_at") WHERE "is_flagged";

-- A business's rating and count always reflect its visible reviews.
CREATE FUNCTION "business_rating_sync"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE biz BIGINT := coalesce(NEW."business_id", OLD."business_id");
BEGIN
  UPDATE "businesses" b SET
    "avg_rating" = coalesce((SELECT round(avg(r."overall_rating")::numeric, 2) FROM "reviews" r
                             WHERE r."business_id" = biz AND r."is_visible"), 0),
    "review_count" = (SELECT count(*) FROM "reviews" r WHERE r."business_id" = biz AND r."is_visible")
  WHERE b."id" = biz;
  RETURN NULL;
END $$;
CREATE TRIGGER "reviews_rating" AFTER INSERT OR DELETE OR UPDATE OF "overall_rating", "is_visible" ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "business_rating_sync"();

-- ── Queues ──
ALTER TABLE "queue_sessions"
  ADD CONSTRAINT "queue_sessions_status" CHECK ("status" IN ('open', 'paused', 'closed')),
  ADD CONSTRAINT "queue_sessions_counters" CHECK (
    "current_number" >= 0 AND "last_called_number" BETWEEN 0 AND "current_number" AND "total_served" >= 0
    AND "avg_service_seconds" > 0 AND "grace_period_seconds" >= 0 AND "max_queue_size" > 0),
  ADD CONSTRAINT "queue_sessions_prefix" CHECK ("ticket_prefix" ~ '^[A-Z]{1,5}$');
ALTER TABLE "queue_tickets"
  ADD CONSTRAINT "queue_tickets_status" CHECK ("status" IN ('waiting', 'called', 'serving', 'completed', 'left', 'no_show')),
  ADD CONSTRAINT "queue_tickets_number" CHECK ("ticket_number" >= 1),
  ADD CONSTRAINT "queue_tickets_walk_in" CHECK ("user_id" IS NOT NULL OR NOT "joined_remotely");
-- One live ticket per person per session. The session fixes the date, so including it (the
-- partition key) keeps this exact across partitions (DB-024).
CREATE UNIQUE INDEX "queue_tickets_one_live_per_person" ON "queue_tickets" ("session_id", "user_id", "session_date")
  WHERE "user_id" IS NOT NULL AND "status" IN ('waiting', 'called', 'serving');

-- ── Ads, AI, integrations, billing ──
ALTER TABLE "business_ads"
  ADD CONSTRAINT "business_ads_type" CHECK ("type" IN
    ('featured_listing', 'category_spotlight', 'city_banner', 'appointment_boost', 'new_user_promo')),
  ADD CONSTRAINT "business_ads_status" CHECK ("status" IN
    ('draft', 'pending_approval', 'active', 'paused', 'expired', 'rejected')),
  ADD CONSTRAINT "business_ads_dates" CHECK ("end_date" > "start_date"),
  ADD CONSTRAINT "business_ads_money" CHECK (
    "total_budget_minor" >= 0 AND coalesce("weekly_budget_minor", 0) >= 0 AND "amount_spent_minor" >= 0
    AND "revenue_attributed_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "business_ads_counters" CHECK ("impressions" >= 0 AND "clicks" >= 0 AND "bookings" >= 0),
  ADD CONSTRAINT "business_ads_country" CHECK ("country" ~ '^[A-Z]{2}$');
-- Which ads may run where.
CREATE INDEX "business_ads_running_idx" ON "business_ads" ("type", "country", "city") WHERE "status" = 'active';
ALTER TABLE "ad_events"
  ADD CONSTRAINT "ad_events_type" CHECK ("type" IN ('impression', 'click', 'booking', 'profile_view')),
  ADD CONSTRAINT "ad_events_ip_hash_size" CHECK (octet_length("ip_hash") = 16);
ALTER TABLE "ai_call_logs"
  ADD CONSTRAINT "ai_call_logs_outcome" CHECK ("outcome" IN ('booked', 'not_booked', 'transferred', 'error')),
  ADD CONSTRAINT "ai_call_logs_duration" CHECK ("duration_seconds" >= 0);
ALTER TABLE "webhooks"
  ADD CONSTRAINT "webhooks_https" CHECK ("url" ~ '^https://'),
  ADD CONSTRAINT "webhooks_failures" CHECK ("failure_count" >= 0);
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_attempts" CHECK ("attempt_count" >= 1);
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" ("next_retry_at") WHERE "delivered_at" IS NULL;
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_status" CHECK ("status" IN ('active', 'past_due', 'cancelled', 'paused', 'trialing', 'expired')),
  ADD CONSTRAINT "subscriptions_channel" CHECK ("channel" IN ('web', 'android', 'ios')),
  ADD CONSTRAINT "subscriptions_provider" CHECK ("provider" IN ('paddle', 'google_play', 'app_store', 'manual', 'trial'));
-- One free trial per business, ever.
CREATE UNIQUE INDEX "subscriptions_one_trial" ON "subscriptions" ("business_id") WHERE "provider" = 'trial';
ALTER TABLE "plan_requests"
  ADD CONSTRAINT "plan_requests_status" CHECK ("status" IN ('pending', 'approved', 'declined', 'withdrawn'));
-- One open request per business; the admins' queue.
CREATE UNIQUE INDEX "plan_requests_one_pending" ON "plan_requests" ("business_id") WHERE "status" = 'pending';
CREATE INDEX "plan_requests_pending_idx" ON "plan_requests" ("created_at") WHERE "status" = 'pending';

-- What the AI receptionist knows (pgvector): Prisma can't express vectors, so it lives in its
-- own schema, read and written through typed SQL helpers.
CREATE SCHEMA "ai";
CREATE TABLE "ai"."business_knowledge_chunks" (
  "id"          BIGINT PRIMARY KEY,
  "business_id" BIGINT NOT NULL REFERENCES "public"."businesses" ("id") ON DELETE CASCADE,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "source"      VARCHAR(20) NOT NULL CHECK ("source" IN ('faq', 'service', 'policy', 'hours_note')),
  "content"     VARCHAR(8000) NOT NULL CHECK (length("content") >= 1),
  -- text-embedding-3-small: 1536 dimensions.
  "embedding"   extensions.vector(1536) NOT NULL
);
CREATE INDEX "business_knowledge_chunks_business_idx" ON "ai"."business_knowledge_chunks" ("business_id");
CREATE INDEX "business_knowledge_chunks_embedding_hnsw" ON "ai"."business_knowledge_chunks"
  USING hnsw ("embedding" extensions.vector_cosine_ops);

-- ── Audit log: append-only for every role ──
CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log entries can''t be changed or deleted' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

-- ── Outbox: each service sees and changes only the events it wrote (D-092) ──
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_attempts" CHECK ("attempts" >= 0);
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" ("source", "created_at") WHERE "published_at" IS NULL;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_own_rows" ON "outbox_events"
  USING (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service')
  WITH CHECK (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service');

-- ═══════════════════════ One business at a time (DB-020) ═══════════════════════
-- Every table with a business's rows: a session sees and writes only the business it set
-- (SET LOCAL buku.business_id = …). With nothing set it sees nothing, so a query that forgot its
-- business returns nothing rather than someone else's data. Services that must work across
-- businesses (reminders, search, admin) are granted buku_all_businesses WITH INHERIT TRUE by
-- apply-access; that role holds no table rights of its own, it only opens these policies.
-- The schema owner (migrations, upkeep) is not subject to them.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'business_photos', 'business_documents', 'business_legal_profiles', 'business_members', 'business_reports',
    'business_search_stats', 'business_hours', 'booking_settings', 'queue_settings', 'service_groups', 'services',
    'staff', 'staff_photos', 'staff_services', 'resources', 'availability_rules', 'availability_exceptions',
    'staff_shifts', 'staff_open_shifts', 'appointments', 'appointment_index', 'appointment_events', 'payments',
    'reviews', 'queue_sessions', 'queue_tickets', 'business_ads', 'ad_events', 'ai_receptionist_configs',
    'ai_call_logs', 'webhooks', 'webhook_deliveries', 'subscriptions', 'plan_requests'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "one_business" ON %I USING ("business_id" = "current_business"())
                    WITH CHECK ("business_id" = "current_business"())', t);
    EXECUTE format('CREATE POLICY "all_businesses" ON %I TO buku_all_businesses USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
ALTER TABLE "businesses" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "one_business" ON "businesses" USING ("id" = "current_business"()) WITH CHECK ("id" = "current_business"());
CREATE POLICY "all_businesses" ON "businesses" TO buku_all_businesses USING (true) WITH CHECK (true);
ALTER TABLE "ai"."business_knowledge_chunks" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "one_business" ON "ai"."business_knowledge_chunks"
  USING ("business_id" = "current_business"()) WITH CHECK ("business_id" = "current_business"());
CREATE POLICY "all_businesses" ON "ai"."business_knowledge_chunks" TO buku_all_businesses USING (true) WITH CHECK (true);

-- ═══════════════════════ Partitions (DB-006, pg_partman) ═══════════════════════
-- Appointments are booked up to two years ahead, so their months exist 25 months out; history
-- (a seed, an import) back 12. Old months of the records are detached into `archive` (kept,
-- reachable by nobody but the owner; D4 moves them to cheap storage); event streams are dropped.
CREATE SCHEMA "archive";
SELECT partman.create_parent(p_parent_table := 'public.appointments', p_control := 'start_at',
  p_interval := '1 month', p_premake := 25,
  p_start_partition := to_char(date_trunc('month', now()) - interval '12 months', 'YYYY-MM-DD'));
SELECT partman.create_parent(p_parent_table := 'public.appointment_events', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.staff_shifts', p_control := 'started_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.queue_tickets', p_control := 'session_date',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.ad_events', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.ai_call_logs', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.webhook_deliveries', p_control := 'event_at',
  p_interval := '1 week', p_premake := 4);
SELECT partman.create_parent(p_parent_table := 'public.audit_logs', p_control := 'created_at',
  p_interval := '1 month', p_premake := 3);
SELECT partman.create_parent(p_parent_table := 'public.outbox_events', p_control := 'created_at',
  p_interval := '1 day', p_premake := 7);
SELECT partman.create_parent(p_parent_table := 'public.processed_events', p_control := 'occurred_at',
  p_interval := '1 day', p_premake := 7);
UPDATE partman.part_config SET infinite_time_partitions = true WHERE parent_table LIKE 'public.%';
UPDATE partman.part_config SET retention = '25 months', retention_keep_table = true, retention_schema = 'archive'
 WHERE parent_table IN ('public.appointments', 'public.appointment_events', 'public.staff_shifts');
UPDATE partman.part_config SET retention = '13 months', retention_keep_table = true, retention_schema = 'archive'
 WHERE parent_table = 'public.queue_tickets';
UPDATE partman.part_config SET retention = '13 months', retention_keep_table = false
 WHERE parent_table IN ('public.ad_events', 'public.ai_call_logs');
UPDATE partman.part_config SET retention = '30 days', retention_keep_table = false WHERE parent_table = 'public.webhook_deliveries';
UPDATE partman.part_config SET retention = '14 days', retention_keep_table = false
 WHERE parent_table IN ('public.outbox_events', 'public.processed_events');

-- ═══════════════════════ Who may do what ═══════════════════════
-- Nothing by default (DB-023): only these parent tables, never a partition. buku_app is the
-- tools' and tests' role; each service's own rights come from apply-access (D2d). The
-- appointment index and open shifts are written only by their triggers; the audit log only
-- grows.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  "businesses", "business_photos", "business_documents", "business_legal_profiles", "business_members",
  "business_reports", "business_search_stats", "business_hours", "booking_settings", "queue_settings",
  "service_groups", "services", "staff", "staff_photos", "staff_services", "resources", "availability_rules",
  "availability_exceptions", "staff_shifts", "appointments", "appointment_events", "payments", "reviews",
  "queue_sessions", "queue_tickets", "business_ads", "ad_events", "ai_receptionist_configs", "ai_call_logs",
  "webhooks", "webhook_deliveries", "subscriptions", "plan_requests", "outbox_events", "processed_events"
  TO buku_app;
GRANT SELECT ON "appointment_index", "staff_open_shifts" TO buku_app;
GRANT SELECT, INSERT ON "audit_logs" TO buku_app;
GRANT USAGE ON SCHEMA "ai" TO buku_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai"."business_knowledge_chunks" TO buku_app;
