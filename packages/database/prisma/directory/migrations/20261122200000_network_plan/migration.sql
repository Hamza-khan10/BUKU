-- Network (D-146): Professional for every branch, for an owner with two to five branches. How many
-- businesses an owner may hold is business-service's setting (five; none on Enterprise, 3.7k), not
-- a plan limit, so this row carries Professional's limits and features unchanged.
--
-- Not for sale yet (is_public false), so the public plan listing stays as it is: like every plan,
-- it has no prices until billing's catalog step gives the launch prices (D-137). Operators can
-- already grant it. Professional's limits and features are copied as they stand now (an operator
-- may have edited them), falling back to the seeded values (20261017130000_reference). Ads stay
-- off (D-087). Running it again changes nothing.

INSERT INTO "reference"."plans" ("id", "sort_order", "is_public", "code", "audience", "name", "tagline", "benefits", "limits", "features")
SELECT
  9, 3, false, 'business_network', 'business', 'Network', 'For two to five branches',
  '["Everything in Professional, in every branch", "One account for all your branches", "Each branch with its own hours, team and queue"]',
  COALESCE(
    (SELECT "limits" FROM "reference"."plans" WHERE "code" = 'business_professional'),
    '{"photos": 30, "services": 100, "team_accounts": 15, "staff_profiles": 25}'
  ),
  COALESCE(
    (SELECT "features" FROM "reference"."plans" WHERE "code" = 'business_professional'),
    '{"ads": false, "queue": true, "staff_photos": true, "manual_approval": true, "priority_support": true}'
  )
ON CONFLICT DO NOTHING;

-- Network sorts between Professional (2) and Enterprise, which moves from 3 to 4: only if nobody
-- has reordered the plans since they were seeded.
UPDATE "reference"."plans" SET "sort_order" = 4
WHERE "code" = 'business_enterprise' AND "sort_order" = 3
  AND EXISTS (SELECT 1 FROM "reference"."plans" WHERE "code" = 'business_network' AND "sort_order" = 3);
