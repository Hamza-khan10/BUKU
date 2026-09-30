# BUKU Build Guide — phase by phase

This is the master plan. It says **what gets built, in what order, and how we
know each brick is solid** before the next one goes on top. The original product
spec is kept at the repository root (`Buku-platformd-developement-guide.md`);
where this guide deviates from it, the reason is in [DECISIONS.md](DECISIONS.md).

> **Rule for every phase:** a phase is done only when its acceptance script is
> green. Nothing in a later phase is allowed to work around a broken brick in an
> earlier one — we fix the brick.

| Phase | Scope                                                                                          | Status                              |
| ----- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1     | Foundation: monorepo, shared packages, database, events, infrastructure, security baseline, CI | ✅ **Done** — `pnpm verify` → 34/34 |
| 2     | Backend services (MVP core first)                                                              | 🚧 In progress                      |
| 3     | Web app (Next.js): public site, booking, user + business dashboards, admin                     | Planned                             |
| 4     | Mobile app (Expo, iOS + Android)                                                               | Planned                             |
| 5     | Production: deployment, observability, backups, load + security testing                        | Planned                             |

---

## Phase 1 — Foundation ✅

**Goal:** every later feature is built on bricks that are already correct,
secure and tested, so Phase 2 is _only_ business logic.

### What was built (and why each brick matters)

| #   | Brick               | Where                                                              | What it guarantees                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Monorepo tooling    | root                                                               | pnpm 12 workspaces with supply-chain protection (install scripts blocked unless allow-listed, packages < 24 h old refused), TypeScript 6 strict, ESLint (type-aware), Prettier, Vitest                                                                                                                                                                             |
| 2   | Git guardrails      | `.husky/`, `commitlint.config.js`, `.gitleaks.toml`, `.changeset/` | Secret scan blocks commits containing keys; Conventional Commits enforced; pre-push typecheck + tests; Changesets for versioning                                                                                                                                                                                                                                   |
| 3   | CI pipeline         | `.github/workflows/ci.yml`                                         | Lint, typecheck, unit + integration tests, migration-drift check, dependency audit, gitleaks over full history, production image build for all 7 services. Actions pinned to commit SHAs                                                                                                                                                                           |
| 4   | `@buku/common`      | `packages/common`                                                  | One HTTP app factory (security headers, request ids, structured logs with PII redaction, metrics, health/readiness, graceful shutdown), error envelope, Zod validation with mass-assignment protection, RS256 JWT with key rotation, Argon2id passwords, AES-256-GCM field encryption with key rotation + blind indexes, rate limiting, webhook signatures, UUIDv7 |
| 5   | `@buku/database`    | `packages/database`                                                | 35 tables (the spec's 28 + 7 it needed but never defined). The database itself enforces: **no double booking** (exclusion constraints), 60+ CHECK constraints, one live queue ticket per user, triggers for geo/full-text/ratings, monthly partitions for event tables, least-privilege roles                                                                      |
| 6   | `@buku/kafka`       | `packages/kafka`                                                   | Topic registry (41 topics, single source of truth), validated event envelope, idempotent producer (acks=all), consumer with retry → dead-letter queue, **transactional outbox** (no lost events), `processOnce` idempotency ledger                                                                                                                                 |
| 7   | 7 service skeletons | `services/*`                                                       | Each boots with validated config, verifies its JWT keys, connects its dependencies, reports readiness, shuts down gracefully                                                                                                                                                                                                                                       |
| 8   | Local stack         | `docker-compose.dev.yml`                                           | 19 containers; everything bound to localhost; services reachable only through the gateway; non-root, read-only containers; per-service secrets                                                                                                                                                                                                                     |
| 9   | Data stores         | `docker/postgres`, `infrastructure/*`                              | Postgres 17 + PostGIS + pgvector, Valkey, Kafka 4.3 (KRaft), Elasticsearch 9 (versioned index + alias), ClickHouse 26.3 LTS, S3-compatible storage, Mailpit                                                                                                                                                                                                        |
| 10  | API gateway         | `infrastructure/kong/kong.yml`                                     | Routing, CORS allow-list, Valkey-backed rate limits, size limits, correlation ids, internal endpoints never exposed                                                                                                                                                                                                                                                |
| 11  | Production image    | `docker/node/Dockerfile`                                           | Distroless, non-root, read-only, 349 MB, refuses dev secrets in production, proven to boot and shut down cleanly                                                                                                                                                                                                                                                   |
| 12  | Seed data           | `packages/database/prisma/seed.ts`                                 | 20 businesses in 4 cities, 71 users (PII encrypted), 200 constraint-respecting appointments, reviews, queues                                                                                                                                                                                                                                                       |

### Acceptance (all green)

```bash
pnpm dev        # start the stack
pnpm health     # every component ✔
pnpm verify     # 34 checks: code quality, DB guarantees, Kafka, gateway, security baseline, 89 tests
```

Highlights proven by tests against the real database:
10 simultaneous bookings for one slot → exactly 1 succeeds · the app DB role
cannot DROP/ALTER/TRUNCATE · forged/expired/`alg:none`/HS256-confused JWTs are
rejected · a failed Kafka handler lands in the DLQ after retries · a rolled-back
transaction never emits its event.

---

## Phase 2 — Backend services 🚧

MVP scope and rules were decided on 2026-09-30 (see "Product decisions" at the
end of this guide and DECISIONS D-028 → D-041). Order matters: each step only
depends on the steps above it.

**Every endpoint, in every step, must have:** Zod-validated input (unknown
fields rejected) · an ownership/authorization check with a test proving
another user or business is denied · rate limits where abuse is possible ·
an audit-log entry for security-relevant actions · events via the outbox ·
unit + integration tests for the success path and the attack path · an
updated `docs/API_REFERENCE.md` (generated from the same Zod schemas).

### 2.0 Kickoff ✅

Decisions recorded; Elasticsearch, ClickHouse, analytics and ads moved to
opt-in compose profiles (search runs on Postgres); **database rule: one
customer can never hold two overlapping active appointments, even at two
different businesses**.

### 2.1 Auth service

1. Google sign-in (ID token verified server-side against Google's keys). Apple sign-in built
   behind a feature flag, **locked** until the Apple Developer account exists.
2. Sessions that last **until the user logs out**: rotating refresh tokens with theft
   detection (reuse of an old token revokes that device's session), a long inactivity
   timeout, a device/session list, "log out this device" and "log out all devices".
3. Password change (business sub-accounts) → every session on every device revoked; clients
   receive `SESSION_REVOKED` with reason `password_changed` to show "sign in again".
4. Profile: name, timezone, locale; **phone number required after sign-up** (for WhatsApp
   notifications, with explicit WhatsApp opt-in); push tokens.
5. Data requests: export my data, delete my account (the self-service "my data" section).
6. Development-only sign-in (hard-disabled in production) so the rest of Phase 2 and the web
   app can be built without real Google/Apple credentials.
7. Audit log; `users.*` events; Kong validates tokens at the gateway too.

### 2.2 Business service (new)

Business onboarding with a **country-flexible legal profile (KYB)**: legal name, registration
type and number per country, tax id (encrypted), registered address, responsible person,
documents. Opening hours, photos and documents (direct-to-storage uploads). **Unverified
businesses can take bookings but are clearly badged "Not verified"**; "Report this business";
admin verification and suspension; audited per-country business export for lawful requests.
**Service categories** (a business groups its services), reviews + owner replies, favourites.

**Business sub-accounts (AWS-IAM-style):** the owner creates accounts (business-scoped
username + password, forced change on first sign-in) for employees' phones and shared
tablets. Roles:

| Role       | Can do                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Owner      | Everything, including billing and deleting the business                  |
| Manager    | All appointments, staff, schedules, settings                             |
| Front desk | All appointments and the live queue (shared tablets); no settings        |
| Staff      | Own schedule, own working hours/time off, own appointments; check-in/out |

### 2.3 Booking service

Services (in categories), staff ↔ services, working hours per employee (editable by the
employee), time off, availability engine in the business's timezone. Check-in/check-out
records attendance and marks who is present for the live queue and walk-ins (bookable slots
come from working hours). Booking rules:

- **Sign-in required**; no guest bookings. Free-trial / subscription entitlement checked (2.5).
- **One customer cannot hold overlapping appointments anywhere** (enforced by the database).
- Booking horizon set by each business (default 12 months, no platform limit); at most
  3 future bookings per customer per business (anti-hoarding). While choosing a time, the
  customer sees their own existing bookings.
- "Any staff" → the least-booked eligible employee that day.
- Confirmation mode per business: automatic (default) or manual approval.
- Cancellation: customer cancels outside the business's window (default 12 h) → no rating
  impact; picks a reason (feeds the business's cancellation chart); "I'll book later" →
  reminder notification a few days later. Last-minute cancel / no-show → small impact on the
  customer's reliability score. Business cancelling → impact on the business's reliability.

### 2.4 Queue service

Remote (virtual) queue joining, allowed only **within a distance set by the business
(default 5 km)** and **one active queue per customer**. Live positions over WebSocket.
Alerts when 10 ahead, 5 ahead, then at every step. Called and not present after the grace
period (5 min) → no-show (reliability impact). Walk-ins added by front desk.

### 2.5 Billing service (Paddle, sandbox during development)

Customer entitlement: **1 free appointment or queue join, then a monthly subscription**
(price is configuration, not code — $1.99 today, likely $2.99–3.99 after tax review).
Paddle checkout, signature-verified idempotent webhooks, entitlement checks used by booking
and queue. Business plans come later.

### 2.6 Notification service

Push (free) for every alert; WhatsApp for important transactional messages once the provider
is connected; email for receipts. Preferences, in-app inbox, templates, provider switch
(dev: logged only).

### 2.7 Search service (Postgres)

Text + location search, nearby, autocomplete, categories, ranking that includes rating and
reliability. Elasticsearch implementation kept for later (`SEARCH_ENGINE=elasticsearch`).

### 2.8 Reputation

Customer reliability score (visible to the customer; businesses see a simple summary such as
"shows up 95%"), business reliability figure next to its star rating, cancellation analytics.

### 2.9 Phase 2 acceptance

End-to-end: sign in → add phone → trial booking → confirm → reminder → complete → review;
subscribe → second booking; queue join (distance + one-queue rule) → called → served.
Concurrency tests; authorization tests on every route.

**Deferred (built later on the same foundation):** ads, ClickHouse analytics, outgoing
webhooks, business pricing plans, AI receptionist, Elasticsearch search, mobile app (Phase 4).

---

## Phase 3 — Web app (Next.js)

Structure & design system → landing page → auth pages → search & business profile (SSR, SEO, JSON-LD)
→ booking flow → user dashboard → business dashboard (calendar, queue screen, services, staff,
availability, bookings, reviews, settings) → admin panel → legal pages → Playwright E2E.
Security: httpOnly SameSite cookies for the refresh token, strict CSP with nonces, no tokens in
localStorage. Branding stays swappable (single `Logo` component + design tokens).

## Phase 4 — Mobile app (Expo)

Expo Router structure → onboarding & auth (secure-store for tokens) → discovery & search (maps) →
business profile & booking → live queue tracker (Socket.IO) → notifications & deep links → reviews →
EAS builds for iOS and Android.

## Phase 5 — Production readiness

Deployment topology (see open question 4) → Terraform for DigitalOcean → TLS, nginx, security headers
→ secrets management → monitoring (Prometheus, Grafana, Loki, alerts) → backups + restore drills →
load tests (k6) → security review & penetration test → runbooks → go-live checklist.

---

## Product decisions (2026-09-30)

Recorded from the product owner; rationale for each is in DECISIONS.md.

| Topic        | Decision                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services     | Add `business-service` and `billing-service`; outgoing webhooks (later) live in notification-service                                                                                           |
| Sign-in      | Google now; Apple built but locked until the Apple Developer account; business sub-accounts use username + password; SMS/Twilio later                                                          |
| Sessions     | Signed in until logout; password change logs out every device with a clear "sign in again" message                                                                                             |
| Guests       | No guest bookings                                                                                                                                                                              |
| Monetisation | Customers: 1 free booking or queue join, then a monthly subscription (price configurable; $1.99 → likely $2.99–3.99). Businesses: pricing later. Appointments themselves are paid at the venue |
| Market       | Pakistan first, built for worldwide from day one                                                                                                                                               |
| Language     | English first; more languages by user majority                                                                                                                                                 |
| Verification | Unverified businesses may take bookings, clearly badged; detailed country-flexible business details                                                                                            |
| Teams        | AWS-style sub-accounts with Owner / Manager / Front desk / Staff roles                                                                                                                         |
| Reputation   | Two-way: customer reliability (no-shows, last-minute cancels) and business reliability (business cancellations)                                                                                |
| Scheduling   | No overlapping appointments per customer across businesses; business-set booking horizon; 3 future bookings per customer per business                                                          |
| Queue        | Remote join within a business-set distance (default 5 km); one active queue per customer; alerts at 10, 5, then every step                                                                     |
| Data rights  | Self-service section for customers and businesses to export or delete their data                                                                                                               |
| Hosting      | Web app on Vercel (thebuku.vercel.app) until a domain is bought; backend on DigitalOcean (lean: droplet + managed Postgres/Valkey)                                                             |
| Search       | Postgres first; Elasticsearch kept, not running                                                                                                                                                |

**Still open:** SMS/WhatsApp provider choice and cost (before launch) · AI receptionist
specification · app-store in-app-purchase rules for the subscription (Phase 4) · lawyer review
of legal pages and of the process for government data requests.
