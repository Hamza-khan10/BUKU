-- 2.4 queue: per-business queue settings, walk-ins, remote joins, alert
-- tracking, and ONE live ticket per customer across all queues (D-038).

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN     "joined_remotely" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "last_alerted_ahead" INTEGER,
ADD COLUMN     "walk_in_name" VARCHAR(100);

-- CreateTable
CREATE TABLE "queue_settings" (
    "business_id" UUID NOT NULL,
    "remote_join_radius_meters" INTEGER NOT NULL DEFAULT 5000,
    "max_queue_size" INTEGER NOT NULL DEFAULT 200,
    "grace_period_seconds" INTEGER NOT NULL DEFAULT 300,
    "ticket_prefix" VARCHAR(3) NOT NULL DEFAULT 'A',
    "avg_service_seconds" INTEGER NOT NULL DEFAULT 300,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "queue_settings_pkey" PRIMARY KEY ("business_id")
);

-- AddForeignKey
ALTER TABLE "queue_settings" ADD CONSTRAINT "queue_settings_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "queue_settings"
  ADD CONSTRAINT "chk_queue_settings_radius" CHECK ("remote_join_radius_meters" BETWEEN 100 AND 100000),
  ADD CONSTRAINT "chk_queue_settings_size" CHECK ("max_queue_size" BETWEEN 1 AND 10000),
  ADD CONSTRAINT "chk_queue_settings_grace" CHECK ("grace_period_seconds" BETWEEN 0 AND 3600),
  ADD CONSTRAINT "chk_queue_settings_prefix" CHECK ("ticket_prefix" ~ '^[A-Z]{1,3}$'),
  ADD CONSTRAINT "chk_queue_settings_avg" CHECK ("avg_service_seconds" BETWEEN 30 AND 14400);

ALTER TABLE "queue_entries"
  -- A walk-in has a name to call out but no account; an account holder needs no walk-in name.
  ADD CONSTRAINT "chk_queue_entries_walk_in" CHECK ("user_id" IS NULL OR "walk_in_name" IS NULL),
  ADD CONSTRAINT "chk_queue_entries_alerted" CHECK ("last_alerted_ahead" IS NULL OR "last_alerted_ahead" >= 0);

-- Existing data: keep each customer's newest live ticket, the rest have left.
UPDATE "queue_entries" e SET "status" = 'left', "left_at" = now()
WHERE e."user_id" IS NOT NULL AND e."status" IN ('waiting', 'called', 'serving')
  AND EXISTS (
    SELECT 1 FROM "queue_entries" newer
    WHERE newer."user_id" = e."user_id" AND newer."status" IN ('waiting', 'called', 'serving')
      AND newer."joined_at" > e."joined_at"
  );

-- One live ticket per customer in ANY queue (was: per queue).
DROP INDEX "queue_entries_one_active_per_user";
CREATE UNIQUE INDEX "queue_entries_one_active_per_user"
  ON "queue_entries" ("user_id")
  WHERE "user_id" IS NOT NULL AND "status" IN ('waiting', 'called', 'serving');

-- Queue options now live in queue_settings; a business has a queue when it opens one.
UPDATE "businesses" SET "settings" = "settings" - 'queueEnabled';
