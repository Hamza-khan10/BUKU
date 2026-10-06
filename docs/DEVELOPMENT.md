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

| Command                                         | What it does                                                          |
| ----------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm dev` / `pnpm dev:down`                    | Start / stop the stack (data kept in Docker volumes)                  |
| `pnpm dev:wipe`                                 | Stop and **delete all local data** (fresh DB + seed on next start)    |
| `pnpm dev:tools`                                | Also start Kibana (:5601), Kafka UI (:8080), Redis Insight (:5540)    |
| `pnpm dev:logs`                                 | Follow logs of all containers                                         |
| `pnpm test` / `pnpm test:watch`                 | Unit tests                                                            |
| `pnpm test:int`                                 | Integration tests against the running stack (uses the `buku_test` DB) |
| `pnpm typecheck` · `pnpm lint` · `pnpm format`  | Code quality                                                          |
| `pnpm verify`                                   | Stack and quality checks (45)                                         |
| `pnpm web`                                      | The website on http://localhost:3000 (hot reload; needs the stack)    |
| `pnpm web:e2e`                                  | Browser tests: desktop + phone, WCAG 2.2 AA, CSP, clean text, session |
| `pnpm acceptance`                               | Phase 2 acceptance through the gateway (journeys, races, every route) |
| `pnpm admin:role --email … --role … --reason …` | Grant/remove platform admin (audited; ends their sessions)            |
| `pnpm db:studio`                                | Browse the database in Prisma Studio                                  |

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

### Make a route public (no sign-in)

Every route behind the gateway requires a valid access token by default. To make one public,
add it as its own route WITHOUT the `jwt` plugin in `infrastructure/kong/kong.template.yml`
(restrict `methods` where possible, e.g. `[GET, OPTIONS]`), then `docker compose -f
docker-compose.dev.yml up -d --force-recreate kong`. The service must still not trust the caller.
Finally add it to `PUBLIC` in `scripts/acceptance/run.ts`: `pnpm acceptance` fails for any route
that answers without a token unless it is listed there (on purpose, with a reason).

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

### Work on the website (apps/web)

`pnpm bootstrap` creates `apps/web/.env.local` (see `apps/web/.env.example`). Start the stack
(`pnpm dev`), then `pnpm web` and open http://localhost:3000 — `/kit` shows every component in
light and dark. Before writing Next.js code, read the guide for the installed version in
`apps/web/node_modules/next/dist/docs/` (Next 16 differs from older versions: `proxy.ts`, async
request APIs, no `next lint`). The browser never holds a token: it calls `/api/v1/…` on the web
server, which adds the session (D-085). Browser tests need Chromium once:
`pnpm --filter @buku/web exec playwright install chromium`.

### Deploy the website on Vercel

One Vercel project, connected to this repository, with these settings:

| Setting (Vercel → Project → Settings)                  | Value                                                       |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| Build and Deployment → **Root Directory**              | `apps/web` (a folder; the branch is chosen separately)      |
| Build and Deployment → Framework Preset                | Next.js (install command comes from `apps/web/vercel.json`) |
| Build and Deployment → **Node.js Version**             | 24.x (the repository requires Node 24)                      |
| Environment Variables → `ENABLE_EXPERIMENTAL_COREPACK` | `1` — so Vercel uses this repository's pnpm (12.8.1)        |
| Git → Production Branch                                | `main`                                                      |

Then the web app's own variables (from `apps/web/.env.example`), for Production and Preview:
`APP_URL` (the site's https address), `API_URL` (the public API address, once it is deployed),
`WEB_GATEWAY_KEY` (the same value as the API's), `WEB_CLIENT_IP_HEADER=x-real-ip`,
`DEV_SIGN_IN=false`, `ALLOW_INDEXING=false` until launch, the `LEGAL_*` / `*_EMAIL` details
when they exist, `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` once Google sign-in is set up
(below), and with the API: `MEDIA_ORIGIN` (the CDN that serves public photos) and
`STORAGE_ORIGIN` (the API's `S3_PUBLIC_ENDPOINT`: profile pictures load from it and are
uploaded straight to it — its private bucket's CORS must allow `PUT` from the site's address,
as `infrastructure/s3/init.sh` does in development). Until the API is online, pages that only describe BUKU work, and pages that need live
data show their "isn't loading" state. Previews are behind Vercel's login by default.

### Work on the admin app (apps/admin)

Platform operators use a separate app (D-091), never the website. Copy `apps/admin/.env.example` to
`apps/admin/.env.local` and set `ADMIN_GATEWAY_KEY` to the root `.env`'s value (`pnpm bootstrap`
generates it for Kong). With the stack up, `pnpm admin` and open http://localhost:3200. In
development any email signs in as an admin; two-step sign-in must be set up before anything else
shows. Browser tests: `pnpm admin:e2e`.

### Deploy the admin app

A **second** Vercel project, on its own domain (e.g. `admin.buku.app`) — never the website's
project or domain, so the two never share cookies. Same settings as the website, with **Root
Directory** `apps/admin`, plus its variables (from `apps/admin/.env.example`): `APP_URL` (its own
https address), `API_URL`, `ADMIN_GATEWAY_KEY` (the same value as Kong's — a secret that exists
only in Kong and here), `ADMIN_CLIENT_IP_HEADER=x-real-ip`, `DEV_SIGN_IN=false`, and
`ADMIN_GOOGLE_CLIENT_ID` / `ADMIN_GOOGLE_CLIENT_SECRET` from a **separate** Google OAuth client
(same steps as the website's below, redirect URI `https://<admin domain>/api/auth/google/callback`;
add its id to the API's `GOOGLE_CLIENT_IDS`). Admins sign in with Google accounts that already
exist and were made admins with `pnpm admin:role`; the admin app never creates an account. Consider
Vercel's deployment protection or an IP allow-list for the whole project: the app is for a handful
of people.

### Set up Sign in with Google

The website signs people in with Google on its own server (D-090): no Google script runs in the
browser. It needs one OAuth client, used by both the website and the API.

1. [Google Cloud console](https://console.cloud.google.com) → create a project (e.g. "BUKU").
2. _APIs & Services → OAuth consent screen_: user type **External**; app name **BUKU**; your
   support email; scopes `openid`, `email`, `profile` (nothing else). While it is in **Testing**,
   only the test users you add can sign in — add yourself.
3. _APIs & Services → Credentials → Create credentials → OAuth client ID_: type **Web
   application**. Authorised redirect URIs:
   - `http://localhost:3000/api/auth/google/callback` (development)
   - `https://<the site's domain>/api/auth/google/callback` (the live site; add it when the
     domain is final — Vercel preview addresses change, so previews use development sign-in)
4. Copy the **client ID** and **client secret**:
   - `apps/web/.env.local` (and Vercel): `GOOGLE_CLIENT_ID=…`, `GOOGLE_CLIENT_SECRET=…`
   - the API's root `.env`: `GOOGLE_CLIENT_IDS=<the same client ID>` (comma-separated if the mobile
     apps add their own later), then `docker compose -f docker-compose.dev.yml up -d auth-service`.
5. Restart the website (`pnpm web`): `/signin` now shows **Continue with Google**.

The secret is a secret: only in `.env.local` (git-ignored) and Vercel's environment settings.

If Google shows **Error 400: redirect_uri_mismatch**, the address in step 3 isn't registered on
this client exactly (scheme, host, port and path must match; no trailing slash).

On Vercel the button appears only once `API_URL` points at the deployed API (Phase 5): Google's
answer has to be handed to the API, and until there is one the site says signing in isn't open
yet (the Google routes answer the same, never an error page).

### Set up Paddle (online payments, sandbox)

Billing works without Paddle (checkout answers "online payments aren't set up"). To try real
checkouts:

1. Create a free account at **sandbox-vendors.paddle.com** (sandbox = test cards, no real money).
2. _Developer tools → Authentication_: create an **API key** and copy the **client-side token**.
3. _Developer tools → Notifications_: add a destination for `subscription.*` events pointing at
   `https://<public address>/v1/billing/webhooks/paddle`, and copy its **secret key**. Locally,
   expose the gateway with a tunnel (e.g. `cloudflared tunnel --url http://localhost:8000`).
4. Put the three values in `.env` (`PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_WEBHOOK_SECRET`;
   all three or none) and restart billing: `docker compose -f docker-compose.dev.yml up -d billing-service`.
5. As a super admin, link each web price: `POST /v1/admin/billing/prices/:id/sync-paddle` (creates
   the product and price in Paddle). Repeat after every price change.
6. Switch billing on: `PUT /v1/admin/billing/settings/user { "enabled": true }` (and `business`).
7. Pay with Paddle's test card `4242 4242 4242 4242`, any future date, any CVC.

Never put the API key or webhook secret in the web or mobile app — only the client-side token.

### Set up WhatsApp (Meta WhatsApp Cloud API)

Without it, connecting answers "WhatsApp isn't available yet" and nothing is sent. Messages are
written to the log in development (`WHATSAPP_PROVIDER=log`).

1. In **business.facebook.com**, create (or use) a Business portfolio and complete **business
   verification** (needed for real volumes).
2. **developers.facebook.com → My apps → Create app → Business**, add the **WhatsApp** product.
   Add a phone number (not one already used in the WhatsApp app) and note its **Phone number ID**.
3. _Business settings → System users_: create a system user, give it the app with
   `whatsapp_business_messaging` and `whatsapp_business_management`, and generate a **permanent
   token** (never the 24-hour test token).
4. _App settings → Basic_: copy the **App secret**. Choose a long random **verify token**.
5. _WhatsApp → Configuration → Webhook_: URL `https://<public address>/v1/webhooks/whatsapp`
   (locally: `cloudflared tunnel --url http://localhost:8000`), the verify token, and subscribe to
   **messages**.
6. In `.env`: `WHATSAPP_PROVIDER=meta`, `WHATSAPP_BUSINESS_NUMBER=+…`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`; then
   `docker compose -f docker-compose.dev.yml up -d notification-service`.
7. Optional, for paid messages: create the templates listed by
   `GET /v1/admin/notifications/whatsapp/templates` in _WhatsApp Manager → Message templates_
   (category **Utility**, same name, variables in the same order) and wait for approval.
8. As a super admin: `PUT /v1/admin/notifications/settings` with `{ "whatsappEnabled": true }`.
   To allow paid templates for people without the app, also set `whatsappPaidTypes`,
   `whatsappMessageCostCents` (Meta's rate card for your market) and a
   `whatsappMonthlyBudgetCents`. Watch `GET /v1/admin/notifications/whatsapp/usage`.

## Git workflow

- **Trunk-based:** `main` is always deployable. Work on short-lived branches:
  `feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `chore/<scope>-<slug>`.
- **Commits:** Conventional Commits, enforced by a hook — `feat(booking): add reschedule endpoint`.
  Scopes: `common database kafka auth business booking queue billing notification search ads analytics web mobile
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
