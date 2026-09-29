# PostgreSQL 17 + PostGIS 3.5 + pgvector, matching what DigitalOcean Managed
# PostgreSQL offers (both extensions are supported there), so dev == prod.
FROM postgis/postgis:17-3.5

# The official Postgres Debian images already configure the PGDG apt repo,
# which ships pgvector builds for every supported major version.
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-17-pgvector \
 && rm -rf /var/lib/apt/lists/*

# The base image's own init script installs PostGIS topology/tiger-geocoder into
# `public`. BUKU needs neither, and installs PostGIS into an `extensions`
# schema instead (keeps Prisma's `public` schema clean) — so replace it.
RUN rm -f /docker-entrypoint-initdb.d/10_postgis.sh
COPY init/ /docker-entrypoint-initdb.d/
