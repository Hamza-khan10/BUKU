-- How reliably a person shows up (D-035, D-078, D3d), kept on their own shard: one row per
-- appointment or queue ticket that ended in a visit, a no-show or a late cancellation, at any
-- business. Businesses see a label made from the last 12 months; reading it is one query on the
-- person's shard, however many businesses they have been to. Kept by booking-service (and
-- queue-service for queue tickets); rows older than 13 months are swept.
CREATE TABLE "user_visit_outcomes" (
    "user_id" BIGINT NOT NULL,
    "ref_id" BIGINT NOT NULL,
    "business_id" BIGINT NOT NULL,
    "happened_at" TIMESTAMPTZ(6) NOT NULL,
    "kind" VARCHAR(12) NOT NULL,
    "source" VARCHAR(12) NOT NULL,

    CONSTRAINT "user_visit_outcomes_pkey" PRIMARY KEY ("user_id","ref_id")
);

CREATE INDEX "user_visit_outcomes_user_id_happened_at_idx" ON "user_visit_outcomes"("user_id", "happened_at");
-- The sweeper's way in: rows arrive in time order.
CREATE INDEX "user_visit_outcomes_happened_at_brin" ON "user_visit_outcomes" USING BRIN ("happened_at");

ALTER TABLE "user_visit_outcomes" ADD CONSTRAINT "user_visit_outcomes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_visit_outcomes"
  ADD CONSTRAINT "user_visit_outcomes_kind" CHECK ("kind" IN ('visit', 'no_show', 'late_cancel')),
  ADD CONSTRAINT "user_visit_outcomes_source" CHECK ("source" IN ('appointment', 'queue'));

GRANT SELECT, INSERT, UPDATE, DELETE ON "user_visit_outcomes" TO buku_app;
