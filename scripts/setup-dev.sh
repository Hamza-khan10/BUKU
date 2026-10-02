#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
# One-time (and safe to re-run) local setup:
#   1. checks prerequisites
#   2. creates .env from .env.example and generates every missing secret
#      (never overwrites a value that is already set)
#   3. installs dependencies and generates the Prisma client
# ═══════════════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '  \033[31m✘\033[0m %s\n' "$*" >&2; exit 1; }

bold "1/3 Prerequisites"
command -v docker  >/dev/null || die "docker not found (enable Docker Desktop WSL integration)"
docker info >/dev/null 2>&1    || die "docker daemon not reachable"
docker compose version >/dev/null 2>&1 || die "docker compose v2 not found"
command -v openssl >/dev/null || die "openssl not found"
command -v node    >/dev/null || die "node not found (nvm install 24)"
[[ "$(node -p 'process.versions.node.split(".")[0]')" == "24" ]] || die "Node 24 required (found $(node -v)); run: nvm use"
command -v pnpm    >/dev/null || die "pnpm not found (npm i -g pnpm@12)"
ok "docker, node $(node -v), pnpm $(pnpm -v), openssl"

max_map=$(cat /proc/sys/vm/max_map_count 2>/dev/null || echo 0)
if (( max_map < 262144 )); then
  warn "vm.max_map_count=$max_map (Elasticsearch needs 262144). Run once:"
  warn "  sudo sysctl -w vm.max_map_count=262144 && echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf"
else
  ok "vm.max_map_count=$max_map"
fi
command -v gitleaks >/dev/null && ok "gitleaks $(gitleaks version)" || warn "gitleaks not installed — the pre-commit secret scan will fall back to Docker"

bold "2/3 Secrets (.env)"
if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  ok "created .env from .env.example (mode 600)"
fi

# An empty value followed by an inline comment ("KEY=   # note") is read by
# Docker Compose as the COMMENT TEXT. Move such comments onto their own line.
sed -E -i 's/^([A-Z0-9_]+)=[[:space:]]+(#.*)$/\2\n\1=/' .env

# Effective value of KEY in .env (inline "# comment" and whitespace stripped).
get_value() {
  grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^[[:space:]]+//; s/[[:space:]]+$//' || true
}

# Sets KEY=value only if KEY is missing or empty in .env.
set_if_empty() {
  local key="$1" value="$2"
  if [[ -n "$(get_value "$key")" ]]; then return 0; fi
  local tmp; tmp=$(mktemp)
  if grep -qE "^${key}=" .env; then
    awk -v k="$key" -v v="$value" 'BEGIN{FS=OFS="="} $1==k {print k"="v; next} {print}' .env > "$tmp"
  else
    cat .env > "$tmp"; echo "${key}=${value}" >> "$tmp"
  fi
  cat "$tmp" > .env; rm -f "$tmp"
  ok "generated $key"
}

hex()   { openssl rand -hex "$1"; }
b64_32(){ openssl rand -base64 32; }

set_if_empty POSTGRES_SUPERUSER_PASSWORD "$(hex 24)"
set_if_empty BUKU_MIGRATOR_PASSWORD      "$(hex 24)"
set_if_empty BUKU_APP_PASSWORD           "$(hex 24)"
set_if_empty VALKEY_PASSWORD             "$(hex 24)"
set_if_empty CLICKHOUSE_PASSWORD         "$(hex 24)"
set_if_empty S3_ACCESS_KEY_ID            "buku$(hex 8)"
set_if_empty S3_SECRET_ACCESS_KEY        "$(hex 24)"
set_if_empty PII_ENCRYPTION_KEYS         "k1:$(b64_32)"
set_if_empty PII_BLIND_INDEX_KEY         "$(b64_32)"

if [[ -z "$(get_value JWT_PRIVATE_KEY)" ]]; then
  tmpd=$(mktemp -d); trap 'rm -rf "$tmpd"' EXIT
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$tmpd/private.pem" 2>/dev/null
  openssl pkey -in "$tmpd/private.pem" -pubout -out "$tmpd/public.pem" 2>/dev/null
  set_if_empty JWT_PRIVATE_KEY "$(base64 -w0 < "$tmpd/private.pem")"
  sed -i '/^JWT_PUBLIC_KEY=/d' .env
  set_if_empty JWT_PUBLIC_KEY  "$(base64 -w0 < "$tmpd/public.pem")"
  sed -i '/^JWT_KEY_ID=/d' .env
  set_if_empty JWT_KEY_ID      "dev-$(date +%Y%m%d)"
fi
chmod 600 .env

bold "3/3 Dependencies"
pnpm install --frozen-lockfile
pnpm db:generate >/dev/null
ok "dependencies installed, Prisma client generated"

echo
bold "Done. Next:"
echo "  pnpm dev          # start the stack (first run builds images: a few minutes)"
echo "  pnpm health       # check every component"
echo "  pnpm verify       # full Phase 1 verification"
