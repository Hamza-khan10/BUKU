-- The directory database (docs/DATABASE.md §6, DB-011…DB-013): the shard registry, ID generator
-- leases and the database's own ID generator. Generated part first, then the rules Prisma can't express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "ids";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "registry";

-- CreateTable
CREATE TABLE "registry"."regions" (
    "region" SMALLINT NOT NULL,
    "code" VARCHAR(16) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "default_cluster_id" SMALLINT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("region")
);

-- CreateTable
CREATE TABLE "registry"."entities" (
    "entity" VARCHAR(32) NOT NULL,
    "description" TEXT NOT NULL,
    "default_row_limit" BIGINT NOT NULL,
    "database_pattern" VARCHAR(100) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("entity")
);

-- CreateTable
CREATE TABLE "registry"."clusters" (
    "cluster_id" SMALLINT NOT NULL,
    "region" SMALLINT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "dsn_secret" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clusters_pkey" PRIMARY KEY ("cluster_id")
);

-- CreateTable
CREATE TABLE "registry"."shards" (
    "entity" VARCHAR(32) NOT NULL,
    "region" SMALLINT NOT NULL,
    "shard_no" INTEGER NOT NULL,
    "min_id" BIGINT,
    "max_id" BIGINT,
    "last_id" BIGINT,
    "row_limit" BIGINT NOT NULL,
    "row_count" BIGINT NOT NULL DEFAULT 0,
    "status" VARCHAR(16) NOT NULL,
    "cluster_id" SMALLINT NOT NULL,
    "database_name" VARCHAR(63) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "opened_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "shards_pkey" PRIMARY KEY ("entity","region","shard_no")
);

-- CreateTable
CREATE TABLE "registry"."id_generators" (
    "generator_id" SMALLINT NOT NULL,
    "purpose" VARCHAR(16) NOT NULL,
    "leased_by" VARCHAR(200),
    "lease_expires" TIMESTAMPTZ(6),

    CONSTRAINT "id_generators_pkey" PRIMARY KEY ("generator_id")
);

-- CreateTable
CREATE TABLE "registry"."changes" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "db_role" VARCHAR(63) NOT NULL,
    "actor" VARCHAR(200),
    "table_name" VARCHAR(63) NOT NULL,
    "operation" VARCHAR(8) NOT NULL,
    "old_row" JSONB,
    "new_row" JSONB,

    CONSTRAINT "changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registry"."version" (
    "id" SMALLINT NOT NULL DEFAULT 1,
    "version" BIGINT NOT NULL DEFAULT 1,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registry"."alerts" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" VARCHAR(32) NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "region" SMALLINT NOT NULL,
    "shard_no" INTEGER NOT NULL,
    "detail" TEXT NOT NULL,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ids"."state" (
    "generator_id" SMALLINT NOT NULL,
    "last_ms" BIGINT NOT NULL,
    "last_seq" INTEGER NOT NULL,

    CONSTRAINT "state_pkey" PRIMARY KEY ("generator_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regions_code_key" ON "registry"."regions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "clusters_name_key" ON "registry"."clusters"("name");

-- CreateIndex
CREATE INDEX "shards_cluster_id_idx" ON "registry"."shards"("cluster_id");

-- CreateIndex
CREATE INDEX "shards_region_idx" ON "registry"."shards"("region");

-- CreateIndex
CREATE INDEX "id_generators_purpose_lease_expires_idx" ON "registry"."id_generators"("purpose", "lease_expires");

-- CreateIndex
CREATE INDEX "changes_at_idx" ON "registry"."changes"("at");

-- CreateIndex
CREATE INDEX "alerts_resolved_at_idx" ON "registry"."alerts"("resolved_at");

-- AddForeignKey
ALTER TABLE "registry"."regions" ADD CONSTRAINT "regions_default_cluster_id_fkey" FOREIGN KEY ("default_cluster_id") REFERENCES "registry"."clusters"("cluster_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry"."clusters" ADD CONSTRAINT "clusters_region_fkey" FOREIGN KEY ("region") REFERENCES "registry"."regions"("region") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry"."shards" ADD CONSTRAINT "shards_entity_fkey" FOREIGN KEY ("entity") REFERENCES "registry"."entities"("entity") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry"."shards" ADD CONSTRAINT "shards_region_fkey" FOREIGN KEY ("region") REFERENCES "registry"."regions"("region") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registry"."shards" ADD CONSTRAINT "shards_cluster_id_fkey" FOREIGN KEY ("cluster_id") REFERENCES "registry"."clusters"("cluster_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════ Rules Prisma can't express ═══════════════════════

ALTER TABLE "registry"."regions"
  ADD CONSTRAINT "regions_region_range" CHECK ("region" BETWEEN 0 AND 7),
  ADD CONSTRAINT "regions_code_format" CHECK ("code" ~ '^[a-z]{2,16}$');

-- Who may place new rows of a family (by database role); checked by registry.place().
ALTER TABLE "registry"."entities" ADD COLUMN "placed_by" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "registry"."entities"
  ADD CONSTRAINT "entities_name_format" CHECK ("entity" ~ '^[a-z][a-z_]{1,31}$'),
  ADD CONSTRAINT "entities_limit_positive" CHECK ("default_row_limit" > 0),
  ADD CONSTRAINT "entities_pattern_format" CHECK (
    "database_pattern" ~ '^[a-z0-9_{}]+$' AND "database_pattern" LIKE '%{shard}%'),
  -- Role names only (a list, maybe empty: then nobody may place this family).
  ADD CONSTRAINT "entities_placed_by_roles" CHECK (
    "placed_by" IS NOT NULL AND array_to_string("placed_by", ',') ~ '^([a-z_][a-z0-9_]{0,62}(,|$))*$');

ALTER TABLE "registry"."clusters"
  ADD CONSTRAINT "clusters_id_positive" CHECK ("cluster_id" > 0),
  ADD CONSTRAINT "clusters_status" CHECK ("status" IN ('active', 'draining', 'retired')),
  ADD CONSTRAINT "clusters_name_format" CHECK ("name" ~ '^[a-z0-9][a-z0-9-]{1,63}$'),
  -- The NAME of a secret (DATABASE_URL_PK_1), never a connection string.
  ADD CONSTRAINT "clusters_dsn_secret_is_a_name" CHECK ("dsn_secret" ~ '^[A-Z][A-Z0-9_]{1,127}$');

ALTER TABLE "registry"."shards"
  ADD CONSTRAINT "shards_status" CHECK ("status" IN ('ready', 'open', 'full', 'read_only', 'moving', 'retired')),
  ADD CONSTRAINT "shards_no_positive" CHECK ("shard_no" > 0),
  ADD CONSTRAINT "shards_limit_positive" CHECK ("row_limit" > 0),
  ADD CONSTRAINT "shards_count_non_negative" CHECK ("row_count" >= 0),
  ADD CONSTRAINT "shards_database_name" CHECK ("database_name" ~ '^[a-z][a-z0-9_]{0,62}$'),
  -- A 'ready' shard has no range yet; every other shard starts somewhere.
  ADD CONSTRAINT "shards_ready_has_no_range" CHECK (("status" = 'ready') = ("min_id" IS NULL)),
  ADD CONSTRAINT "shards_range_order" CHECK ("max_id" IS NULL OR "max_id" >= "min_id"),
  -- The highest ID placed so far lies inside the range (a shard closes exactly there).
  ADD CONSTRAINT "shards_last_id_in_range" CHECK ("last_id" IS NULL OR
    ("min_id" IS NOT NULL AND "last_id" >= "min_id" AND ("max_id" IS NULL OR "last_id" <= "max_id"))),
  ADD CONSTRAINT "shards_open_has_no_end" CHECK ("status" <> 'open' OR "max_id" IS NULL),
  ADD CONSTRAINT "shards_full_has_an_end" CHECK ("status" <> 'full' OR "max_id" IS NOT NULL);
-- One open shard per family and region; ranges never overlap (DB-011).
CREATE UNIQUE INDEX "shards_one_open" ON "registry"."shards" ("entity", "region") WHERE "status" = 'open';
ALTER TABLE "registry"."shards" ADD CONSTRAINT "shards_ranges_never_overlap"
  EXCLUDE USING gist ("entity" WITH =, "region" WITH =, int8range("min_id", "max_id", '[]') WITH &&)
  WHERE ("status" <> 'ready');

ALTER TABLE "registry"."id_generators"
  ADD CONSTRAINT "id_generators_range" CHECK ("generator_id" BETWEEN 0 AND 1023),
  ADD CONSTRAINT "id_generators_purpose" CHECK ("purpose" IN ('service', 'database')),
  ADD CONSTRAINT "id_generators_lease" CHECK ("leased_by" IS NULL OR "lease_expires" IS NOT NULL);
-- All 1,024 generators: in each region's block of 128, the last 8 are for databases' own inserts.
INSERT INTO "registry"."id_generators" ("generator_id", "purpose")
SELECT g, CASE WHEN (g & 127) >= 120 THEN 'database' ELSE 'service' END
FROM generate_series(0, 1023) AS g;

ALTER TABLE "registry"."version" ADD CONSTRAINT "version_one_row" CHECK ("id" = 1);
INSERT INTO "registry"."version" ("id", "version") VALUES (1, 1);

ALTER TABLE "registry"."alerts" ADD CONSTRAINT "alerts_kind" CHECK ("kind" IN ('no_ready_shard'));
CREATE UNIQUE INDEX "alerts_one_open_per_shard" ON "registry"."alerts" ("kind", "entity", "region", "shard_no")
  WHERE "resolved_at" IS NULL;

ALTER TABLE "ids"."state"
  ADD CONSTRAINT "state_generator_range" CHECK ("generator_id" BETWEEN 0 AND 1023),
  ADD CONSTRAINT "state_seq_range" CHECK ("last_seq" BETWEEN 0 AND 4095);

-- ═══════════════════════ The change log and the version ═══════════════════════

-- Every change to the layout, with the database role and (when the caller says) the person
-- behind it; and the version routers watch. Counting a placed row (row_count, last_id) is the
-- registry working, not a change, so it is neither logged nor versioned.
CREATE FUNCTION "registry"."log_change"() RETURNS trigger
LANGUAGE plpgsql SET search_path = registry, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'shards'
     AND (to_jsonb(NEW) - 'row_count' - 'last_id') = (to_jsonb(OLD) - 'row_count' - 'last_id') THEN
    RETURN NEW;
  END IF;
  INSERT INTO registry.changes (db_role, actor, table_name, operation, old_row, new_row)
  VALUES (session_user, nullif(current_setting('buku.actor', true), ''), TG_TABLE_NAME, TG_OP,
          CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
          CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END);
  UPDATE registry.version SET version = version + 1, changed_at = now() WHERE id = 1;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER "regions_log" AFTER INSERT OR UPDATE OR DELETE ON "registry"."regions"
  FOR EACH ROW EXECUTE FUNCTION "registry"."log_change"();
CREATE TRIGGER "entities_log" AFTER INSERT OR UPDATE OR DELETE ON "registry"."entities"
  FOR EACH ROW EXECUTE FUNCTION "registry"."log_change"();
CREATE TRIGGER "clusters_log" AFTER INSERT OR UPDATE OR DELETE ON "registry"."clusters"
  FOR EACH ROW EXECUTE FUNCTION "registry"."log_change"();
CREATE TRIGGER "shards_log" AFTER INSERT OR UPDATE OR DELETE ON "registry"."shards"
  FOR EACH ROW EXECUTE FUNCTION "registry"."log_change"();

-- ═══════════════════════ IDs (DB-002) ═══════════════════════
--  0 | 41 bits: ms since 2026-01-01T00:00:00Z | 10 bits: generator (top 3 = region) | 12 bits: sequence

-- The region an ID was made in.
CREATE FUNCTION "registry"."region_of"(p_id BIGINT) RETURNS SMALLINT
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$ SELECT ((p_id >> 19) & 7)::smallint $$;

-- The next ID from one generator, made inside the database (migrations, seeds, back-fills).
-- Serialised per generator by its row lock; when more than 4,096 are asked for in one
-- millisecond, the clock moves on by itself, so IDs stay unique and in order and never repeat
-- even if the server's clock steps back.
CREATE FUNCTION "ids"."next_id"(p_generator SMALLINT) RETURNS BIGINT
LANGUAGE plpgsql SET search_path = ids, pg_temp AS $$
DECLARE
  now_ms BIGINT := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint - 1767225600000;
  ms BIGINT;
  seq INTEGER;
BEGIN
  IF p_generator IS NULL OR p_generator NOT BETWEEN 0 AND 1023 THEN
    RAISE EXCEPTION 'generator must be 0..1023' USING ERRCODE = '22023';
  END IF;
  INSERT INTO ids.state AS s (generator_id, last_ms, last_seq) VALUES (p_generator, now_ms, 0)
  ON CONFLICT (generator_id) DO UPDATE SET
    last_ms = CASE WHEN EXCLUDED.last_ms > s.last_ms THEN EXCLUDED.last_ms
                   WHEN s.last_seq < 4095 THEN s.last_ms ELSE s.last_ms + 1 END,
    last_seq = CASE WHEN EXCLUDED.last_ms > s.last_ms THEN 0
                    WHEN s.last_seq < 4095 THEN s.last_seq + 1 ELSE 0 END
  RETURNING last_ms, last_seq INTO ms, seq;
  RETURN (ms << 22) | (p_generator::bigint << 12) | seq;
END $$;

-- An ID from this database's own generator (set per database: ALTER DATABASE … SET buku.generator_id).
CREATE FUNCTION "ids"."buku_id"() RETURNS BIGINT
LANGUAGE sql AS $$ SELECT ids.next_id(current_setting('buku.generator_id')::smallint) $$;

-- ═══════════════════════ Generator leases ═══════════════════════
-- A running service instance holds one generator at a time. A lease that isn't renewed expires;
-- an expired generator is handed out again only 30 seconds later, so an instance that froze can't
-- overlap its successor. (The instance stops making IDs itself the moment its lease runs out.)

CREATE FUNCTION "registry"."lease_generator"(p_instance TEXT, p_region SMALLINT, p_ttl_seconds INTEGER)
RETURNS TABLE (generator_id SMALLINT, lease_expires TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = registry, pg_temp AS $$
BEGIN
  IF p_instance IS NULL OR length(p_instance) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'instance name must be 1..200 characters' USING ERRCODE = '22023';
  END IF;
  IF p_ttl_seconds NOT BETWEEN 10 AND 600 THEN
    RAISE EXCEPTION 'lease must be 10..600 seconds' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE registry.id_generators g
     SET leased_by = p_instance, lease_expires = now() + make_interval(secs => p_ttl_seconds)
   WHERE g.generator_id = (
     SELECT c.generator_id FROM registry.id_generators c
      WHERE c.purpose = 'service' AND (c.generator_id >> 7) = p_region
        AND (c.lease_expires IS NULL OR c.lease_expires < now() - interval '30 seconds')
      ORDER BY c.lease_expires NULLS FIRST, c.generator_id
      LIMIT 1 FOR UPDATE SKIP LOCKED)
  RETURNING g.generator_id, g.lease_expires;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no free ID generator in region %', p_region USING ERRCODE = '53400';
  END IF;
END $$;

-- Keep a lease; NULL when it was lost (expired or taken), and then the instance must stop.
CREATE FUNCTION "registry"."renew_generator"(p_generator SMALLINT, p_instance TEXT, p_ttl_seconds INTEGER)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = registry, pg_temp AS $$
DECLARE expires TIMESTAMPTZ;
BEGIN
  IF p_ttl_seconds NOT BETWEEN 10 AND 600 THEN
    RAISE EXCEPTION 'lease must be 10..600 seconds' USING ERRCODE = '22023';
  END IF;
  UPDATE registry.id_generators
     SET lease_expires = now() + make_interval(secs => p_ttl_seconds)
   WHERE generator_id = p_generator AND leased_by = p_instance AND lease_expires > now()
  RETURNING lease_expires INTO expires;
  RETURN expires;
END $$;

-- Give a lease back on shutdown (reusable after the 30-second grace).
CREATE FUNCTION "registry"."release_generator"(p_generator SMALLINT, p_instance TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = registry, pg_temp AS $$
BEGIN
  UPDATE registry.id_generators SET leased_by = NULL, lease_expires = now()
   WHERE generator_id = p_generator AND leased_by = p_instance;
  RETURN FOUND;
END $$;

-- ═══════════════════════ Shards ═══════════════════════

-- The shard that holds an ID (for tools and tests; services use their cached copy).
CREATE FUNCTION "registry"."route"(p_entity TEXT, p_id BIGINT)
RETURNS TABLE (region SMALLINT, shard_no INTEGER, status TEXT, cluster_id SMALLINT, database_name TEXT)
LANGUAGE sql STABLE SET search_path = registry, pg_temp AS $$
  SELECT s.region, s.shard_no, s.status::text, s.cluster_id, s.database_name::text
  FROM registry.shards s
  WHERE s.entity = p_entity AND s.region = registry.region_of(p_id) AND s.status <> 'ready'
    AND s.min_id <= p_id AND (s.max_id IS NULL OR p_id <= s.max_id)
$$;

-- Add a shard that waits to be opened ('ready'): its database is created next to it (D2's
-- provisioning script); placement opens it when the current one fills (DB-011).
CREATE FUNCTION "registry"."add_shard"(p_entity TEXT, p_region SMALLINT, p_cluster SMALLINT DEFAULT NULL)
RETURNS "registry"."shards"
LANGUAGE plpgsql SET search_path = registry, pg_temp AS $$
DECLARE
  e registry.entities%ROWTYPE;
  r registry.regions%ROWTYPE;
  next_no INTEGER;
  row registry.shards%ROWTYPE;
BEGIN
  SELECT * INTO e FROM registry.entities WHERE entity = p_entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown shard family %', p_entity USING ERRCODE = '22023'; END IF;
  SELECT * INTO r FROM registry.regions WHERE region = p_region;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown region %', p_region USING ERRCODE = '22023'; END IF;
  IF coalesce(p_cluster, r.default_cluster_id) IS NULL THEN
    RAISE EXCEPTION 'region % has no default cluster; name one', r.code USING ERRCODE = '22023';
  END IF;
  -- Serialise numbering per family and region.
  PERFORM pg_advisory_xact_lock(hashtextextended('registry.shard_no:' || p_entity || ':' || p_region, 0));
  SELECT coalesce(max(s.shard_no), 0) + 1 INTO next_no FROM registry.shards s
   WHERE s.entity = p_entity AND s.region = p_region;
  INSERT INTO registry.shards (entity, region, shard_no, row_limit, status, cluster_id, database_name)
  VALUES (p_entity, p_region, next_no, e.default_row_limit, 'ready', coalesce(p_cluster, r.default_cluster_id),
          replace(replace(replace(e.database_pattern, '{entity}', p_entity), '{region}', r.code), '{shard}', next_no::text))
  RETURNING * INTO row;
  RETURN row;
END $$;

-- Place a new row of a family (a new person, a new business) by its ID: count it on the shard
-- whose range holds the ID, and when the open shard reaches its limit, close it at the highest ID
-- it has taken and open the next ready shard right after that. (Not at this ID: IDs from many
-- instances arrive slightly out of order, and closing at a late, lower one would move rows
-- already placed into the next shard's range.) With no ready shard, the open one keeps taking rows
-- (people are never turned away) and an alert is raised; it closes on the first placement after a
-- ready shard is added, and the alert is resolved. Rows are counted on the shard that holds their
-- ID even if it has just filled (an ID made a moment before the switch).
CREATE FUNCTION "registry"."place"(p_entity TEXT, p_id BIGINT)
RETURNS TABLE (region SMALLINT, shard_no INTEGER, cluster_id SMALLINT, database_name TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = registry, pg_temp AS $$
DECLARE
  v_region SMALLINT;
  e registry.entities%ROWTYPE;
  s registry.shards%ROWTYPE;
  nxt registry.shards%ROWTYPE;
  first_id BIGINT;
  located BOOLEAN := false;
BEGIN
  IF p_id IS NULL OR p_id <= 0 THEN RAISE EXCEPTION 'invalid ID' USING ERRCODE = '22023'; END IF;
  SELECT * INTO e FROM registry.entities WHERE entity = p_entity;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown shard family %', p_entity USING ERRCODE = '22023'; END IF;
  -- Only roles that exist count (a listed role may not have been created yet).
  IF NOT EXISTS (SELECT 1 FROM unnest(e.placed_by) AS r(name)
                 JOIN pg_catalog.pg_roles g ON g.rolname = r.name
                 WHERE pg_has_role(session_user, g.oid, 'MEMBER')) THEN
    RAISE EXCEPTION 'role % may not place %', session_user, p_entity USING ERRCODE = '42501';
  END IF;
  v_region := registry.region_of(p_id);

  -- Find the shard whose range holds the ID, and lock it. Each statement sees the latest committed
  -- registry, so when the shard this waited on filled meanwhile (and the ID now falls in the next
  -- one), looking again finds the right shard.
  FOR attempt IN 1..5 LOOP
    SELECT * INTO s FROM registry.shards x
     WHERE x.entity = p_entity AND x.region = v_region AND x.status <> 'ready'
       AND x.min_id <= p_id AND (x.max_id IS NULL OR p_id <= x.max_id)
     FOR UPDATE;
    IF FOUND THEN
      located := true;
      EXIT;
    END IF;
    -- Nothing holds it and nothing is open: the family's first row in this region (or its last
    -- shard filled with none ready). Open the next ready shard, starting just after the last
    -- closed range; one placement at a time does this, the others then find it open.
    PERFORM pg_advisory_xact_lock(hashtextextended('registry.open:' || p_entity || ':' || v_region, 0));
    CONTINUE WHEN EXISTS (SELECT 1 FROM registry.shards x
                          WHERE x.entity = p_entity AND x.region = v_region AND x.status = 'open');
    SELECT coalesce(max(x.max_id), 0) + 1 INTO first_id FROM registry.shards x
     WHERE x.entity = p_entity AND x.region = v_region AND x.status <> 'ready';
    IF p_id < first_id THEN
      RAISE EXCEPTION 'ID % is below every range of %', p_id, p_entity USING ERRCODE = 'P0002';
    END IF;
    SELECT * INTO nxt FROM registry.shards x
     WHERE x.entity = p_entity AND x.region = v_region AND x.status = 'ready'
     ORDER BY x.shard_no LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'no ready % shard to open in region %', p_entity, v_region USING ERRCODE = 'P0002';
    END IF;
    UPDATE registry.shards x SET status = 'open', min_id = first_id, opened_at = now()
     WHERE x.entity = nxt.entity AND x.region = nxt.region AND x.shard_no = nxt.shard_no
    RETURNING * INTO s;
    located := true;
    EXIT;
  END LOOP;
  IF NOT located THEN
    RAISE EXCEPTION 'no shard holds % % in region %', p_entity, p_id, v_region USING ERRCODE = 'P0002';
  END IF;

  IF s.status NOT IN ('open', 'full') THEN
    RAISE EXCEPTION 'shard % of % is %; try again shortly', s.shard_no, p_entity, s.status USING ERRCODE = '55006';
  END IF;

  UPDATE registry.shards x SET row_count = x.row_count + 1, last_id = greatest(x.last_id, p_id)
   WHERE x.entity = s.entity AND x.region = s.region AND x.shard_no = s.shard_no
  RETURNING * INTO s;

  IF s.status = 'open' AND s.row_count >= s.row_limit THEN
    SELECT * INTO nxt FROM registry.shards x
     WHERE x.entity = p_entity AND x.region = v_region AND x.status = 'ready'
     ORDER BY x.shard_no LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      UPDATE registry.shards x SET status = 'full', max_id = s.last_id, closed_at = now()
       WHERE x.entity = s.entity AND x.region = s.region AND x.shard_no = s.shard_no;
      UPDATE registry.shards x SET status = 'open', min_id = s.last_id + 1, opened_at = now()
       WHERE x.entity = nxt.entity AND x.region = nxt.region AND x.shard_no = nxt.shard_no;
      UPDATE registry.alerts a SET resolved_at = now()
       WHERE a.kind = 'no_ready_shard' AND a.entity = s.entity AND a.region = s.region
         AND a.shard_no = s.shard_no AND a.resolved_at IS NULL;
    ELSE
      INSERT INTO registry.alerts (kind, entity, region, shard_no, detail)
      VALUES ('no_ready_shard', p_entity, v_region, s.shard_no,
              format('shard %s reached its limit of %s with no ready shard to open', s.shard_no, s.row_limit))
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  RETURN QUERY SELECT s.region::smallint, s.shard_no, s.cluster_id::smallint, s.database_name::text;
END $$;

-- ═══════════════════════ Who may do what ═══════════════════════
-- Tables the migrator creates are writable by buku_app by default (template1's default
-- privileges). Not here: the registry changes only through its functions or an admin, so every
-- later directory migration that adds a table revokes the same way (a test checks). Exact grants
-- per service are applied by scripts/apply-access.ts (DIRECTORY_ACCESS).
REVOKE ALL ON SCHEMA "ids" FROM PUBLIC, buku_app;
REVOKE ALL ON ALL TABLES IN SCHEMA "registry", "ids" FROM PUBLIC, buku_app;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "registry", "ids" FROM PUBLIC, buku_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "registry", "ids" FROM PUBLIC, buku_app;
GRANT SELECT ON "registry"."regions", "registry"."entities", "registry"."clusters", "registry"."shards",
  "registry"."version" TO buku_app;
GRANT EXECUTE ON FUNCTION "registry"."route"(TEXT, BIGINT), "registry"."region_of"(BIGINT),
  "registry"."lease_generator"(TEXT, SMALLINT, INTEGER), "registry"."renew_generator"(SMALLINT, TEXT, INTEGER),
  "registry"."release_generator"(SMALLINT, TEXT), "registry"."place"(TEXT, BIGINT) TO buku_app;
