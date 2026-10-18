-- A person's queue ticket is found on its business's shard by its ID and its session's date (the
-- tickets' partition key, DB-024), so that is what this row keeps (D3e). The row is the person's
-- current or latest ticket: one at a time across every business; a new join replaces it once that
-- ticket is no longer live.
ALTER TABLE "user_active_tickets" RENAME COLUMN "ticket_created_at" TO "ticket_session_date";
ALTER TABLE "user_active_tickets" ALTER COLUMN "ticket_session_date" TYPE DATE;
