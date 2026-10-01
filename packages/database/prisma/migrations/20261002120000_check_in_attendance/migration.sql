-- 2.3 part 3: customers checking in (receipt, code or list), and employees
-- clocking in and out of their shifts.

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "checked_in_at" TIMESTAMPTZ(6),
ADD COLUMN     "checked_in_by_id" UUID;

-- AlterTable
ALTER TABLE "booking_settings" ADD COLUMN     "no_show_grace_minutes" INTEGER NOT NULL DEFAULT 15;

-- CreateTable
CREATE TABLE "staff_attendance" (
    "id" UUID NOT NULL,
    "business_id" UUID NOT NULL,
    "staff_id" UUID NOT NULL,
    "check_in_at" TIMESTAMPTZ(6) NOT NULL,
    "check_out_at" TIMESTAMPTZ(6),
    "recorded_by_id" UUID,
    "note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "staff_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_attendance_business_id_check_in_at_idx" ON "staff_attendance"("business_id", "check_in_at");

-- CreateIndex
CREATE INDEX "staff_attendance_staff_id_check_in_at_idx" ON "staff_attendance"("staff_id", "check_in_at");

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_staff_id_business_id_fkey" FOREIGN KEY ("staff_id", "business_id") REFERENCES "staff"("id", "business_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_attendance" ADD CONSTRAINT "staff_attendance_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_checked_in_by_id_fkey" FOREIGN KEY ("checked_in_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only a live or finished visit can have an arrival time (never a no-show or cancellation).
ALTER TABLE "appointments"
  ADD CONSTRAINT "chk_appointments_check_in" CHECK ("checked_in_at" IS NULL OR "status" IN ('confirmed', 'completed'));

ALTER TABLE "booking_settings"
  ADD CONSTRAINT "chk_booking_settings_no_show_grace" CHECK ("no_show_grace_minutes" BETWEEN 0 AND 240);

ALTER TABLE "staff_attendance"
  ADD CONSTRAINT "chk_staff_attendance_order" CHECK ("check_out_at" IS NULL OR "check_out_at" > "check_in_at"),
  ADD CONSTRAINT "chk_staff_attendance_length" CHECK ("check_out_at" IS NULL OR "check_out_at" - "check_in_at" <= interval '24 hours');

-- At most one open shift per person, even if two devices clock in at the same moment.
CREATE UNIQUE INDEX "staff_attendance_one_open_shift" ON "staff_attendance" ("staff_id") WHERE "check_out_at" IS NULL;
