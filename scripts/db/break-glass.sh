#!/usr/bin/env bash
# Break-glass: a person's own, short-lived session on one database (docs/DATABASE.md DB-021, DB-022).
#
# Nobody has standing access to data. When a person must look, this makes a login role just for
# them and just for now:
#   - read-only (pg_read_all_data; --write adds pg_write_all_data), across every business on a
#     business shard (it opens the row-level security policies as the services' cross-business
#     roles do);
#   - every statement it runs written to the audit log (pgaudit.log = all, which only a superuser
#     can change), with who and why recorded on the role itself (its COMMENT is audited too);
#   - no password: it signs in only through the server's own socket, so only someone already on
#     the database host (the bastion, in production) can use it, and never over the network;
#   - one connection, statements stopped after 5 minutes, idle sessions after 15;
#   - dropped when the session ends, or when its time runs out (default 60 minutes, at most 60).
#     A role left behind by a crash is reported by `pnpm db:health` (break_glass).
#
#   pnpm db:break-glass --reason "Ticket OPS-12: booking 4410 shows twice" [--db buku_business_pk_1]
#   pnpm db:break-glass --reason "…" --db buku_directory -- -c "SELECT count(*) FROM registry.shards"
#
# Options: --db <database> (default buku_directory), --minutes <1-60>, --write. Anything after `--`
# goes to psql (a non-interactive query, for instance). Development: the cluster in
# docker-compose.dev.yml.
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f docker-compose.dev.yml)
DB=buku_directory MINUTES=60 WRITE=0 REASON=""
die() {
  echo "break-glass: $*" >&2
  exit 1
}
while (($#)); do
  case "$1" in
    --reason) REASON="${2:-}"; shift 2 ;;
    --db) DB="${2:-}"; shift 2 ;;
    --minutes) MINUTES="${2:-}"; shift 2 ;;
    --write) WRITE=1; shift ;;
    --) shift; break ;;
    *) die "unknown option $1 (see the top of scripts/db/break-glass.sh)" ;;
  esac
done
REASON=$(tr -d '\000-\037' <<<"$REASON")
((${#REASON} >= 10 && ${#REASON} <= 300)) || die '--reason "<why, 10 to 300 characters>" is required'
[[ "$DB" =~ ^[a-z][a-z0-9_]{0,62}$ ]] || die "--db must be a database name"
[[ "$MINUTES" =~ ^[0-9]+$ ]] && ((MINUTES >= 1 && MINUTES <= 60)) || die "--minutes must be 1 to 60"

# Who: the person at this terminal (their git identity, else their user name).
WHO=$(git config user.email 2>/dev/null || whoami)
SLUG=$(tr -c 'a-z0-9' '_' <<<"${WHO%%@*}" | tr 'A-Z' 'a-z' | cut -c1-20 | sed 's/_*$//')
ROLE="human_${SLUG:-person}_$(openssl rand -hex 3)"
UNTIL=$(date -u -d "+${MINUTES} minutes" '+%Y-%m-%dT%H:%M:%SZ')
admin() { "${COMPOSE[@]}" exec -T postgres psql -U buku_admin -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

[[ "$(admin -tAc "SELECT 1 FROM pg_database WHERE datname = '${DB}'" 2>/dev/null)" == 1 ]] || die "no database ${DB}"

close() {
  admin -v role="$ROLE" -v db="$DB" >/dev/null <<'SQL' || echo "break-glass: could not drop ${ROLE}: drop it by hand" >&2
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = :'role';
DROP OWNED BY :"role";
DROP ROLE :"role";
SQL
  echo "break-glass: ${ROLE} dropped" >&2
}

admin -v role="$ROLE" -v db="$DB" -v write="$WRITE" \
  -v note="break-glass until ${UNTIL} by ${WHO} on ${DB}$( ((WRITE)) && echo ' (write)'): ${REASON}" <<'SQL'
CREATE ROLE :"role" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 1;
COMMENT ON ROLE :"role" IS :'note';
GRANT CONNECT ON DATABASE :"db" TO :"role";
GRANT pg_read_all_data TO :"role";
GRANT buku_all_businesses TO :"role";
ALTER ROLE :"role" SET pgaudit.log = 'all';
ALTER ROLE :"role" SET pgaudit.log_relation = on;
ALTER ROLE :"role" SET statement_timeout = '5min';
ALTER ROLE :"role" SET idle_session_timeout = '15min';
\if :write
GRANT pg_write_all_data TO :"role";
\else
ALTER ROLE :"role" SET default_transaction_read_only = on;
\endif
SQL
trap close EXIT

{
  echo "break-glass: ${ROLE} on ${DB}, $( ((WRITE)) && echo 'read and write' || echo 'read-only'), until ${UNTIL}."
  echo "break-glass: every statement is written to the audit log, with your reason."
} >&2
TTY=(-T)
[[ -t 0 && -t 1 && $# -eq 0 ]] && TTY=()
timeout --foreground "${MINUTES}m" "${COMPOSE[@]}" exec "${TTY[@]}" postgres psql -U "$ROLE" -d "$DB" -v ON_ERROR_STOP=1 "$@"
