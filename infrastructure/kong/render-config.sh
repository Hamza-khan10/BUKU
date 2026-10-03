#!/bin/sh
# Renders kong.template.yml → /tmp/kong.yml, validates it, then starts Kong.
#
# The JWT public key(s) come from the same environment variables every
# service uses (base64-encoded PEM), so the gateway and the services can never
# disagree about which keys are valid. Runs as Kong's non-root user.
set -eu

: "${JWT_PUBLIC_KEY:?}" "${JWT_KEY_ID:?}"
TEMPLATE=/kong/kong.template.yml
OUT=/tmp/kong.yml
SECRETS=/tmp/jwt-secrets.yml

secret_block() { # <kid> <base64 PEM>
  printf '      - key: %s\n        algorithm: RS256\n        rsa_public_key: |\n' "$1"
  printf '%s' "$2" | base64 -d | sed 's/^/          /'
}

{
  secret_block "$JWT_KEY_ID" "$JWT_PUBLIC_KEY"
  if [ -n "${JWT_PREVIOUS_KEY_ID:-}" ] && [ -n "${JWT_PREVIOUS_PUBLIC_KEY:-}" ]; then
    secret_block "$JWT_PREVIOUS_KEY_ID" "$JWT_PREVIOUS_PUBLIC_KEY"
  fi
} > "$SECRETS"

# The web server's key (D-084): 64 hex characters, or empty (then no client
# address is believed from anyone). Checked strictly: it is pasted into Lua.
WEB_KEY="${WEB_GATEWAY_KEY:-}"
if [ -n "$WEB_KEY" ] && ! printf '%s' "$WEB_KEY" | grep -Eq '^[0-9a-f]{64}$'; then
  echo "kong: WEB_GATEWAY_KEY must be 64 lowercase hex characters (openssl rand -hex 32)" >&2
  exit 1
fi

awk -v secrets="$SECRETS" -v webkey="$WEB_KEY" '
  /^[[:space:]]*# __JWT_SECRETS__[[:space:]]*$/ { while ((getline line < secrets) > 0) print line; next }
  { gsub(/__WEB_GATEWAY_KEY__/, webkey); print }
' "$TEMPLATE" > "$OUT"

kong config parse "$OUT" > /dev/null
echo "kong: rendered $OUT with key id(s): $JWT_KEY_ID ${JWT_PREVIOUS_KEY_ID:-}; web key: $([ -n "$WEB_KEY" ] && echo set || echo not set)"
exec /docker-entrypoint.sh kong docker-start
