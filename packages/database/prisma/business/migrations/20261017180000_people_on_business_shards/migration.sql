-- One person's rows on a business shard (D3b): "download my data" and erasing an account (D-043)
-- find them in every business at once, through auth-service's cross-business role (DB-020).
--  • Appointments through their index: one unpartitioned row each, holding the partition key
--    (start_at) that leads straight to the appointment.
--  • Queue tickets: walk-ins added by the front desk have no person, so only the rest are indexed.
CREATE INDEX "appointment_index_user_id_idx" ON "appointment_index"("user_id");
CREATE INDEX "queue_tickets_user_id_idx" ON "queue_tickets" ("user_id", "session_date") WHERE "user_id" IS NOT NULL;
