-- Each service publishes only its own events (D-092): the outbox row says which
-- service wrote it, and that service's relay alone publishes it. Rows written
-- before this carry their writer in the envelope already.
ALTER TABLE "outbox_events" ADD COLUMN "source" VARCHAR(50);
UPDATE "outbox_events" SET "source" = COALESCE("payload"->>'source', 'unknown');
ALTER TABLE "outbox_events" ALTER COLUMN "source" SET NOT NULL;

CREATE INDEX "outbox_events_source_published_at_created_at_idx"
  ON "outbox_events"("source", "published_at", "created_at");
