-- Branch answers for Enterprise from 10 branches (D-145): the early-access form asks 1 / 2-5 / 6-9 /
-- 10-20 / 21+ instead of 1 / 2-5 / 6-20 / 21+. '6-20' stays allowed: it's what earlier businesses
-- answered, and their answers are kept as they gave them.
--
-- SQLite can't change a CHECK in place, so the table is rebuilt: the same table, column for column,
-- with only the branches check widened; every row copied with its id, then the old table swapped
-- out and its indexes made again. Wrangler sends this file as one batch, which D1 runs as a single
-- transaction: it all applies, or none of it does. Applied before the website sends the new answers.

CREATE TABLE waitlist_next (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL CHECK (
                  length(email) BETWEEN 3 AND 254 AND email = lower(email)
                  AND email LIKE '%_@_%._%' AND email NOT GLOB '*[ ]*'),
  kind          TEXT NOT NULL CHECK (kind IN ('business', 'customer')),
  name          TEXT CHECK (name IS NULL OR length(name) BETWEEN 1 AND 120),
  business_name TEXT CHECK (business_name IS NULL OR length(business_name) BETWEEN 2 AND 160),
  business_type TEXT CHECK (business_type IS NULL OR length(business_type) BETWEEN 2 AND 80),
  branches      TEXT CHECK (branches IS NULL OR branches IN ('1', '2-5', '6-9', '10-20', '21+', '6-20')),
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

INSERT INTO waitlist_next (
  id, email, kind, name, business_name, business_type, branches, city, country, whatsapp,
  plan_interest, source, utm_source, utm_medium, utm_campaign, ip_hash, consent_at, created_at,
  confirmed_at)
SELECT
  id, email, kind, name, business_name, business_type, branches, city, country, whatsapp,
  plan_interest, source, utm_source, utm_medium, utm_campaign, ip_hash, consent_at, created_at,
  confirmed_at
FROM waitlist;

DROP TABLE waitlist;
ALTER TABLE waitlist_next RENAME TO waitlist;

CREATE INDEX IF NOT EXISTS waitlist_ip_recent ON waitlist (ip_hash, created_at) WHERE ip_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);
