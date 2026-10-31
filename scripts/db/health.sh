#!/usr/bin/env bash
# Database health (docs/DATABASE.md §14, D4c): the checks that say a cluster is safe to run on.
#
#   archiving           every WAL file reaches the backup repository (DB-030)
#   backup_age          the latest backup is recent
#   replication_slots   no slot is abandoned (an unread slot keeps WAL until the disk fills)
#   slot_retained_wal   how much WAL the slots hold back
#   reference_copies    every reference copy's subscription is running (DB-015)
#   partition_coverage  every partitioned table has partitions ahead of now (DB-018)
#   default_partitions  no row fell outside the partitions, into a `_default` one
#   scheduled_jobs      no pg_cron job (partition upkeep) failed in the last day
#   connections         room left under max_connections
#   long_transactions   no transaction has been open for more than five minutes
#   wraparound          transaction IDs are far from wrapping around
#   registry_alerts     no open alert in the shard registry (a shard filled, none ready; DB-011)
#   break_glass         no person's break-glass role outlived its time (DB-021)
#
# Each check is ok, a warning (look today) or critical (act now). Exit code 1 if any check is
# critical. With --prometheus, the same results as metrics, for node_exporter's textfile collector;
# the alert rules (infrastructure/monitoring/alerts.yml) read them.
#
#   pnpm db:health
#   pnpm db:health --prometheus > /var/lib/node_exporter/textfile/buku_db.prom
#
# Development: checks the cluster in docker-compose.dev.yml, as the administrator on its socket.
set -uo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f docker-compose.dev.yml)
FORMAT=text
[[ "${1:-}" == "--prometheus" ]] && FORMAT=prometheus

# One value from the cluster (as the administrator, on its own socket).
q() { "${COMPOSE[@]}" exec -T postgres psql -U buku_admin -d "${2:-postgres}" -v ON_ERROR_STOP=1 -tAc "$1" 2>/dev/null; }

NAMES=() STATUSES=() VALUES=() DETAILS=()
# report <check> <0 ok | 1 warning | 2 critical> <value> <detail>
report() { NAMES+=("$1") STATUSES+=("$2") VALUES+=("$3") DETAILS+=("$4"); }
# level <value> <warning above> <critical above>: 0, 1 or 2 (integers)
level() { if (($1 > $3)); then echo 2; elif (($1 > $2)); then echo 1; else echo 0; fi; }
# A check whose query failed is critical: not knowing is not ok.
unknown() { report "$1" 2 -1 "could not check"; }

if ! q 'SELECT 1' >/dev/null; then
  report postgres 2 0 "the server doesn't answer"
else
  # ── Archiving and backups ──────────────────────────────────────────────────
  if r=$(q "SELECT (failed_count = 0 OR last_archived_time > last_failed_time)::int,
              coalesce(extract(epoch FROM now() - last_archived_time)::bigint, -1) FROM pg_stat_archiver"); then
    IFS='|' read -r archiving age <<<"$r"
    if [[ "$archiving" != 1 ]]; then report archiving 2 "$age" "archiving fails: WAL piles up and point-in-time recovery stops"
    elif ((age < 0)); then report archiving 1 "$age" "nothing archived yet"
    elif ((age > 900)); then report archiving 1 "$age" "last WAL file archived ${age}s ago"
    else report archiving 0 "$age" "last WAL file archived ${age}s ago"; fi
  else unknown archiving; fi

  info=$("${COMPOSE[@]}" exec -T -u postgres postgres pgbackrest --stanza=buku info --output=json 2>/dev/null)
  if [[ -n "$info" ]]; then
    stop=$(python3 -c 'import json,sys; b=json.load(sys.stdin)[0]["backup"]; print(max(x["timestamp"]["stop"] for x in b) if b else -1)' <<<"$info" 2>/dev/null || echo -1)
    if ((stop < 0)); then report backup_age 2 -1 "no backup in the repository"
    else
      age=$(($(date +%s) - stop))
      report backup_age "$(level "$age" $((26 * 3600)) $((8 * 86400)))" "$age" "latest backup finished $((age / 3600))h ago"
    fi
  else unknown backup_age; fi

  # ── Replication ────────────────────────────────────────────────────────────
  if r=$(q "SELECT count(*) FILTER (WHERE NOT active OR wal_status = 'lost'),
              coalesce(max(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn))::bigint, 0),
              coalesce(string_agg(slot_name, ' ') FILTER (WHERE NOT active OR wal_status = 'lost'), '')
            FROM pg_replication_slots"); then
    IFS='|' read -r idle held names <<<"$r"
    if ((idle > 0)); then report replication_slots 2 "$idle" "abandoned: ${names}"
    else report replication_slots 0 0 "every slot is read"; fi
    report slot_retained_wal "$(level "$held" $((1 << 30)) $((10 << 30)))" "$held" "slots hold back $((held >> 20)) MB of WAL at most"
  else unknown replication_slots; fi

  if r=$(q "SELECT count(*), coalesce(string_agg(s.subname, ' '), '') FROM pg_subscription s
            LEFT JOIN pg_stat_subscription w ON w.subid = s.oid AND w.relid IS NULL
            WHERE NOT s.subenabled OR w.pid IS NULL"); then
    IFS='|' read -r stopped names <<<"$r"
    if ((stopped > 0)); then report reference_copies 1 "$stopped" "not running: ${names}"
    else report reference_copies 0 0 "every copy's subscription is running"; fi
  else unknown reference_copies; fi

  # ── Partitions and scheduled jobs (every shard in the registry) ───────────
  shards=$(q "SELECT string_agg(database_name, ' ') FROM registry.shards WHERE status <> 'retired'" buku_directory)
  uncovered=0 stray=0 failed_shards=""
  for db in $shards; do
    if r=$(q "SELECT (SELECT count(*) FROM partman.part_config c
                CROSS JOIN LATERAL (SELECT partition_schemaname || '.' || partition_tablename AS child
                                    FROM partman.show_partitions(c.parent_table, 'DESC') LIMIT 1) last
                CROSS JOIN LATERAL partman.show_partition_info(last.child, c.partition_interval, c.parent_table) info
                WHERE info.child_end_time < now() + c.partition_interval::interval),
               (SELECT coalesce(sum(count), 0) FROM partman.check_default(false))" "$db"); then
      IFS='|' read -r a b <<<"$r"
      uncovered=$((uncovered + a)) stray=$((stray + b))
    else failed_shards+=" $db"; fi
  done
  if [[ -n "$failed_shards" ]]; then unknown partition_coverage; else
    if ((uncovered > 0)); then report partition_coverage 2 "$uncovered" "${uncovered} tables have no partition for the next interval"
    else report partition_coverage 0 0 "partitions ahead on $(wc -w <<<"$shards") shards"; fi
    if ((stray > 0)); then report default_partitions 1 "$stray" "rows outside every partition (in a _default one)"
    else report default_partitions 0 0 "no row outside the partitions"; fi
  fi

  if r=$(q "SELECT count(*), coalesce(string_agg(DISTINCT j.jobname, ' '), '') FROM cron.job_run_details d
            JOIN cron.job j USING (jobid) WHERE d.status = 'failed' AND d.start_time > now() - interval '1 day'"); then
    IFS='|' read -r failures names <<<"$r"
    if ((failures > 0)); then report scheduled_jobs 2 "$failures" "failed in the last day: ${names}"
    else report scheduled_jobs 0 0 "no job failed in the last day"; fi
  else unknown scheduled_jobs; fi

  # ── Load and limits ────────────────────────────────────────────────────────
  if r=$(q "SELECT (100 * count(*) / current_setting('max_connections')::int)::int FROM pg_stat_activity"); then
    report connections "$(level "$r" 80 95)" "$r" "${r}% of max_connections in use"
  else unknown connections; fi

  if r=$(q "SELECT coalesce(max(extract(epoch FROM now() - xact_start))::bigint, 0) FROM pg_stat_activity
            WHERE backend_type = 'client backend' AND xact_start IS NOT NULL"); then
    report long_transactions "$(level "$r" 300 3600)" "$r" "longest open transaction: ${r}s"
  else unknown long_transactions; fi

  if r=$(q "SELECT max(age(datfrozenxid)) FROM pg_database"); then
    report wraparound "$(level "$r" 200000000 1000000000)" "$r" "oldest unfrozen transaction ID age ${r}"
  else unknown wraparound; fi

  # ── The registry and people's access ──────────────────────────────────────
  if r=$(q "SELECT count(*), coalesce(string_agg(kind || ' ' || entity, ', '), '') FROM registry.alerts WHERE resolved_at IS NULL" buku_directory); then
    IFS='|' read -r open what <<<"$r"
    if ((open > 0)); then report registry_alerts 2 "$open" "open: ${what}"
    else report registry_alerts 0 0 "no open alert"; fi
  else unknown registry_alerts; fi

  if r=$(q "SELECT count(*) FILTER (WHERE until < now()), count(*), coalesce(string_agg(rolname, ' ') FILTER (WHERE until < now()), '')
            FROM (SELECT rolname, substring(shobj_description(oid, 'pg_authid') FROM '^break-glass until ([0-9TZ:-]+)')::timestamptz AS until
                  FROM pg_roles WHERE rolname LIKE 'human\_%') r"); then
    IFS='|' read -r expired open names <<<"$r"
    if ((expired > 0)); then report break_glass 2 "$expired" "outlived their time: ${names} (drop them)"
    else report break_glass 0 "$open" "${open} break-glass sessions open"; fi
  else unknown break_glass; fi
fi

# ── Results ──────────────────────────────────────────────────────────────────
WORST=0
for s in "${STATUSES[@]}"; do ((s > WORST)) && WORST=$s; done
if [[ "$FORMAT" == prometheus ]]; then
  echo '# HELP buku_db_check_status A database health check: 0 ok, 1 warning, 2 critical (scripts/db/health.sh).'
  echo '# TYPE buku_db_check_status gauge'
  for i in "${!NAMES[@]}"; do echo "buku_db_check_status{check=\"${NAMES[$i]}\"} ${STATUSES[$i]}"; done
  echo '# HELP buku_db_check_value What a database health check measured (seconds, bytes, a count or a percentage).'
  echo '# TYPE buku_db_check_value gauge'
  for i in "${!NAMES[@]}"; do echo "buku_db_check_value{check=\"${NAMES[$i]}\"} ${VALUES[$i]}"; done
  echo '# HELP buku_db_checks_last_run_timestamp_seconds When the database health checks last ran.'
  echo '# TYPE buku_db_checks_last_run_timestamp_seconds gauge'
  echo "buku_db_checks_last_run_timestamp_seconds $(date +%s)"
else
  for i in "${!NAMES[@]}"; do
    case "${STATUSES[$i]}" in
      0) printf '  \033[32m✔\033[0m %-19s %s\n' "${NAMES[$i]}" "${DETAILS[$i]}" ;;
      1) printf '  \033[33m!\033[0m %-19s %s\n' "${NAMES[$i]}" "${DETAILS[$i]}" ;;
      *) printf '  \033[31m✘\033[0m %-19s %s\n' "${NAMES[$i]}" "${DETAILS[$i]}" ;;
    esac
  done
  case "$WORST" in
    0) printf '\n\033[32mHEALTHY\033[0m\n' ;;
    1) printf '\n\033[33mHEALTHY, with warnings\033[0m — look at them today\n' ;;
    *) printf '\n\033[31mCRITICAL\033[0m — see above (docs/compliance/runbooks.md#database)\n' ;;
  esac
fi
((WORST < 2))
