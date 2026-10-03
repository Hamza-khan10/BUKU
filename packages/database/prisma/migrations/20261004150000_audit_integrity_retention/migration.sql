-- 2.10 SOC 2 review (D-080): the audit log is append-only for the app, and old
-- monthly partitions are dropped on a fixed schedule the app can't shorten.

-- ── Audit log: append-only ────────────────────────────────────────────────────
-- The app role writes entries but can never change or remove them (privileges),
-- and a trigger refuses it for any role (belt and braces). Only dropping a whole
-- expired month (drop_expired_partitions below) removes entries.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM buku_app;
DO $$
DECLARE p text;
BEGIN
  FOR p IN
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.audit_logs'::regclass
  LOOP
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON partitions.%I FROM buku_app', p);
  END LOOP;
END $$;

CREATE FUNCTION "audit_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit log entries can''t be changed or deleted' USING ERRCODE = '42501';
END $$;
CREATE TRIGGER "trg_audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "audit_logs_append_only"();

-- New months of the audit log get the same treatment when they are created.
CREATE OR REPLACE FUNCTION "ensure_monthly_partitions"(months_ahead int DEFAULT 3, months_back int DEFAULT 1)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  parent text;
  m date;
  first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date - make_interval(months => months_back);
  last_month  date := date_trunc('month', now() AT TIME ZONE 'UTC')::date + make_interval(months => months_ahead);
  part text;
  created int := 0;
BEGIN
  IF months_ahead NOT BETWEEN 0 AND 36 OR months_back NOT BETWEEN 0 AND 36 THEN
    RAISE EXCEPTION 'months_ahead/months_back must be between 0 and 36';
  END IF;
  FOREACH parent IN ARRAY ARRAY['audit_logs', 'notifications', 'ad_events'] LOOP
    m := first_month;
    WHILE m <= last_month LOOP
      part := format('%s_%s', parent, to_char(m, 'YYYY_MM'));
      IF to_regclass(format('partitions.%I', part)) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE partitions.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
          part, parent,
          (m::timestamp AT TIME ZONE 'UTC'),
          ((m + interval '1 month')::timestamp AT TIME ZONE 'UTC'));
        IF parent = 'audit_logs' THEN
          EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON partitions.%I FROM buku_app', part);
        END IF;
        created := created + 1;
      END IF;
      m := (m + interval '1 month')::date;
    END LOOP;
  END LOOP;
  RETURN created;
END $$;

-- ── Retention of the monthly tables ──────────────────────────────────────────
-- Months older than the schedule are dropped whole (fast, no bloat). The periods
-- are fixed HERE, not passed in, so the app role can run it but never shorten them:
--   audit_logs 24 months · notifications 13 months · ad_events 13 months.
CREATE FUNCTION "drop_expired_partitions"()
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  r record;
  keep_months int;
  cutoff date;
  dropped text[] := '{}';
BEGIN
  FOR r IN
    SELECT c.relname AS part, p.relname AS parent
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname IN ('audit_logs', 'notifications', 'ad_events')
      AND c.relname ~ '_[0-9]{4}_[0-9]{2}$'
  LOOP
    keep_months := CASE r.parent WHEN 'audit_logs' THEN 24 ELSE 13 END;
    cutoff := date_trunc('month', now() AT TIME ZONE 'UTC')::date - make_interval(months => keep_months);
    IF to_date(right(r.part, 7), 'YYYY_MM') < cutoff THEN
      EXECUTE format('DROP TABLE partitions.%I', r.part);
      dropped := dropped || r.part;
    END IF;
  END LOOP;
  RETURN dropped;
END $$;
REVOKE ALL ON FUNCTION "drop_expired_partitions"() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "drop_expired_partitions"() TO buku_app;
