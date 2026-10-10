#!/bin/sh
# Starts Valkey with its users (D-092), from access.acl and the passwords in the environment
# (VALKEY_PASSWORD for the admin, VALKEY_PASSWORD_<NAME> for each user). The users are written,
# as password hashes, to a file only Valkey's own user can read (outside the data volume), and
# loaded at every start: a restart never loses them.
set -eu
umask 077

# What every service user may run, before its own line's keys and extras.
BASE='resetkeys resetchannels -@all +@connection +@read +@write +@scripting +@transaction -@dangerous -select +info'
PLAN=/access/access.acl
USERS=/tmp/users.acl

fail() {
  echo "valkey: $*" >&2
  exit 1
}
hash() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

# Every password checked first: a missing one stops the start, never becomes an empty password.
names=$(sed 's/#.*//' "$PLAN" | awk 'NF { print $1 }')
for name in $names; do
  var="VALKEY_PASSWORD_$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  value=$(printenv "$var" || true)
  case "$value" in *[!A-Za-z0-9]* | '') fail "$var missing or not letters and digits (run pnpm bootstrap)" ;; esac
  [ "${#value}" -ge 32 ] || fail "$var shorter than 32 characters"
done
case "${VALKEY_PASSWORD:-}" in '') fail "VALKEY_PASSWORD missing (run pnpm bootstrap)" ;; esac

echo "user default on #$(hash "$VALKEY_PASSWORD") ~* &* +@all" > "$USERS"
sed 's/#.*//' "$PLAN" | awk 'NF' | while read -r name rules; do
  var="VALKEY_PASSWORD_$(echo "$name" | tr '[:lower:]' '[:upper:]')"
  echo "user buku-$name on #$(hash "$(printenv "$var")") $BASE $rules" >> "$USERS"
done
echo "valkey: $(($(wc -l < "$USERS") - 1)) users and the admin"

exec valkey-server \
  --aclfile "$USERS" \
  --maxmemory 384mb \
  --maxmemory-policy noeviction \
  --appendonly yes \
  --appendfsync everysec \
  --save 900 1 --save 300 100 --save 60 10000 \
  --rename-command FLUSHALL '' \
  --rename-command FLUSHDB '' \
  --rename-command DEBUG ''
