-- A review is of one real visit (D-077, D3d): its appointment, at this business, by the same
-- customer, at the time the appointment has. Checked against the appointment index (an appointment
-- can't be pointed at with a foreign key: it is partitioned, DB-024), so not even a service bug
-- can attach a review to someone else's visit or another business.
CREATE FUNCTION "reviews_match_appointment"() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "appointment_index" i
    WHERE i."appointment_id" = NEW."appointment_id" AND i."business_id" = NEW."business_id"
      AND i."user_id" = NEW."user_id" AND i."start_at" = NEW."appointment_start_at"
  ) THEN
    RAISE EXCEPTION 'a review does not match its appointment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "reviews_match_appointment"
  BEFORE INSERT OR UPDATE OF "appointment_id", "business_id", "user_id", "appointment_start_at" ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "reviews_match_appointment"();
