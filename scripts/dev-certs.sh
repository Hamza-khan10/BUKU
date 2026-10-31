#!/usr/bin/env bash
# Development TLS for Postgres (docs/DATABASE.md DB-020), made once by `pnpm bootstrap`:
#
#   secrets/ca/            a local certificate authority (ca.key never leaves this folder)
#   secrets/postgres/      the server's certificate and key, plus the authority (mounted into Postgres)
#   secrets/postgres-ca/   the authority alone (mounted into every service; PGSSLROOTCERT on this machine)
#
# The server certificate names every host clients dial: `postgres` (inside Docker), `localhost` and
# 127.0.0.1 (this machine). Existing files are kept; delete secrets/ca to start over (then re-run
# bootstrap and recreate the stack). Production uses certificates from the provider's authority.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
mkdir -p secrets/ca secrets/postgres secrets/postgres-ca

if [[ ! -f secrets/ca/ca.key ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out secrets/ca/ca.key
  openssl req -x509 -new -key secrets/ca/ca.key -sha256 -days 3650 \
    -subj "/CN=BUKU development CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -out secrets/ca/ca.crt 2>/dev/null
  rm -f secrets/postgres/server.crt # a new authority: the server gets a new certificate too
fi

if [[ ! -f secrets/postgres/server.crt ]]; then
  openssl ecparam -name prime256v1 -genkey -noout -out secrets/postgres/server.key
  openssl req -new -key secrets/postgres/server.key -subj "/CN=postgres" -out secrets/postgres/server.csr 2>/dev/null
  printf '%s\n' \
    'basicConstraints=critical,CA:FALSE' \
    'keyUsage=critical,digitalSignature' \
    'extendedKeyUsage=serverAuth' \
    'subjectAltName=DNS:postgres,DNS:localhost,IP:127.0.0.1' >secrets/postgres/server.ext
  openssl x509 -req -in secrets/postgres/server.csr -CA secrets/ca/ca.crt -CAkey secrets/ca/ca.key \
    -CAcreateserial -days 825 -sha256 -extfile secrets/postgres/server.ext \
    -out secrets/postgres/server.crt 2>/dev/null
  rm -f secrets/postgres/server.csr secrets/postgres/server.ext secrets/ca/ca.srl
fi

cp secrets/ca/ca.crt secrets/postgres/ca.crt
cp secrets/ca/ca.crt secrets/postgres-ca/ca.crt
# The containers read them as their own users: certificates readable, the server key only by its owner
# (the Postgres entrypoint copies it and makes it the server's).
chmod 0644 secrets/postgres/server.crt secrets/postgres/ca.crt secrets/postgres-ca/ca.crt
chmod 0600 secrets/postgres/server.key secrets/ca/ca.key
chmod 0755 secrets/postgres secrets/postgres-ca
