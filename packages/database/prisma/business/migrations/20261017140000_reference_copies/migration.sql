-- A read-only copy of the directory's reference data (docs/DATABASE.md DB-015), kept by logical
-- replication (the subscription is made by scripts/provision-shards.ts), so a business's joins
-- with categories, plans and currencies stay on its shard. Same columns as the source; no
-- foreign keys or checks: the directory holds those, and replication applies its changes as is.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reference";

-- CreateTable
CREATE TABLE "reference"."currencies" (
    "code" CHAR(3) NOT NULL,
    "exponent" SMALLINT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "name" VARCHAR(60) NOT NULL,

    CONSTRAINT "currencies_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "reference"."categories" (
    "id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "suggested_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "depth" SMALLINT NOT NULL DEFAULT 0,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "slug" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "name_key" VARCHAR(120),
    "icon" VARCHAR(10),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."plans" (
    "id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "sort_order" SMALLINT NOT NULL DEFAULT 0,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "code" VARCHAR(50) NOT NULL,
    "audience" VARCHAR(10) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "tagline" VARCHAR(200),
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "external_product_id" VARCHAR(200),

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."plan_prices" (
    "id" BIGINT NOT NULL,
    "plan_id" BIGINT NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "created_by_id" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "trial_days" SMALLINT NOT NULL DEFAULT 0,
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "channel" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "interval" VARCHAR(10) NOT NULL DEFAULT 'month',
    "external_price_id" VARCHAR(200),

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."billing_settings" (
    "audience" VARCHAR(10) NOT NULL,
    "default_plan_id" BIGINT NOT NULL,
    "plan_when_disabled_id" BIGINT NOT NULL,
    "trial_plan_id" BIGINT,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "trial_days" SMALLINT NOT NULL DEFAULT 30,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "trial_enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("audience")
);

-- CreateTable
CREATE TABLE "reference"."billing_channel_fees" (
    "channel" VARCHAR(10) NOT NULL,
    "fixed_minor" BIGINT NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "percent" DECIMAL(5,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" VARCHAR(300),

    CONSTRAINT "billing_channel_fees_pkey" PRIMARY KEY ("channel")
);

-- CreateTable
CREATE TABLE "reference"."billing_cost_items" (
    "id" BIGINT NOT NULL,
    "monthly_minor" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archived_at" TIMESTAMPTZ(6),
    "category" VARCHAR(30) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "name" VARCHAR(100) NOT NULL,
    "notes" VARCHAR(300),

    CONSTRAINT "billing_cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reference"."notification_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "updated_by_id" BIGINT,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "whatsapp_monthly_budget_cents" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_free_window_per_month" INTEGER NOT NULL DEFAULT 1000,
    "whatsapp_message_cost_cents" DECIMAL(8,4) NOT NULL DEFAULT 4,
    "quiet_start_hour" SMALLINT NOT NULL DEFAULT 21,
    "quiet_end_hour" SMALLINT NOT NULL DEFAULT 9,
    "suggestion_min_days" SMALLINT NOT NULL DEFAULT 7,
    "suggestion_max_per_30_days" SMALLINT NOT NULL DEFAULT 3,
    "suggestion_max_ignored" SMALLINT NOT NULL DEFAULT 3,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "reminder_24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder_2h" BOOLEAN NOT NULL DEFAULT true,
    "suggestions_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_paid_types" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "reference"."categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "categories_name_key_key" ON "reference"."categories"("name_key");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "reference"."categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "reference"."plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "plans_external_product_id_key" ON "reference"."plans"("external_product_id");

-- CreateIndex
CREATE INDEX "plans_audience_archived_at_idx" ON "reference"."plans"("audience", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_external_price_id_key" ON "reference"."plan_prices"("external_price_id");

-- CreateIndex
CREATE INDEX "plan_prices_plan_id_archived_at_idx" ON "reference"."plan_prices"("plan_id", "archived_at");

-- CreateIndex
CREATE INDEX "plan_prices_currency_idx" ON "reference"."plan_prices"("currency");

-- CreateIndex
CREATE INDEX "billing_settings_default_plan_id_idx" ON "reference"."billing_settings"("default_plan_id");

-- CreateIndex
CREATE INDEX "billing_settings_plan_when_disabled_id_idx" ON "reference"."billing_settings"("plan_when_disabled_id");

-- CreateIndex
CREATE INDEX "billing_settings_trial_plan_id_idx" ON "reference"."billing_settings"("trial_plan_id");



-- Read-only for everyone: changes come only from the directory, through replication.
GRANT USAGE ON SCHEMA "reference" TO buku_app;
GRANT SELECT ON ALL TABLES IN SCHEMA "reference" TO buku_app;
