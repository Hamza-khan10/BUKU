-- 2.3 part 1, booking catalog & schedules: service categories, booking settings
-- (owned by booking-service), and staff profiles without the Phase 1 e-mail
-- invites (replaced by employee accounts, D-034). Working hours and time off
-- can only point at an employee of the same business (composite keys).

-- CreateEnum
CREATE TYPE "ConfirmationMode" AS ENUM ('automatic', 'manual');

-- DropForeignKey
ALTER TABLE "availability_exceptions" DROP CONSTRAINT "availability_exceptions_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "availability_rules" DROP CONSTRAINT "availability_rules_staff_id_fkey";

-- DropIndex
DROP INDEX "staff_invite_token_hash_key";

-- AlterTable
ALTER TABLE "services" DROP COLUMN "group_name",
ADD COLUMN     "category_id" UUID;

-- AlterTable
ALTER TABLE "staff" DROP COLUMN "invite_accepted",
DROP COLUMN "invite_email_encrypted",
DROP COLUMN "invite_expires_at",
DROP COLUMN "invite_token_hash",
DROP COLUMN "role";

-- DropEnum
DROP TYPE "StaffRole";

-- CreateTable
CREATE TABLE "service_categories" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_settings" (
    "business_id" UUID NOT NULL,
    "confirmation_mode" "ConfirmationMode" NOT NULL DEFAULT 'automatic',
    "booking_horizon_days" INTEGER NOT NULL DEFAULT 365,
    "max_future_bookings_per_customer" INTEGER NOT NULL DEFAULT 3,
    "cancellation_window_hours" INTEGER NOT NULL DEFAULT 12,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 60,
    "slot_step_minutes" INTEGER NOT NULL DEFAULT 15,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_business_id_name_key" ON "service_categories"("business_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "service_categories_id_business_id_key" ON "service_categories"("id", "business_id");

-- CreateIndex
CREATE INDEX "services_category_id_idx" ON "services"("category_id");

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_category_id_business_id_fkey" FOREIGN KEY ("category_id", "business_id") REFERENCES "service_categories"("id", "business_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_categories" ADD CONSTRAINT "service_categories_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_settings" ADD CONSTRAINT "booking_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "service_categories"
  ADD CONSTRAINT "chk_service_categories_name" CHECK (length(btrim("name")) > 0);

ALTER TABLE "booking_settings"
  ADD CONSTRAINT "chk_booking_settings_horizon" CHECK ("booking_horizon_days" BETWEEN 1 AND 1825),
  ADD CONSTRAINT "chk_booking_settings_max_future" CHECK ("max_future_bookings_per_customer" BETWEEN 1 AND 20),
  ADD CONSTRAINT "chk_booking_settings_cancellation" CHECK ("cancellation_window_hours" BETWEEN 0 AND 168),
  ADD CONSTRAINT "chk_booking_settings_notice" CHECK ("min_notice_minutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "chk_booking_settings_step" CHECK ("slot_step_minutes" IN (5, 10, 15, 20, 30, 60));

-- Booking options now live in booking_settings; the old JSON keys are dropped.
UPDATE "businesses" SET "settings" = "settings" - 'autoConfirm' - 'cancellationHours' - 'minAdvanceHours' - 'maxAdvanceDays';
