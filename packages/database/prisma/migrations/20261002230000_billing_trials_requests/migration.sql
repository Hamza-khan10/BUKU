-- 2.5: professional plan names, a one-month free trial each account can start once
-- (switchable per audience), and businesses requesting a plan (e.g. Enterprise for free).

-- CreateEnum
CREATE TYPE "PlanRequestStatus" AS ENUM ('pending', 'approved', 'declined', 'withdrawn');

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'expired';

-- AlterTable
ALTER TABLE "billing_settings" ADD COLUMN     "trial_days" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "trial_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trial_plan_id" UUID;

-- CreateTable
CREATE TABLE "plan_requests" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "requested_by_id" UUID NOT NULL,
    "message" VARCHAR(1000) NOT NULL,
    "status" "PlanRequestStatus" NOT NULL DEFAULT 'pending',
    "decided_by_id" UUID,
    "decided_at" TIMESTAMPTZ(6),
    "decision_note" VARCHAR(500),
    "subscription_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plan_requests_subscription_id_key" ON "plan_requests"("subscription_id");

-- CreateIndex
CREATE INDEX "plan_requests_status_created_at_idx" ON "plan_requests"("status", "created_at");

-- CreateIndex
CREATE INDEX "plan_requests_business_id_created_at_idx" ON "plan_requests"("business_id", "created_at");

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_trial_plan_id_fkey" FOREIGN KEY ("trial_plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_requests" ADD CONSTRAINT "plan_requests_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ── Rules ───────────────────────────────────────────────────────────────────
ALTER TABLE "billing_settings"
  ADD CONSTRAINT "chk_billing_settings_trial_days" CHECK ("trial_days" BETWEEN 1 AND 365);

-- Trials are subscriptions too: no price, no store, always with an end date.
ALTER TABLE "subscriptions" DROP CONSTRAINT "chk_subscriptions_provider",
  ADD CONSTRAINT "chk_subscriptions_provider" CHECK ("provider" IN ('paddle', 'google_play', 'app_store', 'manual', 'trial'));
ALTER TABLE "subscriptions" DROP CONSTRAINT "chk_subscriptions_source",
  ADD CONSTRAINT "chk_subscriptions_source" CHECK (
    ("provider" IN ('manual', 'trial') AND "price_id" IS NULL AND "channel" IS NULL)
    OR ("provider" NOT IN ('manual', 'trial') AND "channel" IS NOT NULL)
  ),
  ADD CONSTRAINT "chk_subscriptions_trial_end" CHECK ("provider" <> 'trial' OR "current_period_end" IS NOT NULL);
-- One trial per account, ever.
CREATE UNIQUE INDEX "subscriptions_one_trial_per_user" ON "subscriptions" ("user_id") WHERE "provider" = 'trial' AND "user_id" IS NOT NULL;
CREATE UNIQUE INDEX "subscriptions_one_trial_per_business" ON "subscriptions" ("business_id") WHERE "provider" = 'trial' AND "business_id" IS NOT NULL;

-- One open plan request per business.
CREATE UNIQUE INDEX "plan_requests_one_pending" ON "plan_requests" ("business_id") WHERE "status" = 'pending';
ALTER TABLE "plan_requests"
  ADD CONSTRAINT "chk_plan_requests_decision" CHECK (
    ("status" IN ('pending', 'withdrawn')) OR ("decided_at" IS NOT NULL AND "decided_by_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "chk_plan_requests_approved_grant" CHECK ("status" <> 'approved' OR "subscription_id" IS NOT NULL);

-- The trial plan, like the fallback plans, must belong to the settings' audience.
CREATE OR REPLACE FUNCTION billing_settings_check_audience() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT audience FROM plans WHERE id = NEW.default_plan_id) <> NEW.audience
     OR (SELECT audience FROM plans WHERE id = NEW.plan_when_disabled_id) <> NEW.audience
     OR (NEW.trial_plan_id IS NOT NULL AND (SELECT audience FROM plans WHERE id = NEW.trial_plan_id) <> NEW.audience) THEN
    RAISE EXCEPTION 'billing_settings plans must belong to audience %', NEW.audience
      USING ERRCODE = 'check_violation', CONSTRAINT = 'chk_billing_settings_audience';
  END IF;
  RETURN NEW;
END $$;

-- ── Catalog changes (editable afterwards) ───────────────────────────────────
UPDATE "plans" SET "code" = 'business_essential', "name" = 'Essential', "updated_at" = now() WHERE "code" = 'business_local';
UPDATE "plans" SET "code" = 'business_professional', "name" = 'Professional', "tagline" = 'For growing teams and multi-chair practices', "updated_at" = now() WHERE "code" = 'business_mid';
UPDATE "plans" SET "benefits" = '["Everything in Essential", "Up to 15 team logins and 25 bookable staff", "100 services, 30 photos", "Priority support"]', "updated_at" = now()
  WHERE "code" = 'business_professional';
UPDATE "plans" SET "benefits" = '["Everything in Professional", "Unlimited team logins and staff", "Unlimited services and photos", "Promote your business with ads", "Priority support"]', "updated_at" = now()
  WHERE "code" = 'business_enterprise';

-- A month of BUKU Plus for customers, a month of Professional for businesses.
UPDATE "billing_settings" SET "trial_plan_id" = (SELECT id FROM plans WHERE code = 'user_plus'), "updated_at" = now() WHERE "audience" = 'user';
UPDATE "billing_settings" SET "trial_plan_id" = (SELECT id FROM plans WHERE code = 'business_professional'), "updated_at" = now() WHERE "audience" = 'business';
