-- 2.6 part 3: suggestions based on how people use BUKU (D-075): opt-in and caps.

-- AlterTable
ALTER TABLE "notification_preferences" ADD COLUMN     "suggestions" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suggestions_consent_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "suggestion_max_ignored" SMALLINT NOT NULL DEFAULT 3,
ADD COLUMN     "suggestion_max_per_30_days" SMALLINT NOT NULL DEFAULT 3,
ADD COLUMN     "suggestion_min_days" SMALLINT NOT NULL DEFAULT 7,
ADD COLUMN     "suggestions_enabled" BOOLEAN NOT NULL DEFAULT true;


ALTER TABLE "notification_settings"
  ADD CONSTRAINT "chk_notification_settings_suggestions" CHECK (
    "suggestion_min_days" BETWEEN 0 AND 365 AND "suggestion_max_per_30_days" BETWEEN 0 AND 30
    AND "suggestion_max_ignored" BETWEEN 0 AND 100);

-- Opting in to suggestions always records when.
ALTER TABLE "notification_preferences"
  ADD CONSTRAINT "chk_notification_preferences_suggestions_consent" CHECK (
    NOT "suggestions" OR "suggestions_consent_at" IS NOT NULL);
