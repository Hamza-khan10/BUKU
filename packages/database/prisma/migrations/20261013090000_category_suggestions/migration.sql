-- Kinds of business that owners add when BUKU doesn't list theirs (D-098).
--  * name_key: the name reduced to what it means (lower case, "&" read as "and", letters and
--    numbers only, one plural "s" dropped from a longer word); unique, so two categories that
--    mean the same can't exist, even when two owners add one at the same moment. The app
--    computes it (`categoryKey` in @buku/validation); existing rows are filled in here with the
--    same rule (their names are plain English letters).
--  * pending: added by an owner and not yet reviewed: usable by businesses, but kept out of the
--    public category list until BUKU has looked at it.
--  * suggested_by_id: who added it.
ALTER TABLE "categories"
  ADD COLUMN "name_key" VARCHAR(120),
  ADD COLUMN "pending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suggested_by_id" UUID;

UPDATE "categories"
SET "name_key" = CASE
    WHEN length(k) > 3 AND right(k, 1) = 's' THEN left(k, -1)
    ELSE k
  END
FROM (
  SELECT "id" AS cid, regexp_replace(lower(replace("name", '&', 'and')), '[^a-z0-9]', '', 'g') AS k
  FROM "categories"
) AS keys
WHERE "categories"."id" = keys.cid AND keys.k <> '';

CREATE UNIQUE INDEX "categories_name_key_key" ON "categories"("name_key");
