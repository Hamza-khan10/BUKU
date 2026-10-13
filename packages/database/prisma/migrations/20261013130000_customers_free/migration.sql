-- Customers use BUKU for free, with no limit on bookings or queue joins (D-101). Charging them is
-- switched off, with no free trial to start; the billing service refuses to switch either back on.
-- The customer plans stay in the catalogue, unused (customer billing was never switched on, so
-- nobody had paid for one).
UPDATE "billing_settings"
SET "enabled" = false, "trial_enabled" = false, "updated_at" = now()
WHERE "audience" = 'user';
