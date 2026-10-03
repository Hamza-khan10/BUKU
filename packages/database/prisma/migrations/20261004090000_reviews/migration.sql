-- 2.8 reputation part 1: reviews (D-077).

-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "edited_at" TIMESTAMPTZ(6),
ADD COLUMN     "flagged_at" TIMESTAMPTZ(6),
ADD COLUMN     "flagged_by_id" UUID,
ADD COLUMN     "hidden_at" TIMESTAMPTZ(6),
ADD COLUMN     "hidden_reason" VARCHAR(300),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "reviews_is_flagged_flagged_at_idx" ON "reviews"("is_flagged", "flagged_at");


-- A review is about the reviewer's own visit at that business: the database refuses any
-- other combination, whatever the application sends.
CREATE FUNCTION "reviews_match_appointment"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public."appointments" a
    WHERE a."id" = NEW."appointment_id" AND a."business_id" = NEW."business_id" AND a."user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'review does not match its appointment' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "trg_reviews_match_appointment"
  BEFORE INSERT OR UPDATE OF "appointment_id", "business_id", "user_id" ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION "reviews_match_appointment"();

ALTER TABLE "reviews"
  ADD CONSTRAINT "chk_reviews_comment_length" CHECK (char_length("comment") <= 2000),
  ADD CONSTRAINT "chk_reviews_response_length" CHECK (char_length("owner_response") <= 1000),
  ADD CONSTRAINT "chk_reviews_response_time" CHECK (("owner_response" IS NULL) = ("owner_responded_at" IS NULL)),
  ADD CONSTRAINT "chk_reviews_flag" CHECK (NOT "is_flagged" OR "flagged_at" IS NOT NULL),
  ADD CONSTRAINT "chk_reviews_hidden" CHECK ("is_visible" OR "hidden_at" IS NOT NULL);

CREATE TRIGGER "trg_reviews_updated_at" BEFORE UPDATE ON "reviews"
  FOR EACH ROW EXECUTE FUNCTION public."set_updated_at"();
