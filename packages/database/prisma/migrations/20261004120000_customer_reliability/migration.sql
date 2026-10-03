-- 2.8 part 2: customer reliability can hold bookings for approval (D-078).

-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "approval_below_show_up_percent" SMALLINT;


ALTER TABLE "booking_settings"
  ADD CONSTRAINT "chk_booking_settings_approval_below" CHECK (
    "approval_below_show_up_percent" IS NULL OR "approval_below_show_up_percent" BETWEEN 50 AND 99);
