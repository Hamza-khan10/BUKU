-- 2.7 search (D-076): ranking figures, and service names made searchable.

-- CreateTable
CREATE TABLE "business_search_stats" (
    "business_id" UUID NOT NULL,
    "bookings_7d" INTEGER NOT NULL DEFAULT 0,
    "bookings_prev_7d" INTEGER NOT NULL DEFAULT 0,
    "queue_joins_7d" INTEGER NOT NULL DEFAULT 0,
    "kept_90d" INTEGER NOT NULL DEFAULT 0,
    "business_cancels_90d" INTEGER NOT NULL DEFAULT 0,
    "refreshed_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_search_stats_pkey" PRIMARY KEY ("business_id")
);

-- CreateIndex
CREATE INDEX "business_search_stats_bookings_7d_idx" ON "business_search_stats"("bookings_7d");

-- AddForeignKey
ALTER TABLE "business_search_stats" ADD CONSTRAINT "business_search_stats_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "business_search_stats"
  ADD CONSTRAINT "chk_business_search_stats_counts" CHECK (
    "bookings_7d" >= 0 AND "bookings_prev_7d" >= 0 AND "queue_joins_7d" >= 0
    AND "kept_90d" >= 0 AND "business_cancels_90d" >= 0);

-- One search document per business, always current: name (A), category and active service
-- names (B: "haircut" finds barbers), description (C), city (D). Recomputed by the existing
-- BEFORE trigger, which now also reads the category and services.
CREATE OR REPLACE FUNCTION "businesses_derive_columns"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."lat" IS NOT NULL AND NEW."lng" IS NOT NULL THEN
    NEW."location" := extensions.ST_SetSRID(extensions.ST_MakePoint(NEW."lng"::float8, NEW."lat"::float8), 4326)::extensions.geography;
  ELSE
    NEW."location" := NULL;
  END IF;
  NEW."search_vector" :=
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."name", '')), 'A') ||
    setweight(to_tsvector('english'::regconfig, coalesce((
      SELECT c."name" || ' ' || coalesce(p."name", '')
      FROM public."categories" c LEFT JOIN public."categories" p ON p."id" = c."parent_id"
      WHERE c."id" = NEW."category_id"), '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce((
      SELECT string_agg(s."name", ' ') FROM public."services" s
      WHERE s."business_id" = NEW."id" AND s."is_active"), '')), 'B') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."description", '')), 'C') ||
    setweight(to_tsvector('english'::regconfig, coalesce(NEW."city", '')), 'D');
  RETURN NEW;
END $$;

DROP TRIGGER "trg_businesses_derive_columns" ON "businesses";
CREATE TRIGGER "trg_businesses_derive_columns"
  BEFORE INSERT OR UPDATE OF "lat", "lng", "name", "description", "city", "category_id", "location", "search_vector"
  ON "businesses" FOR EACH ROW EXECUTE FUNCTION "businesses_derive_columns"();

-- A service added, renamed, switched on/off or removed: recompute its business's document
-- (touching search_vector fires the trigger above).
CREATE FUNCTION "services_refresh_business_search"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    UPDATE public."businesses" SET "search_vector" = NULL WHERE "id" = OLD."business_id";
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."business_id" IS DISTINCT FROM OLD."business_id") THEN
    UPDATE public."businesses" SET "search_vector" = NULL WHERE "id" = NEW."business_id";
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER "trg_services_refresh_business_search"
  AFTER INSERT OR DELETE OR UPDATE OF "name", "is_active", "business_id" ON "services"
  FOR EACH ROW EXECUTE FUNCTION "services_refresh_business_search"();

-- A category renamed or moved: recompute the documents of businesses in it (or its children).
CREATE FUNCTION "categories_refresh_business_search"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public."businesses" SET "search_vector" = NULL
  WHERE "category_id" = NEW."id"
     OR "category_id" IN (SELECT "id" FROM public."categories" WHERE "parent_id" = NEW."id");
  RETURN NULL;
END $$;
CREATE TRIGGER "trg_categories_refresh_business_search"
  AFTER UPDATE OF "name", "parent_id" ON "categories"
  FOR EACH ROW EXECUTE FUNCTION "categories_refresh_business_search"();

-- Rebuild every existing document.
UPDATE "businesses" SET "search_vector" = NULL;

-- Service-name suggestions as people type (prefix and typos).
CREATE INDEX "services_name_trgm_idx" ON "services" USING GIN ("name" extensions.gin_trgm_ops)
  WHERE "is_active";
