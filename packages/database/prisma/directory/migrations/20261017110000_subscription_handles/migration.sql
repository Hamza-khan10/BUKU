-- A store subscription found from the store's own ID (docs/DATABASE.md DB-018). Paddle tells us
-- the business itself (custom_data, set by us); Google Play and the App Store send only their
-- purchase token or original transaction ID, so billing claims a handle when the purchase is
-- made and finds the business, and so its shard, when the store writes back. The key is the
-- first 16 bytes of the SHA-256 of the store's ID (tokens are long and of no fixed length).
INSERT INTO "lookup"."handle_kinds" ("kind", "name", "entity", "key_min", "key_max", "writers", "description") VALUES
  (103, 'business.subscription', 'business', 16, 16, ARRAY['buku_svc_billing'],
   'A Google Play or App Store subscription (hash of the store''s ID): which business it pays for');
