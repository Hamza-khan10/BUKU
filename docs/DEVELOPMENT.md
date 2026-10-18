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
| `pnpm db:prepare`                               | Create the directory databases and admin-only extensions (idempotent) |
| `pnpm db:shards`                                | Make every registered shard a migrated database (idempotent)          |
| `pnpm db:seed:v2`                               | Database v2 development data, placed across shards (idempotent)       |

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

### Integration tests of a service on database v2

Services on v2 (auth so far, D3) test against a world of their own: the directory
`buku_directory_services_test` with one user shard and one business shard, rebuilt by the
integration tests' global setup with every service's rights applied as in production
(`packages/database/test/services-world.ts`). A service's tests start a `DataPlane` as the
service's own role (`servicesWorld.urlFor('auth')`), and a second one as `buku_app` for fixtures
and checks. The same file offers `withBusinessBilling`, `givePlan`, and `servicesWorld.ownerUrl()`
for reference data BUKU curates (kinds of business). After pulling, run `pnpm db:prepare` once so
that directory exists.

### Change reference data (kinds of business, plans, currencies…)

Reference data lives on the directory (`reference.*`, docs/DATABASE.md DB-015) and is copied by
logical replication to every business shard and the catalog. Change rows on the directory only;
the copies follow within a second or two and are read-only.

To change its **shape**: edit the model in `prisma/directory/schema.prisma` and write the
directory migration; a **new table** is also added to the publication there
(`ALTER PUBLICATION "buku_reference" ADD TABLE …`). Then make the same change to the copies, in
`prisma/business/schema.prisma` and `prisma/catalog/schema.prisma` (same columns, no relations), with
a migration in each. Run `pnpm db:migrate:deploy && pnpm db:shards`: provisioning refreshes every
subscription, so a new table starts copying. Tests fail if a reference table isn't published or a
copy's columns differ from the source.

### The catalog (search and discovery)

`buku_catalog` (`prisma/catalog`, DB-041) holds every business as discovery sees it. It is a read
model: filled from the business shards' events (D3), safe to rebuild. Its migrations run with the
others (`pnpm db:migrate:deploy`); its client is `createCatalogClient`.

### Change the directory (shard registry)

The directory database (`buku_directory`, docs/DATABASE.md DB-013) has its own schema and
migrations: `packages/database/prisma/directory/`. Same steps as above, with
`--config prisma.directory.config.ts` on every Prisma command (`pnpm db:migrate:deploy`,
`pnpm db:generate` and CI already do both). Two rules for a new directory table: revoke
`buku_app`'s default rights in its migration (services never write the registry; a test checks),
and add a `registry.log_change()` trigger if it describes the layout, so changes are logged and
routers notice them.

Changing the layout itself (limits, shards, regions, clusters, who may place a family) needs no
migration: it is data. The recipes are in DATABASE.md DB-017. Locally:

```bash
docker exec -it buku-postgres-1 psql -U buku_migrator -d buku_directory
SET buku.actor = 'me: raising the user shard limit';   -- shows up in registry.changes
UPDATE registry.shards SET row_limit = 20000000 WHERE entity = 'user' AND region = 0 AND shard_no = 1;
SELECT * FROM registry.add_shard('user', 0::smallint);   -- one more ready shard
```

### Change a shard family's schema (user or business shard)

Every shard of a family has the same schema: `packages/database/prisma/user/` or
`prisma/business/` (with `prisma.user.config.ts` / `prisma.business.config.ts`; the commands
below use the user family). Edit `schema.prisma`, then write the migration from the difference
against a shard that is up to date:

```bash
cd packages/database
pnpm exec prisma migrate diff --config prisma.user.config.ts --from-config-datasource \
  --to-schema prisma/user/schema.prisma --script > /tmp/change.sql   # read it
mkdir prisma/user/migrations/<timestamp>_<what> && mv /tmp/change.sql prisma/user/migrations/<timestamp>_<what>/migration.sql
pnpm db:generate && pnpm db:shards   # every shard, ready ones included, gets it
```

Partitioned tables are declared `PARTITION BY RANGE` by hand in the migration and handed to
`pg_partman` (`partman.create_parent`); a plain index Prisma doesn't know about must be in the
schema (`@@index`), or the drift check fails (partial indexes, checks and exclusions live only in
the SQL). Grant new tables to `buku_app` in the migration: shard databases grant nothing by
default (DB-023).

On a **business shard**, a new table that holds a business's rows gets `business_id`, a
composite foreign key to its parent's `(id, business_id)`, and the two row-level security
policies (`one_business`, `all_businesses`; copy them from the first migration); a test fails
otherwise. Nothing may point into a time-partitioned table with a foreign key (DB-024). Code that
reads or writes a business shard does it inside a transaction scoped to the business:

```ts
await shard.$transaction(async (tx) => {
  await forBusiness(tx, businessId); // SET LOCAL buku.business_id: other businesses vanish
  return tx.appointment.findMany({ where: { startAt: { gte: from, lt: to } } });
});
```

### Give a service access to a table

Every service signs in to Postgres as its own role (D-092). A new table is usable by no service
until it is added to `packages/database/src/access.ts`: the owning service under `owns`, others
under `reads` (whole table or listed columns) or, rarely, `updates`/`inserts`/`deletes`. Then
`pnpm test` (checks every table has an owner) and
`docker compose -f docker-compose.dev.yml up -d --force-recreate db-access` (applies the roles).
A "permission denied" in a service's log means the map is missing something; find which with
`docker logs buku-postgres-1 2>&1 | grep -A1 "permission denied"`. Triggers run with the rights
of whoever fired them: a trigger function that writes another service's table is made
`SECURITY DEFINER` in its migration. Rights in the directory are the same for every service
(`DIRECTORY_ACCESS`: read the registry, lease ID generators, place rows); who may place which
family is the `placed_by` column of `registry.entities`, not code.

**Database v2** has a map per kind of database in the same file: `USER_SHARD_ACCESS`,
`BUSINESS_SHARD_ACCESS`, `CATALOG_ACCESS`, and `DIRECTORY_REFERENCE_ACCESS` for the reference data
a service edits. A new table goes in its family's map (or its `…_NOT_WRITTEN` list, with why);
`pnpm test` checks every table is covered and every name exists. `apply-access` applies it to
every shard in the registry. On a business shard, work across businesses runs in a transaction
that calls `forAllBusinesses(tx, '<service>')` (the service's `buku_svc_<name>_all` role; only
services in `CROSS_BUSINESS` have one); everything else calls `forBusiness(tx, id)` first.

### Use a new Valkey key

Each service signs in to Valkey as its own user and may touch only the key prefixes on its line
in `infrastructure/valkey/access.acl` (D-092); every service may read `auth:rev:*`, only auth
writes it. A new prefix (or a new rate limit's `keyPrefix`) goes on the service's line; `pnpm
test` checks the code against the list, and restarting Valkey applies it. "NOPERM" in a service's
log means the line is missing something. Tools from this machine use the admin
(`VALKEY_PASSWORD`).

### Add a Kafka topic

Add it to `TOPIC_SPECS` in `packages/kafka/src/topics.ts`, then `pnpm kafka:topics`
(or restart the stack). Never use raw topic strings in code — use `TOPICS.X`.

Then say who publishes and who reads it in `infrastructure/kafka/access.conf` (D-092): each
service signs in to Kafka as its own user and may use only the topics listed there (`pnpm test`
checks the list against the code). Restarting the stack applies it (the `kafka-access` job). A
service's log saying "Topic authorization failed" means the list is missing something. From this
machine, tools sign in as `buku-admin` with `KAFKA_PASSWORD_ADMIN` from `.env`.

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
checkouts against Paddle's sandbox (test cards, no real money) — tested end to end in D3g.1:

1. **Account:** a free account at **sandbox-vendors.paddle.com**. Skip its "create your catalog"
   step: BUKU creates its own products and prices (step 6), linked to its records.
2. **API key** (_Developer tools → Authentication → API keys → New_): tick **Write** on exactly
   five permissions — **Customer portal sessions, Prices, Products, Subscriptions, Transactions** —
   and nothing else (no customers, addresses or payment methods: a leaked key can't read people's
   details). Set an expiry (90 days) and mark it rotatable. Paddle shows it once.
3. **Client-side token** (_same page → Client-side tokens_): public by design (the browser uses it).
4. **`.env`** (never in the repo or a chat): `PADDLE_API_KEY=pdl_sdbx_apikey_…`,
   `PADDLE_CLIENT_TOKEN=test_…`, `PADDLE_TAX_CATEGORY=saas` (BUKU sells hosted software; use
   `standard` if Paddle hasn't allowed SaaS on the account). The three keys go in together or not
   at all: billing-service refuses to start with only some of them.
5. **Notifications** need a public HTTPS address. Never tunnel the gateway itself — that would put
   the whole development stack on the internet, including the development sign-in, which needs no
   password. Run the relay, which forwards only `POST /v1/billing/webhooks/paddle`, and point the
   tunnel at it:

   ```bash
   pnpm exec tsx scripts/paddle-webhook-relay.ts                          # 127.0.0.1:8099
   cloudflared tunnel --no-autoupdate --url http://127.0.0.1:8099         # prints https://….trycloudflare.com
   ```

   Use an official `cloudflared` release, checked against its published SHA-256. Then in
   _Developer tools → Notifications → New destination_: URL `https://<tunnel>/v1/billing/webhooks/paddle`,
   usage "platform and simulation", events **all `subscription.*`** (nothing else). Copy its
   **secret key** (`pdl_ntfset_…`, not the destination's `ntfset_…` ID) into
   `PADDLE_WEBHOOK_SECRET`, and restart billing:
   `docker compose -f docker-compose.dev.yml up -d --no-deps --force-recreate billing-service`.
   A quick tunnel's address changes each time it starts: update the destination when it does.

6. **Link the prices** (as a super admin): `POST /v1/admin/billing/prices/:id/sync-paddle` for each
   business plan's web price (creates the product with the tax category, and the price). Repeat
   after every price change.
7. **Checkout domain:** _Checkout → Website approval_: add the website's domain
   (`https://thebuku.vercel.app`); then _Checkout settings → Default payment link_:
   `https://thebuku.vercel.app/checkout` (Paddle refuses `localhost`). Until the website has that
   page (D3i), open a payment on the local test page instead —
   `pnpm exec tsx scripts/paddle-sandbox-checkout.ts`, then
   `http://localhost:8098/checkout?_ptxn=<transactionId from the checkout response>`.
8. **Switch billing on for businesses** while testing: `PUT /v1/admin/billing/settings/business
{ "enabled": true }` (customers are free and can't be charged, D-101). Pay with the test card
   `4242 4242 4242 4242`, any future expiry, CVC `100`. Then try cancel, undo, a plan change and
   the card portal (`/v1/businesses/:id/billing/subscription/…`).
9. **Afterwards:** stop the tunnel, the relay and the test page, and switch business billing off
   again (otherwise every demo shop is held to the Starter plan's limits).

Never put the API key or webhook secret in the web or mobile app — only the client-side token.
For going live: a live Paddle account, BUKU's own domain approved (Paddle may not accept a
`vercel.app` address for live payments), the website's checkout page (D3i) and live keys.

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
5. _WhatsApp → Configuration → Webhook_: URL `https://<public address>/v1/webhooks/whatsapp`, the
   verify token, and subscribe to **messages**. Locally, don't tunnel the whole gateway (it would
   expose the development sign-in); a relay that forwards only the WhatsApp webhook, like Paddle's
   (step 5 above), is still to be written.
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

| Symptom                                                                | Cause / fix                                                                                                                                                 |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env` errors: `... run pnpm bootstrap`                                | Secrets missing. `pnpm bootstrap` fills only empty values; it never overwrites.                                                                             |
| Elasticsearch exits / unhealthy                                        | `vm.max_map_count` too low — see setup above. Needs ~1.3 GB RAM.                                                                                            |
| A service is `unhealthy`                                               | `docker compose -f docker-compose.dev.yml logs <svc>`; its `/ready` lists which dependency is down. Config errors print every invalid variable at startup.  |
| `504` from the gateway right after a restart                           | Kong DNS cache; resolved within 5 s (`KONG_DNS_VALID_TTL`).                                                                                                 |
| `ERR_PNPM_NO_MATURE_MATCHING_VERSION`                                  | Supply-chain guard: that version is < 24 h old. Pick the previous version or wait.                                                                          |
| `ERR_PNPM_...BUILD` for a new dependency                               | It wants to run an install script. Review it, then add it to `allowBuilds` in `pnpm-workspace.yaml` with a comment.                                         |
| Prisma: "Environment variable not found" on the host                   | Run from the repo root after `pnpm bootstrap`; `prisma.config.ts` reads the root `.env`.                                                                    |
| Out of memory in WSL                                                   | Give WSL ≥ 8 GB in `%UserProfile%\.wslconfig` (`[wsl2]\nmemory=8GB`), don't run `--profile tools` unless needed.                                            |
| Port already in use                                                    | Another local Postgres/Redis? Stop it, or change `POSTGRES_HOST_PORT` in `.env`.                                                                            |
| After a Windows/WSL restart: Kong `Exited (127)`, services `unhealthy` | Docker started the containers before WSL's files were mounted. `docker compose -f docker-compose.dev.yml up -d --force-recreate` (data is kept).            |
| Host tools get `Connection terminated unexpectedly`                    | After a restart the port forwarder can drop every host connection while the containers look healthy. Same fix: recreate the stack.                          |
| `database "buku_directory" does not exist` (tests, Prisma)             | The directory is created by `pnpm db:prepare` (the `db-prepare` container does it on `pnpm dev`). Run it once on a stack created before D1.                 |
| `BUKU_REPLICATOR_PASSWORD must be 16-128 letters…` (db:prepare)        | Added in D2c, for copying reference data. `pnpm bootstrap` adds it to `.env` without touching anything else.                                                |
| A reference copy stopped following changes                             | `pnpm db:shards` refreshes every subscription. To drop a database that has one, use `dropDatabase` (src/provision.ts): it removes the replication slot too. |
| `BUKU_DB_CLUSTER_LOCAL_1 is not set`                                   | The local cluster's address (added in D2a). `pnpm bootstrap` adds it to `.env` without touching anything else.                                              |
| Start completely fresh                                                 | `pnpm dev:wipe && pnpm dev`                                                                                                                                 |

## Releases (Phase 5)

`pnpm changeset version` bumps versions and writes changelogs; the merge to `main` is tagged
`v<major>.<minor>.<patch>`. Rollbacks always target a git tag (never a guessed image tag).
