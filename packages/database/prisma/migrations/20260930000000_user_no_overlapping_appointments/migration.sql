-- A customer can never hold two active appointments that overlap in time —
-- not even at two different businesses. Like the staff/resource rules, this
-- is enforced by the database so no code path (or race) can bypass it.
-- '[)' half-open ranges: back-to-back appointments are allowed.
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_no_user_overlap"
  EXCLUDE USING gist ("user_id" WITH =, tstzrange("start_at", "end_at", '[)') WITH &&)
  WHERE ("status" IN ('pending', 'confirmed'));
