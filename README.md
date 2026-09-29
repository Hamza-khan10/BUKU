# BUKU

Universal appointment booking and virtual queue platform. Consumers book or
join a live queue at any service business (barbers, clinics, car washes,
government offices, …); businesses run their day from one dashboard.

**Status:** Phase 1 (Foundation) complete and verified — see the
[Build Guide](docs/BUILD_GUIDE.md) for the phase-by-phase plan.

## Quick start (Ubuntu / WSL2)

```bash
nvm install && npm i -g pnpm@12.8.1          # Node 24 + pnpm 12
sudo sysctl -w vm.max_map_count=262144        # Elasticsearch requirement
pnpm bootstrap                                # generates .env secrets, installs deps
pnpm dev                                      # starts the full stack
pnpm health                                   # ✔ every component
pnpm verify                                   # full Phase 1 acceptance (34 checks)
```

API gateway: <http://localhost:8000> · Mailpit: <http://localhost:8025> ·
S3 console: <http://localhost:9101>. Full details in [DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Documentation

| Document                             | Read it to learn                                                            |
| ------------------------------------ | --------------------------------------------------------------------------- |
| [Build Guide](docs/BUILD_GUIDE.md)   | What each phase builds, in which order, acceptance criteria, open decisions |
| [Architecture](docs/ARCHITECTURE.md) | How services, data stores and events fit together                           |
| [Security](docs/SECURITY.md)         | Every security control, where it lives, what's tested                       |
| [Decisions](docs/DECISIONS.md)       | Why the build differs from the original spec, decision by decision          |
| [Development](docs/DEVELOPMENT.md)   | Setup, daily commands, how-tos, git workflow, troubleshooting               |

## Repository layout

```
packages/
  common/      shared building blocks: errors, config, logging, validation, security, HTTP
  database/    Prisma schema, migrations, seed, database client
  kafka/       topic registry, event envelope, producer/consumer, transactional outbox
services/      auth · booking · queue · notification · search · ads · analytics
docker/        dev image, production image, Postgres (PostGIS + pgvector) image
infrastructure/ Kong gateway, Elasticsearch, ClickHouse, object storage bootstrap
scripts/       bootstrap, health check, Phase 1 verification, GitHub branch protection
docs/          documentation
```

## Tech stack

Node.js 24 · TypeScript 6 · Express 5 · Prisma 7 · Zod 4 · PostgreSQL 17 (PostGIS, pgvector) ·
Valkey 8 · Kafka 4.3 · Elasticsearch 9 · ClickHouse 26.3 · Kong 3.9 · pnpm 12 · Vitest ·
Docker (distroless production images) · GitHub Actions.
