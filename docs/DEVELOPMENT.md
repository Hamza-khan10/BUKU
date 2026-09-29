# Development guide

## First-time setup (Ubuntu / WSL2)

Prerequisites: Docker Desktop with WSL integration (or Docker Engine), and:

```bash
# Node 24 via nvm, and pnpm 12
curl -so- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh | bash
nvm install        # reads .nvmrc → Node 24
npm i -g pnpm@12.8.1

# Elasticsearch needs this kernel setting (once per WSL/Linux machine)
sudo sysctl -w vm.max_map_count=262144
echo 'vm.max_map_count=262144' | sudo tee /etc/sysctl.d/99-elasticsearch.conf

# Recommended: gitleaks binary for fast pre-commit secret scans (else Docker is used)
# https://github.com/gitleaks/gitleaks/releases → ~/.local/bin/gitleaks

pnpm bootstrap     # creates .env with generated secrets, installs deps, generates Prisma client
pnpm dev           # builds images (first run: a few minutes) and starts the stack
pnpm health        # ✔/✘ per component
```

Demo logins (seeded, dev only): `admin@buku.dev`, `owner1@buku.dev`, `customer2@buku.dev`,
password `buku-dev-password-2026`.

## Everyday commands

| Command                                        | What it does                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:down`                   | Start / stop the stack (data kept in Docker volumes)                  |
| `pnpm dev:wipe`                                | Stop and **delete all local data** (fresh DB + seed on next start)    |
| `pnpm dev:tools`                               | Also start Kibana (:5601), Kafka UI (:8080), Redis Insight (:5540)    |
| `pnpm dev:logs`                                | Follow logs of all containers                                         |
| `pnpm test` / `pnpm test:watch`                | Unit tests                                                            |
| `pnpm test:int`                                | Integration tests against the running stack (uses the `buku_test` DB) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format` | Code quality                                                          |
| `pnpm verify`                                  | Full Phase 1 acceptance (34 checks)                                   |
| `pnpm db:studio`                               | Browse the database in Prisma Studio                                  |

Services hot-reload: edit anything under `packages/*/src` or `services/*/src` and the affected
containers restart within a second. After changing `package.json`/`pnpm-lock.yaml`, run
`docker compose -f docker-compose.dev.yml build` and `pnpm dev` again.

## How to…

### Change the database schema

1. Edit `packages/database/prisma/schema.prisma`.
2. `pnpm db:migrate:dev --name <what_changed>` → creates `prisma/migrations/<ts>_<name>/migration.sql`
   and applies it. **Read the generated SQL.**
3. Need something Prisma can't express (CHECK, EXCLUDE, trigger, partial index)? Create with
   `pnpm --filter @buku/database migrate:create --name <x>`, append the SQL by hand, then apply.
4. `pnpm db:generate` (the dev containers use the client generated on your machine).
5. Add/adjust integration tests in `packages/database/test`.
   CI fails if `schema.prisma` and the migrations disagree.

### Add a Kafka topic

Add it to `TOPIC_SPECS` in `packages/kafka/src/topics.ts`, then `pnpm kafka:topics`
(or restart the stack). Never use raw topic strings in code — use `TOPICS.X`.

### Publish an event from a service

Inside the same transaction as the business change:
`await enqueueEvent(tx, createEvent({ type: TOPICS.X, source, subject: aggregateId, data }), 'aggregate')`.
Consumers wrap side effects in `processOnce(db, '<service>:<topic>', event.id, fn)`.

### Add an environment variable

1. Add it to the service's Zod schema in `services/<svc>/src/config.ts`.
2. Document it in `.env.example` (and `.env.production.example`).
3. Pass it to that service only, in `docker-compose.dev.yml`.

### Add an endpoint (Phase 2 pattern)

```ts
router.post(
  '/v1/things',
  authenticate({ verifier }),
  rateLimit({ keyPrefix: 'rl:things:create', points: 10, durationSeconds: 60, redis }),
  validated({ body: zBody({ name: zSafeText({ min: 1, max: 100 }) }) }, async ({ body }, req, res) => {
    const { userId } = requireAuth(req);
    // authorization check → business logic → sendCreated(res, result)
  }),
);
```

## Git workflow

- **Trunk-based:** `main` is always deployable. Work on short-lived branches:
  `feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `chore/<scope>-<slug>`.
- **Commits:** Conventional Commits, enforced by a hook — `feat(booking): add reschedule endpoint`.
  Scopes: `common database kafka auth booking queue notification search ads analytics web mobile
infra docker kong ci deps docs repo security release`.
- **Hooks:** pre-commit (lint-staged + gitleaks), commit-msg (commitlint), pre-push (typecheck + tests).
  Using a GUI git client? Create `~/.config/husky/init.sh` containing
  `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"` so hooks find node/pnpm.
- **Changesets:** `pnpm changeset` in every PR that changes package/service behaviour.
- **Branch protection:** once, run `bash scripts/github/protect-main.sh` (needs `gh auth login`).

## Troubleshooting

| Symptom                                              | Cause / fix                                                                                                                                                |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` errors: `... run pnpm bootstrap`              | Secrets missing. `pnpm bootstrap` fills only empty values; it never overwrites.                                                                            |
| Elasticsearch exits / unhealthy                      | `vm.max_map_count` too low — see setup above. Needs ~1.3 GB RAM.                                                                                           |
| A service is `unhealthy`                             | `docker compose -f docker-compose.dev.yml logs <svc>`; its `/ready` lists which dependency is down. Config errors print every invalid variable at startup. |
| `504` from the gateway right after a restart         | Kong DNS cache; resolved within 5 s (`KONG_DNS_VALID_TTL`).                                                                                                |
| `ERR_PNPM_NO_MATURE_MATCHING_VERSION`                | Supply-chain guard: that version is < 24 h old. Pick the previous version or wait.                                                                         |
| `ERR_PNPM_...BUILD` for a new dependency             | It wants to run an install script. Review it, then add it to `allowBuilds` in `pnpm-workspace.yaml` with a comment.                                        |
| Prisma: "Environment variable not found" on the host | Run from the repo root after `pnpm bootstrap`; `prisma.config.ts` reads the root `.env`.                                                                   |
| Out of memory in WSL                                 | Give WSL ≥ 8 GB in `%UserProfile%\.wslconfig` (`[wsl2]\nmemory=8GB`), don't run `--profile tools` unless needed.                                           |
| Port already in use                                  | Another local Postgres/Redis? Stop it, or change `POSTGRES_HOST_PORT` in `.env`.                                                                           |
| Start completely fresh                               | `pnpm dev:wipe && pnpm dev`                                                                                                                                |

## Releases (Phase 5)

`pnpm changeset version` bumps versions and writes changelogs; the merge to `main` is tagged
`v<major>.<minor>.<patch>`. Rollbacks always target a git tag (never a guessed image tag).
