-- 2.6 part 2: email and WhatsApp channels, timed reminders (D-073, D-074).

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "email_business_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "email_reminders" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "whatsapp_pricing" VARCHAR(20);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_paid_types" VARCHAR(50)[] DEFAULT ARRAY[]::VARCHAR(50)[],
    "whatsapp_monthly_budget_cents" INTEGER NOT NULL DEFAULT 0,
    "whatsapp_message_cost_cents" DECIMAL(8,4) NOT NULL DEFAULT 4,
    "whatsapp_free_window_per_month" INTEGER NOT NULL DEFAULT 1000,
    "reminder_24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder_2h" BOOLEAN NOT NULL DEFAULT true,
    "quiet_start_hour" SMALLINT NOT NULL DEFAULT 21,
    "quiet_end_hour" SMALLINT NOT NULL DEFAULT 9,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_contacts" (
    "user_id" UUID NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_hash" CHAR(64) NOT NULL,
    "linked_at" TIMESTAMPTZ(6) NOT NULL,
    "last_inbound_at" TIMESTAMPTZ(6),
    "opted_out_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "whatsapp_contacts_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "notification_marks" (
    "key" VARCHAR(200) NOT NULL,
    "user_id" UUID,
    "kind" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_marks_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_contacts_phone_hash_key" ON "whatsapp_contacts"("phone_hash");

-- CreateIndex
CREATE INDEX "notification_marks_user_id_kind_created_at_idx" ON "notification_marks"("user_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "notification_marks_created_at_idx" ON "notification_marks"("created_at");

-- AddForeignKey
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_marks" ADD CONSTRAINT "notification_marks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The settings are one row, always present; values stay sensible whatever an admin types.
ALTER TABLE "notification_settings"
  ADD CONSTRAINT "chk_notification_settings_single" CHECK ("id" = 1),
  ADD CONSTRAINT "chk_notification_settings_hours" CHECK (
    "quiet_start_hour" BETWEEN 0 AND 23 AND "quiet_end_hour" BETWEEN 0 AND 23),
  ADD CONSTRAINT "chk_notification_settings_whatsapp_money" CHECK (
    "whatsapp_monthly_budget_cents" >= 0 AND "whatsapp_message_cost_cents" >= 0
    AND "whatsapp_free_window_per_month" >= 0);
INSERT INTO "notification_settings" ("id", "updated_at") VALUES (1, now());

-- Only WhatsApp records say how they were priced.
ALTER TABLE "notifications"
  ADD CONSTRAINT "chk_notifications_whatsapp_pricing" CHECK (
    "whatsapp_pricing" IS NULL OR ("channel" = 'whatsapp' AND "whatsapp_pricing" IN ('window', 'template')));

-- WhatsApp delivery receipts find their message by Meta's id.
CREATE INDEX "notifications_external_id_idx" ON "notifications" ("external_id") WHERE "external_id" IS NOT NULL;

-- "Book again" reminders: the few appointments that asked for one.
CREATE INDEX "appointments_rebook_reminder_at_idx" ON "appointments" ("rebook_reminder_at")
  WHERE "rebook_reminder_at" IS NOT NULL;
