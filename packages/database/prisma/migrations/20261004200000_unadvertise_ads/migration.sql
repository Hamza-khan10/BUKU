-- The ads service isn't built yet (deferred), so no plan may promise it (D-087).
-- Removes the sentence from Enterprise's benefits only while it's still there as
-- first written; an admin's own wording is left alone. Order is kept.
UPDATE "plans"
SET "benefits" = (
      SELECT COALESCE(jsonb_agg(e.b ORDER BY e.i), '[]'::jsonb)
      FROM jsonb_array_elements("benefits") WITH ORDINALITY AS e(b, i)
      WHERE e.b <> '"Promote your business with ads"'::jsonb
    ),
    "updated_at" = now()
WHERE "code" = 'business_enterprise'
  AND "benefits" @> '["Promote your business with ads"]'::jsonb;
