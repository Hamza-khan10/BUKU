#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Phase 1 acceptance: every foundation "brick" verified against the running
# stack. Run after `pnpm dev`.                                  (pnpm verify)
# Exit code 0 only if everything passes.
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.dev.yml)
PASS=0; FAIL=0
check() { # check "<description>" <command...>
  local desc="$1"; shift
  if "$@" > /dev/null 2>&1; then printf '  \033[32m✔\033[0m %s\n' "$desc"; PASS=$((PASS+1));
  else printf '  \033[31m✘\033[0m %s\n' "$desc"; FAIL=$((FAIL+1)); fi
}
psql_q() { "${COMPOSE[@]}" exec -T postgres psql -U buku_admin -d buku -tAc "$1" 2>/dev/null; }
eq() { [[ "$1" == "$2" ]]; }
RUNNING=$("${COMPOSE[@]}" ps --status running --services 2>/dev/null)
running() { grep -qx "$1" <<< "$RUNNING"; }
skip() { printf '  \033[90m–\033[0m %s (opt-in profile not running)\n' "$1"; }
ge() { [[ "${1:-0}" -ge "$2" ]]; }

# Wait (up to 3 min) for every long-running container to report healthy, so a
# stack that is still booting isn't reported as broken.
echo "Waiting for the stack to be healthy..."
for _ in $(seq 1 36); do
  pending=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk '$2 != "" && $2 != "healthy"' | wc -l)
  [[ "$pending" == "0" ]] && break
  sleep 5
done

# Containers can be healthy a few seconds before the gateway has re-resolved
# them (Kong DNS TTL 5s). Wait until requests actually route (no 5xx).
for _ in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/v1/queue)
  [[ "$code" =~ ^[234] ]] && break
  sleep 2
done

echo "═══ 1. Code quality ═══"
check "TypeScript compiles (strict)"       pnpm typecheck
check "ESLint clean (0 warnings)"          pnpm lint
check "Prettier formatting"                pnpm format:check
check "Unit tests pass"                    pnpm test
check "No HIGH/CRITICAL dependency vulnerabilities" pnpm audit:deps

echo "═══ 2. Stack health ═══"
check "Every component healthy (health-check.sh)" bash scripts/health-check.sh

echo "═══ 3. Database ═══"
check "34 Prisma-managed tables in public (+1 in ai)" eq "$(psql_q "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'")" 34
check "Extensions: postgis, vector, pg_trgm, btree_gist, pgcrypto" eq "$(psql_q "SELECT count(*) FROM pg_extension WHERE extname IN ('postgis','vector','pg_trgm','btree_gist','pgcrypto')")" 5
check "All migrations applied, no drift"               bash -c "cd packages/database && pnpm exec prisma migrate status | grep -q 'Database schema is up to date'"
check "3 tables range-partitioned by month"            eq "$(psql_q "SELECT count(*) FROM pg_partitioned_table")" 3
check "≥ 12 future monthly partitions per table"       ge "$(psql_q "SELECT count(*) FROM pg_inherits i JOIN pg_class c ON c.oid=i.inhrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='partitions'")" 39
check "Exclusion constraints (staff, resource, customer)" eq "$(psql_q "SELECT count(*) FROM pg_constraint WHERE contype='x'")" 3
check "≥ 60 CHECK constraints"                          ge "$(psql_q "SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE contype='c' AND n.nspname='public'")" 60
check "HNSW vector index on ai.business_knowledge_chunks" eq "$(psql_q "SELECT count(*) FROM pg_indexes WHERE schemaname='ai' AND indexdef ILIKE '%hnsw%'")" 1
check "Seed data present (20 businesses, 200 appointments)" eq "$(psql_q "SELECT (SELECT count(*) FROM businesses)||'/'||(SELECT count(*) FROM appointments)")" "20/200"
check "User emails stored encrypted, never plaintext"  eq "$(psql_q "SELECT count(*) FROM users WHERE email_encrypted IS NOT NULL AND email_encrypted NOT LIKE 'enc:1:%'")" 0
check "App role cannot DROP tables (least privilege)"  bash -c "! docker compose -f docker-compose.dev.yml exec -T -e PGPASSWORD=\$(grep ^BUKU_APP_PASSWORD= .env | cut -d= -f2) postgres psql -h localhost -U buku_app -d buku -c 'DROP TABLE categories' 2>/dev/null"

echo "═══ 4. Kafka ═══"
check "41 topics exactly match the registry"           bash -c "docker compose -f docker-compose.dev.yml run --rm --no-deps kafka-init /app/node_modules/.bin/tsx scripts/sync-topics.ts --check"
check "Auto topic creation disabled"                   bash -c "docker compose -f docker-compose.dev.yml exec -T kafka /opt/kafka/bin/kafka-configs.sh --bootstrap-server localhost:29092 --entity-type brokers --entity-name 1 --describe --all | grep -q 'auto.create.topics.enable=false'"

echo "═══ 5. Search & analytics stores ═══"
check "Postgres full-text search index on businesses"  eq "$(psql_q "SELECT count(*) FROM pg_indexes WHERE indexname='businesses_search_vector_idx'")" 1
if running elasticsearch; then
  check "Elasticsearch alias businesses → businesses_v1" bash -c "curl -sf http://localhost:9200/_alias/businesses | grep -q businesses_v1"
  check "Elasticsearch mapping is strict"                bash -c "curl -sf http://localhost:9200/businesses_v1/_mapping | grep -q '\"dynamic\":\"strict\"'"
else skip "Elasticsearch checks"; fi
if running clickhouse; then
  check "ClickHouse: 4 analytics tables"                 eq "$("${COMPOSE[@]}" exec -T clickhouse clickhouse-client --user buku_analytics --password "$(grep ^CLICKHOUSE_PASSWORD= .env | cut -d= -f2)" -q "SELECT count() FROM system.tables WHERE database='buku_analytics'" 2>/dev/null)" 4
else skip "ClickHouse checks"; fi
check "S3 buckets created"                             bash -c "docker compose -f docker-compose.dev.yml logs s3-init 2>/dev/null | grep -q 'buku-documents-dev'"

echo "═══ 6. Gateway & security baseline ═══"
check "Only localhost-bound published ports"          bash -c "! docker compose -f docker-compose.dev.yml ps --format '{{.Publishers}}' | grep -q '0.0.0.0'"
check "Services not reachable directly from host"      bash -c "! curl -s --max-time 2 http://localhost:3001/health"
check "Internal endpoints not routed by gateway"       eq "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/metrics)" 404
check "Security headers on API responses"              bash -c "curl -s -D - -o /dev/null http://localhost:8000/v1/queue | grep -qi \"content-security-policy: default-src 'none'\""
check "Standard error envelope with request id"        bash -c "curl -s http://localhost:8000/v1/queue | grep -q '\"requestId\"'"
check "CORS allows the web origin"                     bash -c "curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST' http://localhost:8000/v1/auth/login | grep -qi 'access-control-allow-origin: http://localhost:3000'"
check "CORS rejects unknown origins"                   bash -c "! curl -s -D - -o /dev/null -X OPTIONS -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: POST' http://localhost:8000/v1/auth/login | grep -qi 'access-control-allow-origin: https://evil.example'"
check "Node containers run as non-root, read-only FS"  bash -c "[[ \$(docker inspect buku-auth-service-1 --format '{{.Config.User}}/{{.HostConfig.ReadonlyRootfs}}') == 'node/true' ]]"
check "Valkey dangerous commands disabled"             bash -c "docker compose -f docker-compose.dev.yml exec -T valkey valkey-cli FLUSHALL 2>&1 | grep -q 'unknown command'"
check ".env is git-ignored"                            git check-ignore -q .env

echo "═══ 7. Integration tests (real Postgres + Kafka) ═══"
check "Integration tests pass"                         pnpm test:int

echo
echo "Passed: $PASS   Failed: $FAIL"
[[ $FAIL == 0 ]] && echo "PHASE 1 VERIFIED ✔" || { echo "PHASE 1 NOT VERIFIED ✘"; exit 1; }
