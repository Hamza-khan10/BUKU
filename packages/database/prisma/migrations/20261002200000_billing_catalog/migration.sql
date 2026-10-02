-- 2.5 billing, part 1: a flexible catalog (D-065). Plans, prices, limits, benefits and
-- the on/off switch per audience are DATA, edited by platform admins at any time.
-- Billing starts SWITCHED OFF for both audiences (everyone unlimited) until checkout
-- exists; the plans below are the starting catalog, not code.

-- CreateEnum
CREATE TYPE "PlanAudience" AS ENUM ('user', 'business');

-- CreateEnum
CREATE TYPE "BillingChannel" AS ENUM ('web', 'android', 'ios');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('month', 'year');

-- DropIndex
DROP INDEX "subscriptions_paddle_subscription_id_key";

-- AlterTable
ALTER TABLE "businesses" DROP COLUMN "subscription_expires_at",
DROP COLUMN "subscription_tier";

-- AlterTable
ALTER TABLE "subscriptions" DROP COLUMN "paddle_customer_id",
DROP COLUMN "paddle_subscription_id",
DROP COLUMN "plan",
ADD COLUMN     "channel" "BillingChannel",
ADD COLUMN     "external_customer_id" VARCHAR(200),
ADD COLUMN     "external_subscription_id" VARCHAR(200),
ADD COLUMN     "grant_note" VARCHAR(300),
ADD COLUMN     "granted_by_id" UUID,
ADD COLUMN     "plan_id" UUID NOT NULL,
ADD COLUMN     "price_id" UUID,
ADD COLUMN     "provider" VARCHAR(20) NOT NULL,
ADD COLUMN     "user_id" UUID,
ALTER COLUMN "business_id" DROP NOT NULL;

-- DropEnum
DROP TYPE "SubscriptionTier";

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "audience" "PlanAudience" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "tagline" VARCHAR(200),
    "benefits" JSONB NOT NULL DEFAULT '[]',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "features" JSONB NOT NULL DEFAULT '{}',
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_prices" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "channel" "BillingChannel" NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "interval" "BillingInterval" NOT NULL DEFAULT 'month',
    "tax_inclusive" BOOLEAN NOT NULL DEFAULT false,
    "trial_days" INTEGER NOT NULL DEFAULT 0,
    "external_price_id" VARCHAR(200),
    "archived_at" TIMESTAMPTZ(6),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_settings" (
    "audience" "PlanAudience" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "default_plan_id" UUID NOT NULL,
    "plan_when_disabled_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("audience")
);

-- CreateTable
CREATE TABLE "billing_cost_items" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "monthly_amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" VARCHAR(300),
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_cost_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_channel_fees" (
    "channel" "BillingChannel" NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,
    "fixed_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "notes" VARCHAR(300),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "billing_channel_fees_pkey" PRIMARY KEY ("channel")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "plans_audience_archived_at_idx" ON "plans"("audience", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "plan_prices_external_price_id_key" ON "plan_prices"("external_price_id");

-- CreateIndex
CREATE INDEX "plan_prices_plan_id_archived_at_idx" ON "plan_prices"("plan_id", "archived_at");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_subscription_id_key" ON "subscriptions"("external_subscription_id");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_status_idx" ON "subscriptions"("plan_id", "status");

-- AddForeignKey
ALTER TABLE "plan_prices" ADD CONSTRAINT "plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_default_plan_id_fkey" FOREIGN KEY ("default_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_plan_when_disabled_id_fkey" FOREIGN KEY ("plan_when_disabled_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_price_id_fkey" FOREIGN KEY ("price_id") REFERENCES "plan_prices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_granted_by_id_fkey" FOREIGN KEY ("granted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Rules ───────────────────────────────────────────────────────────────────
ALTER TABLE "plans"
  ADD CONSTRAINT "chk_plans_code" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,49}$'),
  ADD CONSTRAINT "chk_plans_benefits" CHECK (jsonb_typeof("benefits") = 'array'),
  ADD CONSTRAINT "chk_plans_limits" CHECK (jsonb_typeof("limits") = 'object'),
  ADD CONSTRAINT "chk_plans_features" CHECK (jsonb_typeof("features") = 'object');

ALTER TABLE "plan_prices"
  ADD CONSTRAINT "chk_plan_prices_amount" CHECK ("amount" >= 0),
  ADD CONSTRAINT "chk_plan_prices_currency" CHECK ("currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "chk_plan_prices_trial" CHECK ("trial_days" BETWEEN 0 AND 365);
-- One price in force per plan, channel, currency and interval; older ones are archived.
CREATE UNIQUE INDEX "plan_prices_one_active" ON "plan_prices" ("plan_id", "channel", "currency", "interval")
  WHERE "archived_at" IS NULL;

ALTER TABLE "subscriptions"
  ADD CONSTRAINT "chk_subscriptions_owner" CHECK (("user_id" IS NULL) <> ("business_id" IS NULL)),
  ADD CONSTRAINT "chk_subscriptions_provider" CHECK ("provider" IN ('paddle', 'google_play', 'app_store', 'manual')),
  -- A store subscription has a channel and a price; an admin grant has neither.
  ADD CONSTRAINT "chk_subscriptions_source" CHECK (
    ("provider" = 'manual' AND "price_id" IS NULL) OR ("provider" <> 'manual' AND "channel" IS NOT NULL)
  ),
  ADD CONSTRAINT "chk_subscriptions_period" CHECK ("current_period_end" IS NULL OR "current_period_start" IS NULL OR "current_period_end" > "current_period_start");
-- At most one live subscription per user and per business.
CREATE UNIQUE INDEX "subscriptions_one_live_per_user" ON "subscriptions" ("user_id")
  WHERE "user_id" IS NOT NULL AND "status" IN ('active', 'trialing', 'past_due', 'paused');
-- (replaces the Phase 1 per-business index, now that business_id is optional)
DROP INDEX "subscriptions_one_live_per_business";
CREATE UNIQUE INDEX "subscriptions_one_live_per_business" ON "subscriptions" ("business_id")
  WHERE "business_id" IS NOT NULL AND "status" IN ('active', 'trialing', 'past_due', 'paused');

ALTER TABLE "billing_cost_items"
  ADD CONSTRAINT "chk_billing_cost_items_amount" CHECK ("monthly_amount" >= 0),
  ADD CONSTRAINT "chk_billing_cost_items_currency" CHECK ("currency" = 'USD'),
  ADD CONSTRAINT "chk_billing_cost_items_category" CHECK ("category" IN ('infrastructure', 'messaging', 'software', 'other'));

ALTER TABLE "billing_channel_fees"
  ADD CONSTRAINT "chk_billing_channel_fees_percent" CHECK ("percent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "chk_billing_channel_fees_fixed" CHECK ("fixed_amount" >= 0),
  ADD CONSTRAINT "chk_billing_channel_fees_currency" CHECK ("currency" = 'USD');

-- The plans an audience falls back to must be plans FOR that audience.
CREATE FUNCTION billing_settings_check_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT audience FROM plans WHERE id = NEW.default_plan_id) <> NEW.audience
     OR (SELECT audience FROM plans WHERE id = NEW.plan_when_disabled_id) <> NEW.audience THEN
    RAISE EXCEPTION 'billing_settings plans must belong to audience %', NEW.audience
      USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_billing_settings_audience';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER billing_settings_audience BEFORE INSERT OR UPDATE ON billing_settings
  FOR EACH ROW EXECUTE FUNCTION billing_settings_check_audience();

-- ── Starting catalog (edit through the admin API) ──────────────────────────
INSERT INTO "plans" ("id", "code", "audience", "name", "tagline", "benefits", "limits", "features", "is_public", "sort_order", "updated_at") VALUES
  (gen_random_uuid(), 'user_free', 'user', 'Free', 'Try BUKU',
   '["1 free booking or queue join", "Browse and search every business", "Booking receipts and queue tickets"]',
   '{"visits": 1}', '{}', true, 0, now()),
  (gen_random_uuid(), 'user_plus', 'user', 'BUKU Plus', 'Book and queue without limits',
   '["Unlimited bookings", "Unlimited queue joins", "Live queue position and alerts", "Reminders before every appointment"]',
   '{"visits": null}', '{}', true, 1, now()),
  (gen_random_uuid(), 'user_unlimited', 'user', 'Unlimited (billing off)', NULL, '[]', '{}', '{}', false, 99, now()),

  (gen_random_uuid(), 'business_free', 'business', 'Starter', 'Get listed and take bookings',
   '["Online bookings and receipts", "1 team login", "Up to 2 bookable staff"]',
   '{"team_accounts": 1, "staff_profiles": 2, "services": 10, "photos": 5}',
   '{"queue": false, "manual_approval": false, "staff_photos": false, "ads": false, "priority_support": false}', false, 0, now()),
  (gen_random_uuid(), 'business_local', 'business', 'Local', 'For barbers, clinics and local shops',
   '["Online bookings and receipts", "Virtual queue with live display", "Up to 3 team logins and 5 bookable staff", "Staff photos", "Approve bookings by hand"]',
   '{"team_accounts": 3, "staff_profiles": 5, "services": 30, "photos": 10}',
   '{"queue": true, "manual_approval": true, "staff_photos": true, "ads": false, "priority_support": false}', true, 1, now()),
  (gen_random_uuid(), 'business_mid', 'business', 'Mid-size', 'For growing teams',
   '["Everything in Local", "Up to 15 team logins and 25 bookable staff", "100 services, 30 photos", "Priority support"]',
   '{"team_accounts": 15, "staff_profiles": 25, "services": 100, "photos": 30}',
   '{"queue": true, "manual_approval": true, "staff_photos": true, "ads": false, "priority_support": true}', true, 2, now()),
  (gen_random_uuid(), 'business_enterprise', 'business', 'Enterprise', 'For large organisations',
   '["Everything in Mid-size", "Unlimited team logins and staff", "Unlimited services and photos", "Promote your business with ads", "Priority support"]',
   '{"team_accounts": null, "staff_profiles": null, "services": null, "photos": null}',
   '{"queue": true, "manual_approval": true, "staff_photos": true, "ads": true, "priority_support": true}', true, 3, now()),
  (gen_random_uuid(), 'business_unlimited', 'business', 'Unlimited (billing off)', NULL, '[]', '{}',
   '{"queue": true, "manual_approval": true, "staff_photos": true, "ads": true, "priority_support": false}', false, 99, now());

INSERT INTO "plan_prices" ("id", "plan_id", "channel", "currency", "amount", "interval")
SELECT gen_random_uuid(), p."id", v.channel::"BillingChannel", 'USD', v.amount, 'month'::"BillingInterval"
FROM (VALUES
  ('user_plus', 'web', 1.99), ('user_plus', 'android', 1.99), ('user_plus', 'ios', 4.99),
  ('business_local', 'web', 24.99), ('business_mid', 'web', 49.99), ('business_enterprise', 'web', 99.99)
) AS v(code, channel, amount)
JOIN "plans" p ON p."code" = v.code;

INSERT INTO "billing_settings" ("audience", "enabled", "default_plan_id", "plan_when_disabled_id", "updated_at")
SELECT 'user'::"PlanAudience", false, (SELECT id FROM plans WHERE code = 'user_free'), (SELECT id FROM plans WHERE code = 'user_unlimited'), now()
UNION ALL
SELECT 'business'::"PlanAudience", false, (SELECT id FROM plans WHERE code = 'business_free'), (SELECT id FROM plans WHERE code = 'business_unlimited'), now();

-- Starting points for the profit calculator — check against the providers' current terms.
INSERT INTO "billing_channel_fees" ("channel", "percent", "fixed_amount", "notes", "updated_at") VALUES
  ('web', 5.00, 0.50, 'Paddle (merchant of record: collects and remits sales tax/VAT)', now()),
  ('android', 15.00, 0, 'Google Play subscriptions', now()),
  ('ios', 15.00, 0, 'App Store Small Business Program (30% above $1M/year)', now());

INSERT INTO "billing_cost_items" ("id", "name", "category", "monthly_amount", "notes", "updated_at") VALUES
  (gen_random_uuid(), 'DigitalOcean Droplet (app server)', 'infrastructure', 48.00, 'Estimate - replace with your invoice', now()),
  (gen_random_uuid(), 'DigitalOcean Managed PostgreSQL', 'infrastructure', 30.00, 'Estimate - replace with your invoice', now()),
  (gen_random_uuid(), 'DigitalOcean Managed Valkey', 'infrastructure', 15.00, 'Estimate - replace with your invoice', now()),
  (gen_random_uuid(), 'DigitalOcean Spaces + CDN', 'infrastructure', 5.00, 'Estimate - replace with your invoice', now()),
  (gen_random_uuid(), 'Backups and monitoring', 'infrastructure', 10.00, 'Estimate - replace with your invoice', now());
