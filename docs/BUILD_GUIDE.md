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
| 2     | Backend services (MVP core first), ending with a SOC 2 compliance review                       | 🚧 In progress                      |
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
updated `docs/API_REFERENCE.md` (contracts live in each service's `routes/schemas.ts`;
OpenAPI generation from them arrives with the web app in Phase 3).

### 2.0 Kickoff ✅

Decisions recorded; Elasticsearch, ClickHouse, analytics and ads moved to
opt-in compose profiles (search runs on Postgres); **database rule: one
customer can never hold two overlapping active appointments, even at two
different businesses**.

### 2.1 Auth service ✅

1. Google sign-in (ID token verified server-side against Google's keys). Apple sign-in built
   behind a feature flag, **locked** until the Apple Developer account exists.
2. Sessions that last **until the user logs out**: rotating refresh tokens with theft
   detection (reuse of an old token revokes that device's session), a long inactivity
   timeout, a device/session list, "log out this device" and "log out all devices".
3. Password change (business sub-accounts) → every session on every device revoked; clients
   receive `SESSION_REVOKED` with reason `password_changed` to show "sign in again".
4. Profile: name, timezone, locale; **phone number required after sign-up** (for WhatsApp
   notifications, with explicit WhatsApp opt-in); push tokens.
5. Data requests: export my data; delete my account (fresh sign-in required, 30-day restorable
   grace period, then irreversible anonymization by an hourly job).
6. Development-only sign-in (hard-disabled in production) so the rest of Phase 2 and the web
   app can be built without real Google/Apple credentials.
7. Audit log; `users.*` events. The gateway validates access tokens too (deny by default;
   public routes listed explicitly in `infrastructure/kong/kong.template.yml`).

Status: built and covered by 31 integration tests (`services/auth/test/auth.int.test.ts`) plus
gateway checks in `pnpm verify`. Password sign-in and password change arrive with business
sub-accounts in 2.2, reusing the "end all sessions" mechanism built here.

### 2.2 Business service (new) — ✅ (onboarding, verification, legal details, documents, employee accounts, pictures)

Business onboarding with a **country-flexible legal profile (KYB)**: legal name, registration
type and number per country, tax id (encrypted), registered address, responsible person,
documents. Opening hours, photos and documents (direct-to-storage uploads). **Unverified
businesses can take bookings but are clearly badged "Not verified"**; "Report this business";
admin verification and suspension; audited per-country business export for lawful requests.
**Service categories** (a business groups its services), reviews + owner replies, favourites.

Built so far: part 1 — onboarding, public profile, hours, reports, admin verify/suspend;
part 2 — encrypted legal profile with a duplicate-registration signal, direct-to-storage
document and photo uploads (exact size + real file signature checked), admin document review
with 5-minute links, a verification checklist that also gates "verify" (health categories need
a medical licence), and the audited per-country export;
part 3 — employee accounts and roles (in auth-service): business + username + password
sign-in, temporary passwords with no access until changed, lockout, team management with
manager limits, sessions ended on password change / reset / access removed.
Next: part 4 — pictures (below).

**Business sub-accounts (AWS-IAM-style):** the owner creates accounts (business-scoped
username + password, forced change on first sign-in) for employees' phones and shared
tablets. Roles:

| Role       | Can do                                                                   |
| ---------- | ------------------------------------------------------------------------ |
| Owner      | Everything, including billing and deleting the business                  |
| Manager    | All appointments, staff, schedules, settings                             |
| Front desk | All appointments and the live queue (shared tablets); no settings        |
| Staff      | Own schedule, own working hours/time off, own appointments; check-in/out |

**Part 4 — pictures (built):** every picture goes through one pipeline (`@buku/media`): the
original is uploaded straight to a private bucket, checked (size, real file type), then cleaned
(turned upright, all metadata such as GPS removed, resized, saved as WebP, decompression bombs
refused). Only the cleaned copy is published; the original is deleted (or expires in a day).

- **Business logo** next to the cover photo on the public profile.
- **Employee photos**, optional and entirely the business's choice, uploaded by an owner or
  manager and shown on the booking page next to the employee's name, so a customer who forgot
  the name can recognise the person. The business confirms it has the employee's consent; the
  employee can remove their own photo; it is deleted when they leave the team (auth-service
  publishes `businesses.member_removed`; business-service is the first event consumer).
  Shown in the public profile's `team` list now, and on the booking pages in 2.3.
- **Customer profile picture**, private: visible only to that customer (never to other
  customers, businesses or public pages), deleted when the account is purged, included in
  "my data" export.
- Businesses never see customer pictures (decided 2026-10-01); customers identify themselves
  with their appointment receipt or queue ticket instead (D-057, 2.3 and 2.4).

### 2.3 Booking service — ✅ (menu, staff, schedules, availability, booking, receipts, check-in, shifts)

Part 1 (built): service categories and services, staff profiles linked to team accounts
(deactivated automatically when someone leaves), weekly working hours and time off managed by
the employee themself or a manager, business closures, booking settings, public menu and
staff list with photos.

Part 2 (built): the slot calculator (pure, daylight-saving-aware, unit-tested), booking with
every rule below (the database settles races), receipts (D-057), the business's day list and
search by code or name, approve/decline, cancel (reasons, late flag, "book later"),
reschedule, status history and events. The free-trial/subscription check is added here in 2.5.

Part 3 (built): customer check-in by scanning or typing the receipt code or from the list (no
phone needed), complete, no-show after a grace period; employee shifts (clock in/out by the
employee or the front-desk tablet, one open shift guaranteed by the database, manager
corrections audited, "who's in now" for the queue).

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
- **Appointment receipt (D-057):** the customer's app/web shows a receipt for each booking:
  booking code (`BK-7KQ2MX`, already generated per appointment) with a QR code, business,
  service, employee, date/time in the business's timezone, price ("pay at the venue") and
  status. The business sees every receipt for its bookings (today's list, search by code or
  customer name) and checks the customer in by scanning the QR, typing the code, or picking them
  from the list — so a customer without a phone is served just the same. Built from the
  appointment on request: no PDF or image is generated or stored; the QR is drawn by the app.

### 2.4 Queue service — ✅ (the queue, live screens)

Part 1 (built): open/pause/close the day's queue, remote joining within the distance (PostGIS)
with one live ticket per customer anywhere (database rule), walk-ins and a priority lane, call
next / serve / complete / no-show after the grace period, wait estimates from the day's real
service times and the staff on shift, alerts as events, per-business queue settings.

Part 2 (built): live screens over Server-Sent Events — one public stream per business (ticket
numbers and the line order only, so phones work out their own position without a login),
changes fanned out to every replica through Valkey, bursts coalesced, heartbeats, connection
limits, streams closed first on shutdown. The shop's display page itself comes with the web
app (Phase 3); notifications to phones in the background come in 2.6.

Remote (virtual) queue joining, allowed only **within a distance set by the business
(default 5 km)** and **one active queue per customer**. Live positions pushed to the app.
Alerts when 10 ahead, 5 ahead, then at every step. Called and not present after the grace
period (5 min) → no-show (reliability impact). Walk-ins added by front desk.
**Queue ticket (D-057):** joining gives a ticket number (`A-023`, already numbered per queue
session) shown large in the app/web with a QR, plus live position. The business's queue screen
lists every ticket; front desk calls, serves or marks no-show from there, including walk-ins
and customers without a phone. Nothing beyond the queue entry itself is stored.

### 2.5 Billing service — 🚧 part 1 done (catalog, switches, calculator)

Everything about pricing is **data that platform admins change at any time** (D-065): plans,
prices per channel (web / Android / iPhone), limits, features, pricing-page benefits, an on/off
switch per audience, running costs and channel fees. Starting catalog:

| Audience   | Plan                        | Price / month                     | Highlights                                                     |
| ---------- | --------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Customers  | Free (default)              | —                                 | 1 booking or queue join                                        |
| Customers  | BUKU Plus                   | $1.99 web & Android, $4.99 iPhone | Unlimited bookings and queue joins                             |
| Businesses | Starter (default, not sold) | —                                 | 1 team login, 2 staff, 10 services, 5 photos, no queue         |
| Businesses | Local                       | $24.99                            | 3 logins, 5 staff, 30 services, 10 photos, queue, staff photos |
| Businesses | Mid-size                    | $49.99                            | 15 logins, 25 staff, 100 services, 30 photos, priority support |
| Businesses | Enterprise                  | $99.99                            | Unlimited logins, staff, services, photos; ads                 |

Part 1 (built): the catalog, the pricing-page API, admin management (new prices replace old ones
for new customers while subscribers keep theirs; plans and channel prices archived, never
deleted), the switches (billing off → everyone unlimited, nothing breaks), admin grants, plan and
usage for customers and businesses, and the profit calculator (tax, channel fees, running costs,
break-even). Billing starts **switched off** for both audiences.
Next: part 2 — limits enforced across the services (free visit, team logins, staff, services,
photos, queue, staff photos, manual approval); part 3 — Paddle checkout and webhooks (web),
then billing is switched on. Google Play and App Store purchases come with the mobile app.

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

### 2.10 SOC 2 compliance review (requested 2026-10-02)

Once Phase 2 is complete: a full review of the system, start to end, against the SOC 2 Trust
Services Criteria — security (common criteria), availability, confidentiality, processing
integrity and privacy. For each criterion: the controls in place, the evidence an auditor would
ask for, the gaps, and the fixes (code, infrastructure or written policy). Expected areas:

- **Access:** least privilege everywhere (database roles, cloud, GitHub), MFA for admins and
  infrastructure, joiner/leaver process, periodic access reviews, admin actions audited.
- **Change management:** PRs, required checks and branch protection (already enforced), review
  of changes, deployment records, emergency-change procedure.
- **Monitoring and incidents:** centralized logs and alerts, audit-log retention and integrity,
  an incident response plan and its rehearsal, breach notification duties.
- **Availability:** backups with tested restores, recovery objectives (RPO/RTO), capacity and
  dependency monitoring, status page.
- **Confidentiality and privacy:** data classification, encryption in transit and at rest (incl.
  backups), retention and deletion schedules, data subject requests (built), privacy notice,
  sub-processors list (DigitalOcean, Google, Paddle, messaging providers).
- **Vendor and risk management:** risk register, vendor reviews, dependency and supply-chain
  controls (partly built: pinned actions, audit, secret scanning).
- **Policies** a small company needs written down: information security, acceptable use, access
  control, change management, incident response, business continuity, data retention.

Outcome: a readiness report and the fixes merged. The certification itself (Type I, then Type II
over a period) is performed by an independent CPA firm; this review prepares for it.

**Deferred (built later on the same foundation):** ads (image and video creatives for
businesses on the Enterprise plan only), ClickHouse analytics, outgoing
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

| Topic        | Decision                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services     | Add `business-service` and `billing-service`; outgoing webhooks (later) live in notification-service                                                                                                                                                                                                           |
| Sign-in      | Google now; Apple built but locked until the Apple Developer account; business sub-accounts use username + password; SMS/Twilio later                                                                                                                                                                          |
| Sessions     | Signed in until logout; password change logs out every device with a clear "sign in again" message                                                                                                                                                                                                             |
| Guests       | No guest bookings                                                                                                                                                                                                                                                                                              |
| Monetisation | Customers: 1 free booking or queue join, then BUKU Plus ($1.99 web/Android, $4.99 iPhone). Businesses: Local $24.99, Mid-size $49.99, Enterprise $99.99 (employee logins and other limits by tier). Every price, limit and plan is editable at any time (D-065). Appointments themselves are paid at the venue |
| Market       | Pakistan first, built for worldwide from day one                                                                                                                                                                                                                                                               |
| Language     | English first; more languages by user majority                                                                                                                                                                                                                                                                 |
| Verification | Unverified businesses may take bookings, clearly badged; detailed country-flexible business details                                                                                                                                                                                                            |
| Teams        | AWS-style sub-accounts with Owner / Manager / Front desk / Staff roles                                                                                                                                                                                                                                         |
| Reputation   | Two-way: customer reliability (no-shows, last-minute cancels) and business reliability (business cancellations)                                                                                                                                                                                                |
| Scheduling   | No overlapping appointments per customer across businesses; business-set booking horizon; 3 future bookings per customer per business                                                                                                                                                                          |
| Queue        | Remote join within a business-set distance (default 5 km); one active queue per customer; alerts at 10, 5, then every step                                                                                                                                                                                     |
| Data rights  | Self-service section for customers and businesses to export or delete their data                                                                                                                                                                                                                               |
| Hosting      | Web app on Vercel (thebuku.vercel.app) until a domain is bought; backend on DigitalOcean (lean: droplet + managed Postgres/Valkey)                                                                                                                                                                             |
| Search       | Postgres first; Elasticsearch kept, not running                                                                                                                                                                                                                                                                |
| Pictures     | Business cover + logo; optional employee photos chosen by the business; customer profile picture visible only to that customer; ad images and videos only on the Enterprise business plan                                                                                                                      |

**Still open:** whether the business a customer booked with may see the customer's profile
picture (default: no) · Enterprise plan contents and price · SMS/WhatsApp provider choice and cost (before launch) · AI receptionist
specification · app-store in-app-purchase rules for the subscription (Phase 4) · lawyer review
of legal pages and of the process for government data requests.
