-- Global handles (docs/DATABASE.md DB-018): what a person or business is found by before its shard
-- is known, unique across every shard. Generated part first, then the rules Prisma can't express.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "lookup";

-- CreateTable
CREATE TABLE "lookup"."handle_kinds" (
    "kind" SMALLINT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "entity" VARCHAR(32) NOT NULL,
    "key_min" SMALLINT NOT NULL,
    "key_max" SMALLINT NOT NULL,
    "writers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "description" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handle_kinds_pkey" PRIMARY KEY ("kind")
);

-- CreateTable: split by a hash of the key into 16 parts from the start, so it never has to be
-- rebuilt to be split later (hundreds of millions of rows: two or three per person).
CREATE TABLE "lookup"."handles" (
    "owner_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" SMALLINT NOT NULL,
    "key" BYTEA NOT NULL,

    CONSTRAINT "handles_pkey" PRIMARY KEY ("kind","key")
) PARTITION BY HASH ("key");
DO $$ BEGIN
  FOR i IN 0..15 LOOP
    EXECUTE format('CREATE TABLE "lookup".%I PARTITION OF "lookup"."handles" FOR VALUES WITH (MODULUS 16, REMAINDER %s)',
                   'handles_p' || lpad(i::text, 2, '0'), i);
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "handle_kinds_name_key" ON "lookup"."handle_kinds"("name");

-- CreateIndex
CREATE INDEX "handles_owner_id_idx" ON "lookup"."handles"("owner_id");

-- AddForeignKey
ALTER TABLE "lookup"."handles" ADD CONSTRAINT "handles_kind_fkey" FOREIGN KEY ("kind") REFERENCES "lookup"."handle_kinds"("kind") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══════════════════════ Rules Prisma can't express ═══════════════════════

ALTER TABLE "lookup"."handle_kinds"
  ADD CONSTRAINT "handle_kinds_name_format" CHECK ("name" ~ '^[a-z]+\.[a-z_]{1,30}$'),
  ADD CONSTRAINT "handle_kinds_entity_format" CHECK ("entity" ~ '^[a-z][a-z_]{1,31}$'),
  ADD CONSTRAINT "handle_kinds_name_starts_with_entity" CHECK ("name" LIKE "entity" || '.%'),
  ADD CONSTRAINT "handle_kinds_key_length" CHECK ("key_min" >= 1 AND "key_max" >= "key_min" AND "key_max" <= 200),
  ADD CONSTRAINT "handle_kinds_writers_roles" CHECK (
    "writers" IS NOT NULL AND array_to_string("writers", ',') ~ '^([a-z_][a-z0-9_]{0,62}(,|$))*$');
ALTER TABLE "lookup"."handles"
  ADD CONSTRAINT "handles_owner_positive" CHECK ("owner_id" > 0),
  ADD CONSTRAINT "handles_key_length" CHECK (octet_length("key") BETWEEN 1 AND 200);

-- The kinds the services use today. Keys are bytes: a 16-byte keyed blind index (HMAC-SHA-256,
-- DB-008) for anything personal, so this table holds no email, phone or account ID in the clear;
-- the 12 ASCII bytes of a public ID; a slug's bytes; for an employee's sign-in, the business's ID
-- (8 bytes, big-endian) followed by the username. A new kind is one row.
INSERT INTO "lookup"."handle_kinds" ("kind", "name", "entity", "key_min", "key_max", "writers", "description") VALUES
  (1,   'user.email',          'user',     16, 16,  ARRAY['buku_svc_auth'],                      'A verified email address (blind index): sign-in and one account per address'),
  (2,   'user.phone',          'user',     16, 16,  ARRAY['buku_svc_auth'],                      'A verified phone number (blind index)'),
  (3,   'user.google',         'user',     16, 16,  ARRAY['buku_svc_auth'],                      'A Google account''s subject (blind index): Sign in with Google'),
  (4,   'user.apple',          'user',     16, 16,  ARRAY['buku_svc_auth'],                      'An Apple account''s subject (blind index): Sign in with Apple'),
  (5,   'user.public_id',      'user',     12, 12,  ARRAY['buku_svc_auth'],                      'A person''s public ID'),
  (6,   'user.employee_login', 'user',     9,  48,  ARRAY['buku_svc_auth', 'buku_svc_business'], 'An employee account''s sign-in: business ID (8 bytes) + username (D-034)'),
  (7,   'user.whatsapp',       'user',     16, 16,  ARRAY['buku_svc_notification'],              'A linked WhatsApp number (blind index): who an incoming message is from'),
  (8,   'user.push_token',     'user',     16, 16,  ARRAY['buku_svc_auth'],                      'A device''s push token (blind index): a device belongs to one person at a time'),
  (101, 'business.public_id',  'business', 12, 12,  ARRAY['buku_svc_business'],                  'A business''s public ID'),
  (102, 'business.slug',       'business', 1,  100, ARRAY['buku_svc_business'],                  'A business''s address on the website (/b/<slug>)');

-- Changes to the kinds are logged and versioned like the rest of the layout (DB-017).
CREATE TRIGGER "handle_kinds_log" AFTER INSERT OR UPDATE OR DELETE ON "lookup"."handle_kinds"
  FOR EACH ROW EXECUTE FUNCTION "registry"."log_change"();

-- ═══════════════════════ Reading and writing handles ═══════════════════════
-- Only through these functions: they check the caller may write the kind, and the key's length.

-- Whether the session's role may write a kind (only roles that exist count).
CREATE FUNCTION "lookup"."may_write"(p_writers TEXT[]) RETURNS BOOLEAN
LANGUAGE sql STABLE SET search_path = lookup, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM unnest(p_writers) AS r(name)
                 JOIN pg_catalog.pg_roles g ON g.rolname = r.name
                 WHERE pg_has_role(session_user, g.oid, 'MEMBER'))
$$;

-- The kind, checked: it exists, the caller may write it, the key fits.
CREATE FUNCTION "lookup"."writable_kind"(p_kind TEXT, p_key BYTEA) RETURNS "lookup"."handle_kinds"
LANGUAGE plpgsql STABLE SET search_path = lookup, pg_temp AS $$
DECLARE k lookup.handle_kinds%ROWTYPE;
BEGIN
  SELECT * INTO k FROM lookup.handle_kinds WHERE name = p_kind;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown handle kind %', p_kind USING ERRCODE = '22023'; END IF;
  IF NOT lookup.may_write(k.writers) THEN
    RAISE EXCEPTION 'role % may not write % handles', session_user, p_kind USING ERRCODE = '42501';
  END IF;
  IF p_key IS NOT NULL AND octet_length(p_key) NOT BETWEEN k.key_min AND k.key_max THEN
    RAISE EXCEPTION '% keys are % to % bytes', p_kind, k.key_min, k.key_max USING ERRCODE = '22023';
  END IF;
  RETURN k;
END $$;

-- Claim a handle for an owner. claimed: the handle is now the owner's (it was free, or already
-- theirs, or taken over). previous_owner: who had it (NULL when it was free). Taking over is for
-- what moves between people by design (a device's push token); everything else is refused when
-- someone else has it (an email already in use).
CREATE FUNCTION "lookup"."claim"(p_kind TEXT, p_key BYTEA, p_owner BIGINT, p_take_over BOOLEAN DEFAULT false)
RETURNS TABLE (claimed BOOLEAN, previous_owner BIGINT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lookup, pg_temp AS $$
DECLARE
  k lookup.handle_kinds%ROWTYPE;
  prev BIGINT;
BEGIN
  IF p_key IS NULL OR p_owner IS NULL OR p_owner <= 0 THEN
    RAISE EXCEPTION 'a handle needs a key and an owner' USING ERRCODE = '22023';
  END IF;
  k := lookup.writable_kind(p_kind, p_key);
  -- Free: take it. Taken: look at who has it (it may be released meanwhile: try again).
  FOR attempt IN 1..3 LOOP
    INSERT INTO lookup.handles (owner_id, kind, key) VALUES (p_owner, k.kind, p_key)
    ON CONFLICT (kind, key) DO NOTHING;
    IF FOUND THEN
      RETURN QUERY SELECT true, NULL::bigint;
      RETURN;
    END IF;
    SELECT h.owner_id INTO prev FROM lookup.handles h WHERE h.kind = k.kind AND h.key = p_key FOR UPDATE;
    CONTINUE WHEN NOT FOUND;
    IF prev = p_owner THEN
      RETURN QUERY SELECT true, prev;
    ELSIF p_take_over THEN
      UPDATE lookup.handles h SET owner_id = p_owner, created_at = now() WHERE h.kind = k.kind AND h.key = p_key;
      RETURN QUERY SELECT true, prev;
    ELSE
      RETURN QUERY SELECT false, prev;
    END IF;
    RETURN;
  END LOOP;
  RAISE EXCEPTION 'the % handle kept changing; try again', p_kind USING ERRCODE = '40001';
END $$;

-- Give a handle back (only its owner's). True when it was theirs and is now free.
CREATE FUNCTION "lookup"."release"(p_kind TEXT, p_key BYTEA, p_owner BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lookup, pg_temp AS $$
DECLARE k lookup.handle_kinds%ROWTYPE;
BEGIN
  k := lookup.writable_kind(p_kind, p_key);
  DELETE FROM lookup.handles h WHERE h.kind = k.kind AND h.key = p_key AND h.owner_id = p_owner;
  RETURN FOUND;
END $$;

-- Give back every handle of one owner that the caller may write (an account erased). Returns how many.
CREATE FUNCTION "lookup"."release_all"(p_entity TEXT, p_owner BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = lookup, pg_temp AS $$
DECLARE n INTEGER;
BEGIN
  DELETE FROM lookup.handles h USING lookup.handle_kinds k
   WHERE h.owner_id = p_owner AND k.kind = h.kind AND k.entity = p_entity AND lookup.may_write(k.writers);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- Who a handle belongs to (NULL when nobody). Then its shard: the router, by that ID.
CREATE FUNCTION "lookup"."find"(p_kind TEXT, p_key BYTEA) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = lookup, pg_temp AS $$
  SELECT h.owner_id FROM lookup.handles h JOIN lookup.handle_kinds k ON k.kind = h.kind
  WHERE k.name = p_kind AND h.key = p_key
$$;

-- ═══════════════════════ Who may do what ═══════════════════════
-- Like the registry: never written directly; the functions above are the only way. Exact grants
-- per service: scripts/apply-access.ts (DIRECTORY_ACCESS).
REVOKE ALL ON ALL TABLES IN SCHEMA "lookup" FROM PUBLIC, buku_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "lookup" FROM PUBLIC, buku_app;
GRANT USAGE ON SCHEMA "lookup" TO buku_app;
GRANT SELECT ON "lookup"."handle_kinds" TO buku_app;
GRANT EXECUTE ON FUNCTION "lookup"."claim"(TEXT, BYTEA, BIGINT, BOOLEAN), "lookup"."release"(TEXT, BYTEA, BIGINT),
  "lookup"."release_all"(TEXT, BIGINT), "lookup"."find"(TEXT, BYTEA) TO buku_app;
