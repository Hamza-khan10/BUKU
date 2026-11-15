-- Early access (D-134): people and businesses who want BUKU when it opens, in Cloudflare D1 (D-135).
-- Applied on every deploy (`pnpm cf:release`, Cloudflare's builds), or `pnpm --filter @buku/web cf:migrate --local`.
-- Only the website's own Worker reaches it (the DB binding); nothing else can read or write it.
-- The website checks every field first; these checks hold even if that ever slipped.

CREATE TABLE IF NOT EXISTS waitlist (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL CHECK (
                  length(email) BETWEEN 3 AND 254 AND email = lower(email)
                  AND email LIKE '%_@_%._%' AND email NOT GLOB '*[ ]*'),
  kind          TEXT NOT NULL CHECK (kind IN ('business', 'customer')),
  name          TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  business_name TEXT CHECK (business_name IS NULL OR length(business_name) BETWEEN 2 AND 160),
  business_type TEXT CHECK (business_type IS NULL OR length(business_type) BETWEEN 2 AND 80),
  branches      TEXT CHECK (branches IS NULL OR branches IN ('1', '2-5', '6-20', '21+')),
  city          TEXT NOT NULL CHECK (length(city) BETWEEN 2 AND 80),
  country       TEXT NOT NULL CHECK (country GLOB '[A-Z][A-Z]'),
  whatsapp      TEXT CHECK (whatsapp IS NULL OR (
                  whatsapp GLOB '+[1-9]*' AND length(whatsapp) BETWEEN 8 AND 16
                  AND substr(whatsapp, 2) NOT GLOB '*[^0-9]*')),
  plan_interest TEXT CHECK (plan_interest IS NULL OR plan_interest IN
                  ('starter', 'essential', 'professional', 'network', 'enterprise', 'not_sure')),
  source        TEXT CHECK (source IS NULL OR length(source) <= 80),
  utm_source    TEXT CHECK (utm_source IS NULL OR length(utm_source) <= 80),
  utm_medium    TEXT CHECK (utm_medium IS NULL OR length(utm_medium) <= 80),
  utm_campaign  TEXT CHECK (utm_campaign IS NULL OR length(utm_campaign) <= 80),
  -- A keyed hash of the visitor's address (never the address), to slow down repeats.
  ip_hash       TEXT CHECK (ip_hash IS NULL OR (length(ip_hash) = 64 AND ip_hash NOT GLOB '*[^0-9a-f]*')),
  consent_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  confirmed_at  TEXT,
  UNIQUE (email, kind),
  -- A business tells us who it is; someone who books needs only an email and a city.
  CHECK (kind = 'customer' OR (name IS NOT NULL AND business_name IS NOT NULL AND business_type IS NOT NULL
         AND branches IS NOT NULL AND plan_interest IS NOT NULL))
) STRICT;

CREATE INDEX IF NOT EXISTS waitlist_ip_recent ON waitlist (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);
