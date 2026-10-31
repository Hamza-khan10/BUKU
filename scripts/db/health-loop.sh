#!/usr/bin/env bash
# The database's health checks every minute, for Prometheus (D-127). The monitoring sidecar runs
# this; node_exporter serves the file it writes (its textfile collector), and the alert rules read
# it. The file is written whole each time — a temporary file, then a rename — so a scrape never
# reads half of one. The checks themselves are scripts/db/health.sh, connecting directly.
set -uo pipefail
out=${BUKU_HEALTH_OUT:-/metrics/buku_db.prom}
every=${BUKU_HEALTH_EVERY:-60}
while true; do
  BUKU_HEALTH_DIRECT=1 bash "$(dirname "$0")/health.sh" --prometheus > "$out.tmp" 2>/dev/null
  mv -f "$out.tmp" "$out"
  sleep "$every"
done
