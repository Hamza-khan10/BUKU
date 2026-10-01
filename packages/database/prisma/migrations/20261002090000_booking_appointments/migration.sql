-- 2.3 part 2, appointments: the clean-up buffer blocks the employee, and
-- cancellations record why, whether they were late, and "book later".

-- CreateEnum
CREATE TYPE "CancelReasonCode" AS ENUM ('schedule_conflict', 'found_alternative', 'too_expensive', 'not_needed', 'illness', 'business_unavailable', 'declined', 'other');

-- AlterTable (blocked_until: added, back-filled, then required)
ALTER TABLE "appointments" ADD COLUMN     "blocked_until" TIMESTAMPTZ(6),
ADD COLUMN     "cancel_reason_code" "CancelReasonCode",
ADD COLUMN     "late_cancellation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "rebook_reminder_at" TIMESTAMPTZ(6);
UPDATE "appointments" SET "blocked_until" = "end_at";
ALTER TABLE "appointments" ALTER COLUMN "blocked_until" SET NOT NULL;

ALTER TABLE "appointments"
  -- The buffer comes after the appointment and is at most the 4 hours a service allows.
  ADD CONSTRAINT "chk_appointments_blocked_until" CHECK (
    "blocked_until" >= "end_at" AND "blocked_until" - "end_at" <= interval '4 hours'
  ),
  -- Only a cancellation can be late, carry a reason code, or ask for a rebooking reminder.
  ADD CONSTRAINT "chk_appointments_cancel_extras" CHECK (
    "status" = 'cancelled' OR (
      "late_cancellation" = false AND "cancel_reason_code" IS NULL AND "rebook_reminder_at" IS NULL
    )
  );

-- An employee is busy until the clean-up is done, not just until the customer leaves.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_staff_overlap";
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_staff_overlap"
  EXCLUDE USING gist ("staff_id" WITH =, tstzrange("start_at", "blocked_until", '[)') WITH &&)
  WHERE ("staff_id" IS NOT NULL AND "status" IN ('pending', 'confirmed'));
