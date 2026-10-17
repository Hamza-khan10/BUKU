-- The outbox (D-092): a service's cross-business role (buku_svc_<name>_all, DB-020) writes as the
-- service itself, so it may see and change that service's events too.
DROP POLICY "outbox_own_rows" ON "outbox_events";
CREATE POLICY "outbox_own_rows" ON "outbox_events"
  USING (current_user NOT LIKE 'buku\_svc\_%'
         OR "source" = substr(regexp_replace(current_user::text, '_all$', ''), 10) || '-service')
  WITH CHECK (current_user NOT LIKE 'buku\_svc\_%'
              OR "source" = substr(regexp_replace(current_user::text, '_all$', ''), 10) || '-service');
