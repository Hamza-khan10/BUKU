# BUKU — Handoff

The state of the whole project in one place: what is built, how it is run and worked on, where
things stand on GitHub, and what comes next. Last updated **2026-10-27**.

Deeper detail lives in the docs this page points to — [BUILD_GUIDE](docs/BUILD_GUIDE.md) (the
phase plan and status), [DECISIONS](docs/DECISIONS.md) (every decision, D-001 → D-119),
[DATABASE](docs/DATABASE.md) (database v2), [ARCHITECTURE](docs/ARCHITECTURE.md),
[SECURITY](docs/SECURITY.md), [API_REFERENCE](docs/API_REFERENCE.md),
[DEVELOPMENT](docs/DEVELOPMENT.md) (setting up and running) and [WEB_PLAN](docs/WEB_PLAN.md).

---

## 1. What BUKU is

A marketplace for booking appointments and joining virtual queues, Pakistan first. Customers find a
business, book a time or join its queue from their phone, and get reminders; businesses run their
day (bookings, check-in, the queue, staff, services) and pay for a plan. **Customers use BUKU for
free** (D-101); businesses pay (Starter free, Essential, Professional, Enterprise).

## 2. Where everything stands

| Phase  | What                                                                                 | Status                                           |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1      | Foundation: monorepo, shared packages, events, infrastructure, security baseline, CI | ✅ done                                          |
| 2      | Backend services, ending with a SOC 2 compliance review                              | ✅ built (2.0–2.10); ads and analytics deferred  |
| 3      | Web app (Next.js) and admin app                                                      | ⏸ paused at 3.5 for the database rebuild (D-105) |
| **3D** | **Database v2** — built for hundreds of millions of people                           | 🚧 **D1, D2 done; D3 a–i done; D3j next**        |
| 4      | Mobile app (Expo)                                                                    | planned                                          |
| 5      | Production: deployment, observability, backups, load and security testing            | planned                                          |

### Database v2 (the current work)

Why: the first database could not grow to the scale BUKU is aiming for, so it is being rebuilt
before more website work (D-105). The new design: a **directory** database (where every person and
business lives, global look-ups, reference data), **user shards** (everything that is one
person's), **business shards** (everything that is one business's, with row-level security by
business), and a search **catalog**. IDs are 64-bit numbers from a leased generator; people,
businesses and appointments are shown to the outside world by **public IDs** (12 characters,
DB-042).

| Step    | What                                                                                                                                      | Status       |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| D1      | Foundation: directory, ID generator, shard registry                                                                                       | ✅           |
| D2a–e   | The new schema: user shard, business shard, replicated reference data and the catalog, each service's rights everywhere, development data | ✅ on `main` |
| D3a     | The services' foundation: `DataPlane` (routing, transactions per business, handles, IDs), v2 events                                       | ✅           |
| D3b     | auth-service on v2                                                                                                                        | ✅           |
| D3c     | business-service on v2                                                                                                                    | ✅           |
| D3d     | booking-service on v2 (the customer's time claimed first; one booking for one slot, proven by a same-instant test)                        | ✅           |
| D3e     | queue-service on v2 (one queue at a time, kept on the person's shard)                                                                     | ✅           |
| D3f     | notification-service on v2 (inbox and marks per person; WhatsApp numbers as handles)                                                      | ✅           |
| D3g     | billing-service on v2 (catalog on the directory; one live subscription per business)                                                      | ✅           |
| D3g.1   | **Paddle sandbox connected and a real test payment made end to end**                                                                      | ✅           |
| D3h     | search on v2: the catalog kept from every shard's events, newer wins, an hourly sweep (D-120); ads starts on v2                           | ✅           |
| D3i     | website on public IDs, acceptance and browser tests on v2, the checkout page, ID leases that recover (D-121)                              | ✅           |
| **D3j** | the old database leaves the stack; then one PR brings everything to `main`                                                                | **next**     |
| D4      | backups, a tested point-in-time restore, TLS, monitoring                                                                                  | planned      |
| D5      | proof at scale (10M people, 1M businesses, 200M appointments)                                                                             | planned      |

All D3 work lives on the integration branch **`feat/db-v2-services`** (D-112); `main` and the live
website stay on the old database until D3 is complete.

### Services

| Service        | What it does                                                                                                                 | Database |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| auth           | sign-up and sign-in (Google, development sign-in), sessions, two-step sign-in, employee logins, account erasure, data export | v2       |
| business       | businesses, profiles, photos, documents, verification, reports, kinds of business                                            | v2       |
| booking        | menu, staff, schedules, availability, appointments, check-in, shifts, reviews, reliability                                   | v2       |
| queue          | daily queues, tickets, the front desk, live screens (server-sent events)                                                     | v2       |
| notification   | inbox, push, email, WhatsApp, reminders, suggestions                                                                         | v2       |
| billing        | plans and prices, trials, grants, plan requests, Paddle payments                                                             | v2       |
| search         | search, near me, categories, cities: one query over the catalog, kept from every business shard's events                     | v2       |
| ads, analytics | not built yet (opt-in profiles); ads already starts on v2 with the catalog, analytics uses ClickHouse only                   | —        |

### Web and admin apps

- **Website** (`apps/web`, live at `thebuku.vercel.app`, on the old database): public site,
  business pages, explore and categories, pricing, sign-in (including employees and two-step),
  booking, visits and tickets, the walk-in queue, reviews, notifications, account settings and
  data; the business area — adding a business, today, appointments, check-in, services and team.
  Still to build: the rest of the business area (calendar, queue board and screen, hours, reviews,
  insights, billing, settings), the checkout page for payments, the operator console, and polish.
- **Admin app** (`apps/admin`, D-091): sign-in and two-step only so far; operator tools come with
  3.6.

### Payments (Paddle)

- Paddle is the merchant of record (it collects payment and sales tax); BUKU never sees cards (D-069).
- The owner's **sandbox** account is connected (D3g.1, D-119). A real sandbox payment went through:
  the demo shop paid for Essential with the test card, then cancel, undo, a switch to Professional
  and the card portal all worked.
- Plans in the sandbox: BUKU Essential $24.99/month and BUKU Professional $49.99/month, taxed as SaaS.
- The website's **checkout page** (`/checkout`, D3i) opens Paddle's checkout for the payment in
  Paddle's link; only that page may load Paddle. Locally it needs `PADDLE_CLIENT_TOKEN` and
  `PADDLE_ENVIRONMENT=sandbox` in `apps/web/.env.local` (Vercel too, for the live site).
- **Before real payments:** BUKU's own domain approved by Paddle (it may not accept a `vercel.app`
  address), a live Paddle account and live keys.

## 3. Running it

Requirements: WSL with Docker Desktop, Node 24 through nvm, pnpm 12. Every terminal command needs
nvm loaded first: `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"`.

```bash
pnpm bootstrap                 # once (safe to re-run): .env with generated secrets, dependencies, Prisma clients
pnpm dev                       # start the stack (docker compose -f docker-compose.dev.yml up -d)
pnpm health                    # every component answers
pnpm test                      # unit tests (388)
pnpm test:int                  # integration tests against the stack (399)
pnpm lint && pnpm typecheck    # what CI checks first
docker compose -f docker-compose.dev.yml stop   # stop everything, data kept
```

- The gateway is `http://localhost:8000`; the website runs separately (`pnpm --filter @buku/web dev`,
  open it on `localhost`, never `127.0.0.1`).
- Development sign-in: `POST /v1/auth/dev/login { "email": … }` — demo logins `admin@buku.dev`,
  `owner1@buku.dev`, `customer2@buku.dev` (development only; refused in production).
- Services are walled off from each other (D-092): to call one directly, run the request inside
  its own container.
- After switching branches, a service whose source mount went stale is fixed with
  `docker compose -f docker-compose.dev.yml up -d --no-deps --force-recreate <service>`. The
  gateway (Kong) waits for every service to be healthy; start it alone with `--no-deps` if needed.
- Paddle sandbox testing (webhook relay, tunnel, test checkout page): docs/DEVELOPMENT.md →
  "Set up Paddle". Switch business billing off again afterwards.

### Secrets

Only in the git-ignored `.env` (and Vercel for the website) — never in the repo, a commit or a
chat. Names: database, Kafka and Valkey passwords per service, JWT keys, PII encryption keys,
`GOOGLE_CLIENT_SECRET`, `PADDLE_API_KEY` / `PADDLE_CLIENT_TOKEN` / `PADDLE_WEBHOOK_SECRET`
(sandbox), `PADDLE_TAX_CATEGORY=saas`. The Paddle sandbox API key expires around
**16 January 2027** (it is rotatable: make a new one before then).

## 4. How work is done

- **Branches and PRs:** each slice is a branch and a PR (into `feat/db-v2-services` during D3);
  squash-merged only when the owner says "merge it", after CI is green (20 checks) with **0
  code-scanning alerts**. No force-pushes.
- **Commits:** lowercase Conventional Commits; the trailer
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR descriptions end with
  "🤖 Generated with [Claude Code](https://claude.com/claude-code)". Pre-commit hooks scan for
  secrets and hidden characters, and lint and format.
- **Every endpoint:** validated input (unknown fields refused), an ownership check with a test
  proving others are denied, rate limits, audit entries, events through the outbox, tests for the
  success and the attack path, `API_REFERENCE.md` updated.
- **After each slice:** docs (DATABASE "as built", DECISIONS, API_REFERENCE, BUILD_GUIDE), the
  memory and the BUKU Brain vault note, `buku-brain-sync`, `graphify update .`.
- **Security rules from the owner:** secrets only in `.env`; third-party tools and skills read (or,
  for a compiled tool, verified against the publisher's checksum and approved) before use; no fake
  content; anything a user types is validated against breaking the system (duplicates, malicious
  input, characters that corrupt data).

## 5. GitHub today (2026-10-27)

- `main`: CI green; 0 code-scanning, 0 Dependabot and 0 secret-scanning alerts; no open issues.
  The live website runs **Next.js 16.4.2** (#146, 2026-10-23: the 22 October remote-code-execution
  advisories were fixed from 16.4.1).
- `feat/db-v2-services`: D3a → D3i merged (last: #145 D3i, 9cc88ec), 0 code-scanning alerts.
- **12 Dependabot update PRs (#130–#140, #142)** into `main` — Playwright, axe-core,
  lucide-react, zod 4.6.7, lenis, the AWS SDK, CodeQL actions, Vitest, lint/types, Prisma, the
  distroless and Node 24.22 base images. All mergeable; they wait for the owner's go-ahead.
  `feat/db-v2-services` takes them in when `main` is merged into it before the final PR.

## 6. What's next

1. **D3j** (next) — retire the old database (and its leftover helpers); merge `main` into the
   integration branch; one PR to `main`; website work resumes (3.5 → 3.7). D3i is done (#145): the
   website on public IDs, the acceptance run (22/22) and the browser tests on database v2, the
   checkout page, and three fixes found on the way (links by public ID were a 404 at the gateway,
   "my reviews" named visits by an internal ID, a service that lost its ID lease needed a restart).
2. **D4, D5** — backups and restore drills; proof at scale.

### Follow-ups noted along the way

- WhatsApp setup needs a webhook-only relay like Paddle's, so testing never exposes the dev stack.
- Paddle going live: own domain, live account, live keys; rotate the sandbox key before January 2027.
- ID leases are renewed through each service's ordinary pool: under heavy load renewals can wait
  behind requests. A connection of their own would keep them on time (they now recover either way).
- Prisma 7.10 runs some reads side by side inside one transaction, which `pg` warns will stop
  working in pg 9: stay on pg 8 until Prisma changes it. booking's cancellation report does the
  same on purpose (seven reads at once in one transaction) and should read one after another.
