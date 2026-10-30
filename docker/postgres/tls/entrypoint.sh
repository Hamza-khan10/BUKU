#!/bin/sh
# Before the official entrypoint: the server's TLS certificate and key, from the read-only mount
# (secrets/postgres, made by `pnpm bootstrap`), copied where Postgres accepts them — owned by its own
# user, the key readable by nobody else. Without the mount (the restore drill's scratch server), the
# server simply starts without TLS settings of its own.
set -eu
if [ -d /run/buku-tls ] && [ ! -f /run/buku-tls/server.key ]; then
  echo "buku-entrypoint: no server certificate in secrets/postgres: run pnpm bootstrap" >&2
  exit 1
fi
if [ -f /run/buku-tls/server.key ]; then
  install -d -o postgres -g postgres -m 0700 /var/lib/postgresql/tls
  install -o postgres -g postgres -m 0600 /run/buku-tls/server.key /var/lib/postgresql/tls/server.key
  install -o postgres -g postgres -m 0644 /run/buku-tls/server.crt /var/lib/postgresql/tls/server.crt
  install -o postgres -g postgres -m 0644 /run/buku-tls/ca.crt /var/lib/postgresql/tls/ca.crt
fi
exec docker-entrypoint.sh "$@"
