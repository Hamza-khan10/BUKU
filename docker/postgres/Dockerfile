# PostgreSQL 17 + PostGIS 3 + pgvector, matching what DigitalOcean Managed
# PostgreSQL offers (both extensions are supported there), so dev == prod.
#
# Built on the official Postgres image for a SUPPORTED Debian release, with
# PostGIS and pgvector from the PostgreSQL project's own apt repository (PGDG),
# which that image already trusts. We used to start from postgis/postgis:17-3.5,
# but its Debian 11 base reached end of life and PGDG stopped serving it, so the
# image could no longer be built (D-054).
FROM postgres:17-bookworm

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      postgresql-17-postgis-3 \
      postgresql-17-postgis-3-scripts \
      postgresql-17-pgvector \
 && rm -rf /var/lib/apt/lists/*

# Our own init script creates the roles and installs every extension into an
# `extensions` schema (keeps Prisma's `public` schema clean).
COPY init/ /docker-entrypoint-initdb.d/
