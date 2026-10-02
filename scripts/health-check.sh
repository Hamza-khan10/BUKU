#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# Quick ✔/✘ status of every component of the local stack.   (pnpm health)
# ═══════════════════════════════════════════════════════════════════════════
set -uo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.dev.yml)
FAIL=0
ok()  { printf '  \033[32m✔\033[0m %-22s %s\n' "$1" "${2:-}"; }
bad() { printf '  \033[31m✘\033[0m %-22s %s\n' "$1" "${2:-}"; FAIL=1; }
exec_in() { "${COMPOSE[@]}" exec -T "$@" 2>/dev/null; }
skip() { printf '  \033[90m–\033[0m %-22s %s\n' "$1" "not running (opt-in profile: $2)"; }
RUNNING=$("${COMPOSE[@]}" ps --status running --services 2>/dev/null)
running() { grep -qx "$1" <<< "$RUNNING"; }

echo "BUKU local health check"
echo "── Data stores ──"
exec_in postgres pg_isready -U buku_admin -d buku -q && ok "PostgreSQL" "$(exec_in postgres psql -U buku_admin -d buku -tAc 'SELECT version()' | cut -d' ' -f1-2)" || bad "PostgreSQL"
[[ "$(exec_in valkey valkey-cli ping)" == "PONG" ]] && ok "Valkey" || bad "Valkey"
topics=$(exec_in kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:29092 --list | grep -vc '^__' || true)
[[ "${topics:-0}" -ge 41 ]] && ok "Kafka" "$topics topics" || bad "Kafka" "${topics:-0} topics (expected 41)"
if running elasticsearch; then
  es=$(curl -sf 'http://localhost:9200/_cluster/health' | grep -o '"status":"[a-z]*"' | cut -d'"' -f4)
  [[ "$es" == "green" || "$es" == "yellow" ]] && ok "Elasticsearch" "status=$es" || bad "Elasticsearch"
else skip "Elasticsearch" elasticsearch; fi
if running clickhouse; then
  [[ "$(curl -sf http://localhost:8123/ping)" == "Ok." ]] && ok "ClickHouse" || bad "ClickHouse"
else skip "ClickHouse" analytics; fi
curl -s -o /dev/null http://localhost:9100 && ok "Object storage (S3)" || bad "Object storage (S3)"
curl -sf http://localhost:8025/livez > /dev/null && ok "Mailpit" || bad "Mailpit"

echo "── Services (readiness = all dependencies reachable) ──"
for svc in auth:3001 business:3008 billing:3009 booking:3002 queue:3003 notification:3004 search:3005 ads:3006 analytics:3007; do
  name=${svc%%:*}; port=${svc##*:}
  if [[ "$name" == "ads" || "$name" == "analytics" ]] && ! running "${name}-service"; then
    skip "${name}-service" "$name"; continue
  fi
  body=$(exec_in "${name}-service" node -e "fetch('http://localhost:${port}/ready').then(async r=>{console.log(r.status, JSON.stringify((await r.json()).checks))}).catch(e=>console.log('000', e.message))")
  code=${body%% *}
  [[ "$code" == "200" ]] && ok "${name}-service" "$(echo "${body#* }" | grep -o '"[a-z]*":{"status":"up"' | cut -d'"' -f2 | paste -sd, -)" || bad "${name}-service" "${body:-not running}"
done

echo "── Gateway ──"
exec_in kong kong health > /dev/null && ok "Kong" || bad "Kong"
code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/v1/auth/me)
[[ "$code" == "404" || "$code" == "401" ]] && ok "Kong → auth-service" "HTTP $code" || bad "Kong → auth-service" "HTTP $code"

echo
if [[ $FAIL == 0 ]]; then echo "ALL GREEN"; else echo "FAILURES — inspect with: pnpm dev:logs  (or docker compose -f docker-compose.dev.yml logs <service>)"; exit 1; fi
