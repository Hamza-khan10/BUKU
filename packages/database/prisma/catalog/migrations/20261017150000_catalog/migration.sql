-- The CATALOG (docs/DATABASE.md DB-041): every business as discovery sees it, in one database, kept
-- from the business shards' events; and a read-only copy of the reference data (DB-015).
-- Generated part first, then triggers, checks and grants.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "catalog";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "reference";

-- CreateTable
CREATE TABLE "catalog"."businesses" (
    "business_id" BIGINT NOT NULL,
    "category_id" BIGINT NOT NULL,
    "version" BIGINT NOT NULL,
    "min_price_minor" BIGINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "avg_rating" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "bookings_7d" INTEGER NOT NULL DEFAULT 0,
    "bookings_prev_7d" INTEGER NOT NULL DEFAULT 0,
    "queue_joins_7d" INTEGER NOT NULL DEFAULT 0,
    "kept_90d" INTEGER NOT NULL DEFAULT 0,
    "business_cancels_90d" INTEGER NOT NULL DEFAULT 0,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "offers_queue" BOOLEAN NOT NULL DEFAULT false,
    "public_id" CHAR(12) NOT NULL,
    "slug" VARCHAR(200) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "timezone" VARCHAR(60) NOT NULL,
    "city" VARCHAR(100) NOT NULL,
    "address" VARCHAR(500),
    "description" VARCHAR(5000),
    "logo_storage_key" VARCHAR(300),
    "cover_storage_key" VARCHAR(300),
    "search_vector" tsvector,
    "location" geography(Point,4326),

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "catalog"."services" (
    "service_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "version" BIGINT NOT NULL,
    "price_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "name" VARCHAR(200) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("service_id")
);

-- CreateTable
CREATE TABLE "catalog"."hours" (
    "business_id" BIGINT NOT NULL,
    "day_of_week" SMALLINT NOT NULL,
    "is_closed" BOOLEAN NOT NULL DEFAULT false,
    "open_time" VARCHAR(5) NOT NULL,
    "close_time" VARCHAR(5) NOT NULL,

    CONSTRAINT "hours_pkey" PRIMARY KEY ("business_id","day_of_week","open_time")
);

-- CreateTable
CREATE TABLE "catalog"."closures" (
    "id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "closure_date" DATE NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "start_time" VARCHAR(5),
    "end_time" VARCHAR(5),

    CONSTRAINT "closures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalog"."queues" (
    "business_id" BIGINT NOT NULL,
    "version" BIGINT NOT NULL,
    "session_date" DATE NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waiting" INTEGER NOT NULL DEFAULT 0,
    "is_open" BOOLEAN NOT NULL,

    CONSTRAINT "queues_pkey" PRIMARY KEY ("business_id")
);

-- CreateTable
CREATE TABLE "catalog"."ads" (
    "ad_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "category_id" BIGINT,
    "version" BIGINT NOT NULL,
    "total_budget_minor" BIGINT NOT NULL,
    "amount_spent_minor" BIGINT NOT NULL DEFAULT 0,
    "start_date" TIMESTAMPTZ(6) NOT NULL,
    "end_date" TIMESTAMPTZ(6) NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "country" CHAR(2),
    "city" VARCHAR(100),

    CONSTRAINT "ads_pkey" PRIMARY KEY ("ad_id")
);

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
CREATE UNIQUE INDEX "businesses_public_id_key" ON "catalog"."businesses"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_slug_key" ON "catalog"."businesses"("slug");

-- CreateIndex
CREATE INDEX "businesses_category_id_idx" ON "catalog"."businesses"("category_id");

-- CreateIndex
CREATE INDEX "businesses_created_at_idx" ON "catalog"."businesses"("created_at");

-- CreateIndex
CREATE INDEX "businesses_location_idx" ON "catalog"."businesses" USING GIST ("location");

-- CreateIndex
CREATE INDEX "businesses_search_vector_idx" ON "catalog"."businesses" USING GIN ("search_vector");

-- CreateIndex
CREATE INDEX "businesses_name_trgm_idx" ON "catalog"."businesses" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "services_business_id_idx" ON "catalog"."services"("business_id");

-- CreateIndex
CREATE INDEX "services_name_trgm_idx" ON "catalog"."services" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "closures_business_id_closure_date_idx" ON "catalog"."closures"("business_id", "closure_date");

-- CreateIndex
CREATE INDEX "ads_business_id_idx" ON "catalog"."ads"("business_id");

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

-- AddForeignKey
ALTER TABLE "catalog"."services" ADD CONSTRAINT "services_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "catalog"."businesses"("business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."hours" ADD CONSTRAINT "hours_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "catalog"."businesses"("business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."closures" ADD CONSTRAINT "closures_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "catalog"."businesses"("business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."queues" ADD CONSTRAINT "queues_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "catalog"."businesses"("business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalog"."ads" ADD CONSTRAINT "ads_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "catalog"."businesses"("business_id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ═══════════════════════ Rules Prisma can't express ═══════════════════════

ALTER TABLE "catalog"."businesses"
  ADD CONSTRAINT "businesses_status" CHECK ("status" IN ('pending', 'verified', 'suspended', 'rejected', 'deleted')),
  ADD CONSTRAINT "businesses_version" CHECK ("version" > 0),
  ADD CONSTRAINT "businesses_place" CHECK (("lat" IS NULL) = ("lng" IS NULL)
    AND ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180))),
  ADD CONSTRAINT "businesses_formats" CHECK (
    "country" ~ '^[A-Z]{2}$' AND "currency" ~ '^[A-Z]{3}$' AND "public_id" ~ '^[0-9A-Za-z]{12}$'),
  ADD CONSTRAINT "businesses_counts" CHECK (
    "avg_rating" BETWEEN 0 AND 5 AND "review_count" >= 0 AND "bookings_7d" >= 0 AND "bookings_prev_7d" >= 0
    AND "queue_joins_7d" >= 0 AND "kept_90d" >= 0 AND "business_cancels_90d" >= 0);
-- Who appears in search: live businesses only. By city, case-insensitively.
CREATE INDEX "businesses_visible_idx" ON "catalog"."businesses" ("category_id") WHERE "status" IN ('pending', 'verified');
CREATE INDEX "businesses_city_idx" ON "catalog"."businesses" (lower("city"));
ALTER TABLE "catalog"."services" ADD CONSTRAINT "services_price" CHECK ("price_minor" >= 0 AND "currency" ~ '^[A-Z]{3}$');
ALTER TABLE "catalog"."hours"
  ADD CONSTRAINT "hours_day" CHECK ("day_of_week" BETWEEN 0 AND 6),
  ADD CONSTRAINT "hours_times" CHECK ("open_time" < "close_time");
ALTER TABLE "catalog"."closures" ADD CONSTRAINT "closures_type" CHECK ("type" IN ('holiday', 'modified'));
ALTER TABLE "catalog"."queues" ADD CONSTRAINT "queues_waiting" CHECK ("waiting" >= 0);
-- Which ads may run where.
CREATE INDEX "ads_running_idx" ON "catalog"."ads" ("type", "country", "city") WHERE "status" = 'active';

-- One search document per business, as v1 built it: name (A), its kind and the kind's group,
-- and its active services (B: "haircut" finds barbers), description (C), city (D). And its point
-- on the map, from lat/lng.
CREATE FUNCTION "catalog"."businesses_derive"() RETURNS trigger
LANGUAGE plpgsql SET search_path = catalog, reference, pg_temp AS $$
BEGIN
  NEW."location" := CASE WHEN NEW."lat" IS NULL THEN NULL
    ELSE extensions.ST_SetSRID(extensions.ST_MakePoint(NEW."lng", NEW."lat"), 4326)::extensions.geography END;
  NEW."search_vector" :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce((
      SELECT c."name" || ' ' || coalesce(p."name", '')
      FROM reference."categories" c LEFT JOIN reference."categories" p ON p."id" = c."parent_id"
      WHERE c."id" = NEW."category_id"), '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce((
      SELECT string_agg(s."name", ' ') FROM catalog."services" s WHERE s."business_id" = NEW."business_id"), '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."description", '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."city", '')), 'D');
  RETURN NEW;
END $$;
CREATE TRIGGER "businesses_derive"
  BEFORE INSERT OR UPDATE OF "lat", "lng", "name", "description", "city", "category_id", "search_vector"
  ON "catalog"."businesses" FOR EACH ROW EXECUTE FUNCTION "catalog"."businesses_derive"();

-- A service added, renamed or removed: its business's document again (touching search_vector
-- fires the trigger above).
CREATE FUNCTION "catalog"."services_refresh_search"() RETURNS trigger
LANGUAGE plpgsql SET search_path = catalog, pg_temp AS $$
BEGIN
  UPDATE catalog."businesses" SET "search_vector" = NULL
  WHERE "business_id" IN (coalesce(NEW."business_id", OLD."business_id"), coalesce(OLD."business_id", NEW."business_id"));
  RETURN NULL;
END $$;
CREATE TRIGGER "services_refresh_search" AFTER INSERT OR DELETE OR UPDATE OF "name", "business_id"
  ON "catalog"."services" FOR EACH ROW EXECUTE FUNCTION "catalog"."services_refresh_search"();

-- A kind of business renamed or moved (on the directory): the documents of businesses in it or
-- under it. It arrives by replication, which skips ordinary triggers: this one fires ALWAYS.
CREATE FUNCTION "catalog"."categories_refresh_search"() RETURNS trigger
LANGUAGE plpgsql SET search_path = catalog, reference, pg_temp AS $$
BEGIN
  IF NEW."name" IS DISTINCT FROM OLD."name" OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id" THEN
    UPDATE catalog."businesses" SET "search_vector" = NULL
    WHERE "category_id" = NEW."id"
       OR "category_id" IN (SELECT "id" FROM reference."categories" WHERE "parent_id" = NEW."id");
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "categories_refresh_search" AFTER UPDATE ON "reference"."categories"
  FOR EACH ROW EXECUTE FUNCTION "catalog"."categories_refresh_search"();
ALTER TABLE "reference"."categories" ENABLE ALWAYS TRIGGER "categories_refresh_search";
-- The documents it clears are rebuilt by "businesses_derive", which must therefore fire in that
-- replicated session too. Safe: the catalog's own rows are written by services, never replicated.
ALTER TABLE "catalog"."businesses" ENABLE ALWAYS TRIGGER "businesses_derive";

-- ═══════════════════════ Who may do what ═══════════════════════
-- The reference copy is read-only for everyone (changes come only by replication). The catalog's
-- own tables are written by search-service's consumers; each service's rights: apply-access (D2d).
REVOKE ALL ON ALL TABLES IN SCHEMA "reference" FROM PUBLIC, buku_app;
GRANT USAGE ON SCHEMA "catalog", "reference" TO buku_app;
GRANT SELECT ON ALL TABLES IN SCHEMA "reference" TO buku_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "catalog" TO buku_app;
