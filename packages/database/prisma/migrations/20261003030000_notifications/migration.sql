-- 2.6 notifications: WhatsApp channel, team-alert and WhatsApp preferences, and the device
-- each push went to (dead devices are switched off from Expo's receipts).

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'whatsapp';

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "push_business_alerts" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "whatsapp_updates" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "push_token_id" UUID;


-- A push record always says which device it went to; other channels never do.
ALTER TABLE "notifications"
  ADD CONSTRAINT "chk_notifications_push_token" CHECK ("push_token_id" IS NULL OR "channel" = 'push');
