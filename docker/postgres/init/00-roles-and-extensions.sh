#!/usr/bin/env bash
# Runs ONCE, on first start of an empty data directory, as the superuser.
#
# Least-privilege roles:
#   POSTGRES_USER (superuser)  → only for this script and emergency ops.
#   buku_migrator              → owns the schema; runs `prisma migrate`. DDL allowed.
#   buku_app                   → what services connect as. Data only (SELECT/INSERT/
#                                UPDATE/DELETE). Cannot CREATE/ALTER/DROP anything,
#                                so even a SQL-injection bug cannot drop a table.
#
# Extensions live in their own `extensions` schema so Prisma (which manages
# `public`) never sees PostGIS's internal tables and tries to "fix" them.
#
# The same setup is applied to template1, so every database created later —
# the integration-test DB and Prisma's temporary "shadow" DB used by
# `prisma migrate dev` — inherits extensions and privileges automatically,
# without giving the migrator superuser rights.
set -euo pipefail

: "${POSTGRES_DB:?}" "${BUKU_MIGRATOR_PASSWORD:?}" "${BUKU_APP_PASSWORD:?}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set migrator_pw="$BUKU_MIGRATOR_PASSWORD" --set app_pw="$BUKU_APP_PASSWORD" <<-'SQL'
  -- CREATEDB lets `prisma migrate dev` create its throwaway shadow database.
  CREATE ROLE buku_migrator LOGIN CREATEDB PASSWORD :'migrator_pw';
  CREATE ROLE buku_app      LOGIN          PASSWORD :'app_pw';

  -- Both roles resolve PostGIS/pgvector types without schema-qualifying them.
  ALTER ROLE buku_migrator SET search_path = public, extensions;
  ALTER ROLE buku_app      SET search_path = public, extensions;

  -- Safety nets for the application role.
  ALTER ROLE buku_app SET statement_timeout = '15s';
  ALTER ROLE buku_app SET idle_in_transaction_session_timeout = '30s';
  ALTER ROLE buku_app SET lock_timeout = '5s';
SQL

prepare_database() {
  local db="$1"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$db" <<-'SQL'
    CREATE SCHEMA IF NOT EXISTS extensions;
    GRANT USAGE ON SCHEMA extensions TO PUBLIC;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pgcrypto    SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS pg_trgm     SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS btree_gist  SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS postgis     SCHEMA extensions;
    CREATE EXTENSION IF NOT EXISTS vector      SCHEMA extensions;

    ALTER SCHEMA public OWNER TO buku_migrator;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO buku_app;

    -- Everything the migrator creates later — in any schema it creates
    -- (public, ai, partitions) — is usable, but not alterable, by the app.
    ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator GRANT USAGE ON SCHEMAS TO buku_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator
      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO buku_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator
      GRANT USAGE, SELECT ON SEQUENCES TO buku_app;
    ALTER DEFAULT PRIVILEGES FOR ROLE buku_migrator
      GRANT EXECUTE ON FUNCTIONS TO buku_app;
SQL
}

prepare_database template1
prepare_database "$POSTGRES_DB"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-SQL
  ALTER DATABASE "$POSTGRES_DB" OWNER TO buku_migrator;
  REVOKE ALL ON DATABASE "$POSTGRES_DB" FROM PUBLIC;
  GRANT CONNECT, TEMPORARY ON DATABASE "$POSTGRES_DB" TO buku_migrator, buku_app;

  -- Integration tests get their own database so they can never touch dev data.
  CREATE DATABASE buku_test OWNER buku_migrator;
  REVOKE ALL ON DATABASE buku_test FROM PUBLIC;
  GRANT CONNECT, TEMPORARY ON DATABASE buku_test TO buku_migrator, buku_app;
SQL

echo "BUKU: roles (buku_migrator, buku_app), extensions and buku_test database initialised."
