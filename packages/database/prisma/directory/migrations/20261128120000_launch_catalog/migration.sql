-- The launch catalog (D-137, D-146): the plans and prices the pricing page shows, so checkout
-- charges what the page says. Until now the catalog held v1's prices (Essential $24.99,
-- Professional $49.99, Enterprise $99.99), Network had none, and Starter had no walk-in queue.
--
--  1. v1's three business prices stop being sold. Archived, never deleted: anyone already paying
--     one keeps it (the catalog's rule). Only rows still as v1 seeded them: an operator's price is
--     left alone.
--  2. Each paid plan gets its launch prices on the web: rupees for Pakistan, dollars everywhere
--     else, a month and a year (a year costs ten months). Per branch, without tax, like v1's.
--     A price is added only where the plan has no live price yet for that currency and period,
--     so a price an operator already set is never doubled.
--  3. Network goes on sale (it was hidden while it had no price). Its two-branch minimum is
--     checked at checkout (billing-service).
--  4. Enterprise gets no price: it's priced for each chain and asked for through BUKU (D-146).
--  5. Starter gets the walk-in queue, BUKU's way in for barbers and clinics (D-137). Its other
--     limits stay.
--
-- The store's ids (Paddle) are linked per price from the console when payments are set up.
-- Running it again changes nothing.

UPDATE "reference"."plan_prices"
SET "archived_at" = now()
WHERE "archived_at" IS NULL
  AND "channel" = 'web' AND "currency" = 'USD' AND "interval" = 'month'
  AND ("id", "amount_minor") IN ((1, 2499), (2, 4999), (3, 9999));

INSERT INTO "reference"."plan_prices" ("id", "plan_id", "amount_minor", "trial_days", "tax_inclusive", "channel", "currency", "interval")
SELECT v."id", p."id", v."amount_minor", 0, false, 'web', v."currency", v."interval"
FROM (VALUES
  (7,  'business_essential',    'PKR', 'month',  249900),
  (8,  'business_essential',    'PKR', 'year',  2499000),
  (9,  'business_essential',    'USD', 'month',    1500),
  (10, 'business_essential',    'USD', 'year',    15000),
  (11, 'business_professional', 'PKR', 'month',  599900),
  (12, 'business_professional', 'PKR', 'year',  5999000),
  (13, 'business_professional', 'USD', 'month',    3500),
  (14, 'business_professional', 'USD', 'year',    35000),
  (15, 'business_network',      'PKR', 'month',  499900),
  (16, 'business_network',      'PKR', 'year',  4999000),
  (17, 'business_network',      'USD', 'month',    2900),
  (18, 'business_network',      'USD', 'year',    29000)
) AS v ("id", "code", "currency", "interval", "amount_minor")
JOIN "reference"."plans" p ON p."code" = v."code"
WHERE NOT EXISTS (
  SELECT 1 FROM "reference"."plan_prices" x
  WHERE x."plan_id" = p."id" AND x."channel" = 'web' AND x."currency" = v."currency"
    AND x."interval" = v."interval" AND x."archived_at" IS NULL
)
ON CONFLICT ("id") DO NOTHING;

UPDATE "reference"."plans" SET "is_public" = true, "updated_at" = now()
WHERE "code" = 'business_network' AND "is_public" = false;

UPDATE "reference"."plans"
SET "features" = jsonb_set("features", '{queue}', 'true'), "updated_at" = now()
WHERE "code" = 'business_free' AND "features" ->> 'queue' = 'false';
