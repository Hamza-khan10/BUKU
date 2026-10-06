-- Groundwork for each service signing in as its own role, allowed only what it
-- needs (D-092). The roles and their grants are applied by packages/database
-- scripts/apply-access.ts (it needs to create roles); this migration only makes
-- the schema ready for them.

-- 1. Triggers that keep other services' columns in step run as their owner, so
--    the service whose change fires them needs no write access to those tables:
--    a service's name changing refreshes its business's search text, a review
--    refreshes its business's rating, a category rename refreshes its businesses.
ALTER FUNCTION "services_refresh_business_search"() SECURITY DEFINER SET search_path = public, extensions;
ALTER FUNCTION "categories_refresh_business_search"() SECURITY DEFINER SET search_path = public, extensions;
ALTER FUNCTION "recalc_business_rating"(uuid) SECURITY DEFINER SET search_path = public, extensions;
REVOKE ALL ON FUNCTION "recalc_business_rating"(uuid) FROM PUBLIC;

-- 2. The daily retention of rows (D-080), with its periods fixed HERE: the job
--    that runs it can delete only what is past its time, never shorten it. One
--    batch per call; the caller repeats while a batch comes back full.
CREATE FUNCTION "delete_expired_rows"(batch int DEFAULT 5000)
  RETURNS TABLE (processed_events bigint, outbox_events bigint, sessions bigint)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  p bigint; o bigint; s bigint;
BEGIN
  IF batch < 1 OR batch > 50000 THEN RAISE EXCEPTION 'batch out of range'; END IF;
  -- Processed-event markers (idempotency): 120 days; Kafka keeps at most 90.
  DELETE FROM processed_events WHERE ctid IN (
    SELECT ctid FROM processed_events WHERE processed_at < now() - interval '120 days' LIMIT batch);
  GET DIAGNOSTICS p = ROW_COUNT;
  -- Published outbox events: 7 days after publishing (they are in Kafka).
  DELETE FROM outbox_events WHERE ctid IN (
    SELECT ctid FROM outbox_events WHERE published_at < now() - interval '7 days' LIMIT batch);
  GET DIAGNOSTICS o = ROW_COUNT;
  -- Sign-in sessions: 30 days after they expire.
  DELETE FROM refresh_tokens WHERE ctid IN (
    SELECT ctid FROM refresh_tokens WHERE expires_at < now() - interval '30 days' LIMIT batch);
  GET DIAGNOSTICS s = ROW_COUNT;
  RETURN QUERY SELECT p, o, s;
END $$;
REVOKE ALL ON FUNCTION "delete_expired_rows"(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "delete_expired_rows"(int) TO buku_app;

-- 3. The outbox is shared, but each service may see and change only the events
--    it wrote. Service roles are named buku_svc_<name> and write
--    source = '<name>-service'; other roles (the migrator, the tests' buku_app)
--    are not limited by this policy.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outbox_own_rows" ON "outbox_events"
  USING (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service')
  WITH CHECK (current_user NOT LIKE 'buku\_svc\_%' OR "source" = substr(current_user, 10) || '-service');
