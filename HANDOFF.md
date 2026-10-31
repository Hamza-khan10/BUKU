# BUKU — Handoff

The state of the whole project in one place: what is built, how it is run and worked on, where
things stand on GitHub, and what comes next. Last updated **2026-11-01**.

Deeper detail lives in the docs this page points to — [BUILD_GUIDE](docs/BUILD_GUIDE.md) (the
phase plan and status), [DECISIONS](docs/DECISIONS.md) (every decision, D-001 → D-131),
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

| Phase  | What                                                                                 | Status                                          |
| ------ | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| 1      | Foundation: monorepo, shared packages, events, infrastructure, security baseline, CI | ✅ done                                         |
| 2      | Backend services, ending with a SOC 2 compliance review                              | ✅ built (2.0–2.10); ads and analytics deferred |
| 3      | Web app (Next.js) and admin app                                                      | ▶ 3.5 a–g and 3.6 a–e done                      |
| **3D** | **Database v2** — built for hundreds of millions of people                           | ✅ **D1–D4 built and on `main`**; D5 later      |
| 4      | Mobile app (Expo)                                                                    | planned                                         |
| 5      | Production: deployment, observability, backups, load and security testing            | planned                                         |

### Database v2 (the current work)

Why: the first database could not grow to the scale BUKU is aiming for, so it is being rebuilt
before more website work (D-105). The new design: a **directory** database (where every person and
business lives, global look-ups, reference data), **user shards** (everything that is one
person's), **business shards** (everything that is one business's, with row-level security by
business), and a search **catalog**. IDs are 64-bit numbers from a leased generator; people,
businesses and appointments are shown to the outside world by **public IDs** (12 characters,
DB-042).

| Step  | What                                                                                                                                                         | Status       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| D1    | Foundation: directory, ID generator, shard registry                                                                                                          | ✅           |
| D2a–e | The new schema: user shard, business shard, replicated reference data and the catalog, each service's rights everywhere, development data                    | ✅ on `main` |
| D3a   | The services' foundation: `DataPlane` (routing, transactions per business, handles, IDs), v2 events                                                          | ✅           |
| D3b   | auth-service on v2                                                                                                                                           | ✅           |
| D3c   | business-service on v2                                                                                                                                       | ✅           |
| D3d   | booking-service on v2 (the customer's time claimed first; one booking for one slot, proven by a same-instant test)                                           | ✅           |
| D3e   | queue-service on v2 (one queue at a time, kept on the person's shard)                                                                                        | ✅           |
| D3f   | notification-service on v2 (inbox and marks per person; WhatsApp numbers as handles)                                                                         | ✅           |
| D3g   | billing-service on v2 (catalog on the directory; one live subscription per business)                                                                         | ✅           |
| D3g.1 | **Paddle sandbox connected and a real test payment made end to end**                                                                                         | ✅           |
| D3h   | search on v2: the catalog kept from every shard's events, newer wins, an hourly sweep (D-120); ads starts on v2                                              | ✅           |
| D3i   | website on public IDs, acceptance and browser tests on v2, the checkout page, ID leases that recover (D-121)                                                 | ✅           |
| D3j   | the old database left the stack (D-122); next, one PR brings everything to `main`                                                                            | ✅           |
| D4    | backups with point-in-time recovery and the restore drill (D4a, D-123); TLS 1.3 on every connection (D4b, D-124); break-glass and health checks (D4c, D-125) | ✅           |
| D5    | proof at scale (10M people, 1M businesses, 200M appointments)                                                                                                | planned      |

D3 and D4 were built on the integration branch **`feat/db-v2-services`** (D-112), one reviewed
pull request per slice, and came to `main` in one pull request on 2026-10-31 (#160, squashed:
`main` keeps a linear history). Each slice's own commit stays on `feat/db-v2-services` and in its
pull request (#122 → #159). `main` is the branch the live website deploys from (the API isn't
deployed yet, Phase 5).

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

- **Website** (`apps/web`, live at `thebuku.vercel.app` from `main`, on database v2): public site,
  business pages, explore and categories, pricing, sign-in (including employees and two-step),
  booking, visits and tickets, the walk-in queue, reviews, notifications, account settings and
  data; the checkout page for payments; the business area — adding a business, today,
  appointments, check-in, the queue board and the waiting-room screen, services and team, opening
  hours, closed days, people's time off and extra hours, and attendance. Still to build: the rest
  of the business area (calendar, reviews, insights, billing, settings), the rest of the operator
  console, and polish.
- **Admin app** (`apps/admin`, D-091, D-128, D-131: BUKU's palette and fonts, made to be watched for hours): an operator console — the overview (system status
  from Prometheus, what's waiting for a decision, what's switched off), businesses (verify, reject,
  suspend, reinstate), reports, **accounts** (find one person; suspend, reinstate or sign out
  everywhere, D-130), monitoring (targets, alerts, the database's checks, links to Grafana),
  **emergency switches** (turn sign-ups, signing in, bookings, queues, payments, uploads, reviews
  or business registration off at once, D-129) and the access review. The audit and security view
  and the rest of 3.6 (review moderation, billing, notification settings) come next.
- **Monitoring** (D-127, `pnpm dev:monitoring`): Prometheus reads every service, the gateway and
  the database's checks; Grafana (localhost:3300) has four dashboards: platform, security, gateway
  and database.

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

## 5. GitHub today (2026-11-01)

- `main`: database v2 (D1–D4, #160), the checkout page working without the API (#161),
  lucide-react 1.63.0 (#152), the queue board (3.5c, #162), services waiting for the database at
  start (#163), opening hours (3.5e, #164), time off (3.5f, #165), attendance (3.5g, #166) and
  monitoring (3.6a, #167), the operator console (3.6b, #168), emergency switches (3.6c, #169) and accounts (3.6d, #170); 0 Dependabot and 0 secret-scanning alerts; no open issues. The live
  website runs **Next.js 16.4.2**.
- **Open:** the console redrawn (3.6e, D-131).
- **GitGuardian** flagged `PGPASSWORD: ${POSTGRES_SUPERUSER_PASSWORD:?…}` in
  `docker-compose.dev.yml` on #167: a reference to a variable, not a secret. It isn't a required
  check; the owner marks it as a false positive in GitGuardian.
- **Code scanning: 26 open warnings, `js/missing-rate-limiting`**, raised on `main` by #160. They
  are the same false positive as the 93 dismissed on 2026-10-04: the routes are limited by
  express-rate-limit per address before every route (`packages/common/src/http/app.ts`, D-086),
  most also by a route limiter, and Kong. CodeQL can't follow routes registered through the
  routes callback; the v2 rewrite changed those lines, so it raised them again. Dismissing needs
  the owner (the command is in the session note of 2026-10-31).
- `feat/db-v2-services` is done: every slice D3a → D4c is on `main`.
- **Branches:** 40 on GitHub belong to merged or closed PRs whose last commit is the PR's (safe to
  delete; deleting needs the owner, see the session note of 2026-10-31), plus `feat/db-v2-d4c`,
  `feat/db-v2-services` and `fix/web-checkout-without-api` now; two more
  (`feat/categories-and-motion`, `feat/redesign-foundation`) have commits after their PR and stay.

## 6. What's next

1. **Website, Phase 3.5 → 3.7**, on database v2. Done in 3.5, the business area: 3.5a (adding a
   business), 3.5b (today, appointments, check-in), 3.5c (the queue board and the waiting-room
   screen, D-126), 3.5d (services and team), 3.5e (opening hours and closed days), 3.5f (people's
   time off and extra hours) and 3.5g (attendance). Still to build (WEB_PLAN §7): the calendar,
   reviews, insights, billing and settings. In 3.6, the operator console: 3.6a monitoring
   (Prometheus and Grafana, D-127), 3.6b the console itself (D-128), 3.6c emergency switches
   (D-129), 3.6d accounts (D-130) and 3.6e the console redrawn (D-131) are done; next, the audit and security view, then review
   moderation, billing and notification settings in the console. Then 3.7, polish and proof.
2. **D5** — proof at scale (10M people, 1M businesses, 200M appointments) on a test cluster; the
   slow-query review.
3. **Phase 5** — production: deployment, PgBouncer, the standby and a second region, backups to
   object storage with a schedule, the health checks under Prometheus.

### Follow-ups noted along the way

- Emergency switches: a Prometheus gauge of which are off (Grafana shows only the flips today), and
  an alert when one stays off for hours.
- WhatsApp setup needs a webhook-only relay like Paddle's, so testing never exposes the dev stack.
- Paddle going live: own domain, live account, live keys; rotate the sandbox key before January 2027.
- ID leases are renewed through each service's ordinary pool: under heavy load renewals can wait
  behind requests. A connection of their own would keep them on time (they now recover either way).
- Prisma 7.10 runs some reads side by side inside one transaction, which `pg` warns will stop
  working in pg 9: stay on pg 8 until Prisma changes it. booking's cancellation report does the
  same on purpose (seven reads at once in one transaction) and should read one after another.
