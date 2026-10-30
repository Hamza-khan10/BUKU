#!/bin/sh
# Postgres's archive_command (DB-030): push one WAL file to the backup repository. A new cluster's
# repository has no stanza yet: it is made once, here, so archiving can never stall unnoticed
# waiting for someone to run stanza-create (Postgres keeps every unarchived WAL file until then).
set -u
pgbackrest --stanza=buku archive-push "$1" && exit 0
pgbackrest --stanza=buku stanza-create >/dev/null 2>&1 && exec pgbackrest --stanza=buku archive-push "$1"
exit 1
