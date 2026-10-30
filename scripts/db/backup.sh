#!/usr/bin/env bash
# A backup of the development cluster with pgBackRest (docs/DATABASE.md DB-030): full (default),
# diff or incr. The repository is encrypted; WAL reaches it continuously (archive_command), so any
# second since the oldest kept full backup can be restored (scripts/db/restore-drill.sh).
#
#   pnpm db:backup [full|diff|incr]
set -euo pipefail
cd "$(dirname "$0")/../.."
type="${1:-full}"
case "$type" in full | diff | incr) ;; *)
  echo "usage: pnpm db:backup [full|diff|incr]" >&2
  exit 2
  ;;
esac
COMPOSE=(docker compose -f docker-compose.dev.yml)
"${COMPOSE[@]}" exec -T -u postgres postgres pgbackrest --stanza=buku --type="$type" backup
"${COMPOSE[@]}" exec -T -u postgres postgres pgbackrest --stanza=buku info
