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

awk -v secrets="$SECRETS" '
  /^[[:space:]]*# __JWT_SECRETS__[[:space:]]*$/ { while ((getline line < secrets) > 0) print line; next }
  { print }
' "$TEMPLATE" > "$OUT"

kong config parse "$OUT" > /dev/null
echo "kong: rendered $OUT with key id(s): $JWT_KEY_ID ${JWT_PREVIOUS_KEY_ID:-}"
exec /docker-entrypoint.sh kong docker-start
