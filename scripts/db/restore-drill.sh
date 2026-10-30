#!/usr/bin/env bash
# The restore drill (docs/DATABASE.md DB-034): restores are tested, not assumed.
#
#  1. Every backup and WAL file in the repository is checked (pgbackrest verify); without a backup
#     yet, a full one is taken.
#  2. At a moment T, a marker row is written and the rows people create are counted in every
#     database of the cluster (the directory, the catalog, each shard). Then the marker is deleted
#     (the kind of mistake point-in-time recovery exists for) and the WAL is archived.
#  3. The latest backup is restored to a scratch server — the same image, an empty volume, the
#     repository read-only — and brought to T. It never archives, replicates or runs jobs.
#  4. Checks: the marker is back, and every count matches the one taken at T.
#
# Development only (it reads the repository on this machine). Exit code 0 only if every check
# passes. CI runs it on every pull request.
#
#   pnpm db:restore-drill
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f docker-compose.dev.yml)
RUN="drill-$(date +%s)-$RANDOM"
SCRATCH="buku-restore-${RUN}"
FAILED=0
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
bad() {
  printf '  \033[31m✘\033[0m %s\n' "$*"
  FAILED=1
}
# One value from the live server (as the administrator, on its own socket).
live() { "${COMPOSE[@]}" exec -T postgres psql -U buku_admin -d "${2:-postgres}" -v ON_ERROR_STOP=1 -tAc "$1"; }
# One value from the scratch server.
scratch() { docker exec "$SCRATCH" psql -U buku_admin -d "${2:-postgres}" -v ON_ERROR_STOP=1 -tAc "$1"; }
backrest() { "${COMPOSE[@]}" exec -T -u postgres postgres pgbackrest --stanza=buku "$@"; }

# The repository's passphrase, for the scratch server's own pgBackRest (never printed).
PGBACKREST_REPO1_CIPHER_PASS=$(grep -E '^BUKU_BACKUP_CIPHER_PASS=' .env | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//')
[[ -n "$PGBACKREST_REPO1_CIPHER_PASS" ]] || {
  echo "BUKU_BACKUP_CIPHER_PASS is not set: run pnpm bootstrap" >&2
  exit 1
}
export PGBACKREST_REPO1_CIPHER_PASS
PG_CONTAINER=$("${COMPOSE[@]}" ps -q postgres)
[[ -n "$PG_CONTAINER" ]] || {
  echo "postgres isn't running: pnpm dev" >&2
  exit 1
}
REPO=$(docker inspect "$PG_CONTAINER" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/pgbackrest"}}{{.Name}}{{end}}{{end}}')
IMAGE=$(docker inspect "$PG_CONTAINER" --format '{{.Config.Image}}')

cleanup() {
  docker rm -f "$SCRATCH" >/dev/null 2>&1 || true
  docker volume rm "$SCRATCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Restore drill ${RUN}"

# ── 1. The repository ────────────────────────────────────────────────────────
if ! backrest info --output=json | grep -q '"backup":\[{'; then
  echo "  no backup yet: taking a full one"
  backrest --type=full backup >/dev/null
fi
if backrest verify >/dev/null 2>&1; then ok "every backup and WAL file in the repository checks out"; else bad "pgbackrest verify found a problem"; fi

# ── 2. The moment to come back to ────────────────────────────────────────────
# Rows people create (background jobs — leases, statistics, the outbox — change others all the time).
DATABASES=$(live "SELECT string_agg(datname, ' ' ORDER BY datname) FROM pg_database WHERE datname = 'buku_directory' OR datname = 'buku_catalog' OR datname ~ '^buku_(user|business)_[a-z]+_[0-9]+$'")
count_sql() {
  case "$1" in
    buku_directory) echo "SELECT 'shards=' || (SELECT count(*) FROM registry.shards) || ' handles=' || (SELECT count(*) FROM lookup.handles)" ;;
    buku_catalog) echo "SELECT 'businesses=' || (SELECT count(*) FROM catalog.businesses)" ;;
    buku_user_*) echo "SELECT 'users=' || (SELECT count(*) FROM users) || ' visits=' || (SELECT count(*) FROM user_appointments)" ;;
    buku_business_*) echo "SELECT 'businesses=' || (SELECT count(*) FROM businesses) || ' services=' || (SELECT count(*) FROM services) || ' appointments=' || (SELECT count(*) FROM appointments) || ' reviews=' || (SELECT count(*) FROM reviews)" ;;
  esac
}
live "CREATE TABLE IF NOT EXISTS public.restore_drill (id text PRIMARY KEY, written_at timestamptz NOT NULL DEFAULT now())" >/dev/null
MARKER="$RUN"
live "INSERT INTO public.restore_drill (id) VALUES ('${MARKER}')" >/dev/null
declare -A AT_T
for db in $DATABASES; do AT_T[$db]=$(live "$(count_sql "$db")" "$db"); done
TARGET=$(live "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")
sleep 1
# The mistake: the marker is deleted after T.
live "DELETE FROM public.restore_drill WHERE id = '${MARKER}'" >/dev/null
WAL=$(live "SELECT pg_walfile_name(pg_switch_wal())")
for _ in $(seq 1 60); do
  [[ "$(live "SELECT last_archived_wal >= '${WAL}' FROM pg_stat_archiver")" == "t" ]] && break
  sleep 1
done
if [[ "$(live "SELECT last_archived_wal >= '${WAL}' FROM pg_stat_archiver")" == "t" ]]; then
  ok "T = ${TARGET}: marker written, $(wc -w <<< "$DATABASES") databases counted; then deleted and archived"
else
  bad "the WAL after T didn't reach the repository within a minute"
  exit 1
fi

# ── 3. Restore to a scratch server, at T ─────────────────────────────────────
docker volume create "$SCRATCH" >/dev/null
docker run --rm --user postgres -e PGBACKREST_REPO1_CIPHER_PASS \
  -v "${REPO}:/var/lib/pgbackrest:ro" -v "${SCRATCH}:/var/lib/postgresql/data" "$IMAGE" \
  pgbackrest --stanza=buku --type=time "--target=${TARGET}" --target-action=promote restore >/dev/null
# The same limits as the cluster it came from (recovery requires them), nothing published, nothing
# replicated, no scheduled jobs.
docker run -d --name "$SCRATCH" -e PGBACKREST_REPO1_CIPHER_PASS \
  -v "${REPO}:/var/lib/pgbackrest:ro" -v "${SCRATCH}:/var/lib/postgresql/data" "$IMAGE" \
  postgres -c archive_mode=off -c max_connections=150 -c max_worker_processes=32 -c max_wal_senders=32 \
  -c max_replication_slots=32 -c max_logical_replication_workers=0 -c wal_level=logical \
  -c shared_preload_libraries=pg_stat_statements,pgaudit >/dev/null
for _ in $(seq 1 120); do
  [[ "$(docker exec "$SCRATCH" psql -U buku_admin -d postgres -tAc 'SELECT NOT pg_is_in_recovery()' 2>/dev/null)" == "t" ]] && break
  sleep 1
done
if [[ "$(scratch 'SELECT NOT pg_is_in_recovery()')" == "t" ]]; then
  ok "the latest backup restored to a scratch server and brought to T"
else
  bad "the scratch server didn't finish recovering within two minutes"
  docker logs --tail 20 "$SCRATCH"
  exit 1
fi

# ── 4. Checks ────────────────────────────────────────────────────────────────
if [[ "$(scratch "SELECT count(*) FROM public.restore_drill WHERE id = '${MARKER}'")" == "1" ]]; then
  ok "point in time: the row deleted after T is back"
else
  bad "point in time: the marker written before T is missing"
fi
for db in $DATABASES; do
  restored=$(scratch "$(count_sql "$db")" "$db")
  if [[ "$restored" == "${AT_T[$db]}" ]]; then ok "${db}: ${restored}"; else bad "${db}: at T ${AT_T[$db]}, restored ${restored}"; fi
done

live "DROP TABLE public.restore_drill" >/dev/null
if [[ "$FAILED" == "0" ]]; then
  printf '\n\033[32mPASSED\033[0m — restored to %s, every check matches\n' "$TARGET"
else
  printf '\n\033[31mFAILED\033[0m — see above\n'
fi
exit "$FAILED"
