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

### 2.5 Billing service — ✅ (catalog, trials, requests, limits, Paddle checkout)

Everything about pricing is **data that platform admins change at any time** (D-065): plans,
prices per channel (web / Android / iPhone), limits, features, pricing-page benefits, an on/off
switch per audience, running costs and channel fees. Starting catalog:

| Audience   | Plan                        | Price / month                     | Highlights                                                     |
| ---------- | --------------------------- | --------------------------------- | -------------------------------------------------------------- |
| Customers  | Free (default)              | —                                 | 1 booking or queue join                                        |
| Customers  | BUKU Plus                   | $1.99 web & Android, $4.99 iPhone | Unlimited bookings and queue joins                             |
| Businesses | Starter (default, not sold) | —                                 | 1 team login, 2 staff, 10 services, 5 photos, no queue         |
| Businesses | Essential                   | $24.99                            | 3 logins, 5 staff, 30 services, 10 photos, queue, staff photos |
| Businesses | Professional                | $49.99                            | 15 logins, 25 staff, 100 services, 30 photos, priority support |
| Businesses | Enterprise                  | $99.99                            | Unlimited logins, staff, services, photos; ads                 |

Part 1 (built): the catalog, the pricing-page API, admin management (new prices replace old ones
for new customers while subscribers keep theirs; plans and channel prices archived, never
deleted), the switches (billing off → everyone unlimited, nothing breaks), admin grants, plan and
usage for customers and businesses, and the profit calculator (tax, channel fees, running costs,
break-even). Billing starts **switched off** for both audiences.

Also built: a **free trial** each customer and each business can start once, whenever they like
(default 30 days of BUKU Plus / Professional; length, plan and on/off per audience — off makes Free
the normal plan); **any plan for any account free of charge** (admin grants, optionally until a
date, replacing a grant or trial); and **plan requests** — a business asks for a plan (e.g.
Enterprise), an admin approves (→ a grant) or declines. Ended trials and grants expire on their own.
Part 2 (built): every limit and feature is enforced where things are created — the free visit
(booking and queue join), team logins (active accounts; re-enabling counts), bookable staff and
services (restoring counts), photos, the virtual queue, staff photos and manual approval. Checks
run inside the creating transaction behind a per-account lock, so parallel requests can't slip
past a limit. Nothing existing is ever removed by a downgrade.
Part 3 (built): paying on the web with Paddle (merchant of record: it collects the payment and
the sales tax/VAT). Checkout created server-side with the BUKU account bound to it; signed
webhooks verified, processed once and applied in order; cancel at period end and undo; switch
plan (prorated); card and invoices in Paddle's portal; admins end a paid plan at once; prices
synced to Paddle in one call. A paid plan replaces a running trial or grant.
**To go live:** connect a Paddle sandbox account (docs/DEVELOPMENT.md → "Set up Paddle"), sync
the web prices, then switch billing on per audience. Google Play and App Store purchases come with
the mobile app (Phase 4).

### 2.6 Notification service — ✅ done (events, channels, reminders, WhatsApp, suggestions)

Push (free) for every alert; WhatsApp for important transactional messages once the provider
is connected; email for receipts. Preferences, in-app inbox, templates, provider switch
(dev: logged only).

Part 1 (built): every booking and queue event becomes a message — to the customer (confirmed,
request sent, not accepted, cancelled, moved, missed; people ahead, your turn, queue closed), to
the employee doing the service (new booking, cancelled, moved) and to owner/managers/front desk
(requests to approve). The in-app inbox always gets it; push goes to the person's devices as their
preferences allow ("your turn" can't be switched off). Push through Expo (log sender in
development); receipts switch off devices that no longer exist. Daily partition upkeep.

Part 2 (built): the right channels per person (D-073) — email (SES; Mailpit in development) for
receipts and day-before reminders, and as the fallback for people without the app; one-click
unsubscribe. Timed messages, each exactly once: reminders 24 h and 2 h before (not at night, not
right after booking), "book again" after "remind me later", unanswered requests nudged to the
approvers, trial ending / ended, gifted or cancelled plan ending, payment failed. WhatsApp
(D-074): connect by sending a one-time code (proves the number), free replies inside the 24-hour
window, paid templates only for people without the app within an admin budget, STOP/START,
"what's coming up" replies. Admin settings (switches, quiet hours, WhatsApp budget and price,
usage this month). GDPR: the WhatsApp number is exported and erased with the account.

Part 3 (built): suggestions shaped by how each person uses BUKU (D-075) — regulars due for their
usual visit get a real free time with their usual employee; people who stopped coming hear that
their usual place is taking bookings; new accounts that never booked get two first-booking
nudges. Opt-in, capped (gap, monthly maximum, stop when ignored), never at night, never paid
WhatsApp, never when something is already booked.

Before WhatsApp goes live: Meta Business verification, the number, the templates
(`GET /v1/admin/notifications/whatsapp/templates`) and real prices for the budget. The apps
(Phase 3/4) must ask for the suggestions opt-in during onboarding.

### 2.7 Search service (Postgres) — ✅ done

Text + location search, nearby, autocomplete, categories, featured and trending, ranking that
includes rating (adjusted for review count) and reliability (D-076). The search document per
business is kept current by database triggers (services and category included). Live facts in
every result: open now, open queue and people waiting, lowest price, distance, cover photo.
Elasticsearch stays for later (`SEARCH_ENGINE=elasticsearch` is refused until built); paid
placements come with the ads service.

### 2.8 Reputation — ✅ done (reviews, reliability both ways, cancellation insights)

Customer reliability score (visible to the customer; businesses see a simple summary such as
"shows up 95%"), business reliability figure next to its star rating, cancellation analytics.

Part 1 (built, D-077): reviews — only for real visits (30 days, once; edit 7 days, delete any
time), public list with summary (stars, detail ratings, reliability), owner/manager replies,
reports and admin moderation, "How was your visit?" requests, new-review and reply notifications;
business reliability on the public profile.

Part 2 (built, D-078): customer reliability over 12 months (no-shows in full, late cancellations
half, ordinary cancellations never) — the customer sees the detail, businesses only "Shows up 95%"
or "New customer" on appointments and the queue board; optional approval for customers below a
chosen percentage (new customers never held back); cancellation insights for owners and managers.

### 2.9 Phase 2 acceptance — ✅ done

End-to-end: sign in → add phone → trial booking → confirm → reminder → complete → review;
subscribe → second booking; queue join (distance + one-queue rule) → called → served.
Concurrency tests; authorization tests on every route.

Built (D-079): `pnpm acceptance` runs it all against the running stack through the gateway in
about three minutes — three journeys with the messages people receive at each step, four races
(8 people for one slot, 5 taps on "review", two tablets calling next, cancel vs check-in), and
every route the services expose (203, read from the real route setup): without a token through
the gateway and straight to each service, as a customer outside the business on its 88 team
routes, and as a customer on the 40 admin routes. Public routes are an explicit, reasoned list.
Found and fixed: business billing routes told outsiders "payments aren't set up" before checking
who they were.

### 2.10 SOC 2 compliance review (requested 2026-10-02) — ✅ done

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

Done (PRs #28–#32): the [readiness report](compliance/SOC2-readiness.md) covers every criterion
with controls, evidence and status. Fixed in code: two-step sign-in required for admins (D-081),
append-only audit log and a retention schedule in the database, audited admin-role changes and
access reviews (D-080), image scanning with SBOMs, digest-pinned bases, CodeQL, security alert
rules with runbooks (D-082), every route checked by the acceptance run (D-079). Written: eight
policies, risk register, sub-processors, privacy notice draft. What remains is mostly Phase 5
(production monitoring, backups and restore drills) plus legal review, vendor reports and a
penetration test before a Type I audit.

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

The detailed plan — every page, its data and edge cases, the design system and delivery steps
3.1–3.7 — is [docs/WEB_PLAN.md](WEB_PLAN.md).

- **3.1 Foundation — ✅ done.** Clean text everywhere (D-083, #38); the visitor's real address
  through the web server (D-084, #39); `apps/web` (D-085): design tokens (AA-checked, light and
  dark), fonts, logo, UI kit (`/kit`), clean-text inputs, session through the web server (tokens
  only in HttpOnly cookies, renewal, sign-out at the API), nonce-based CSP and security headers,
  error pages, browser tests (desktop + phone, WCAG 2.2 AA) in CI.
- **3.2a Trust pages — ✅ done.** Navigation (desktop, phone menu, full footer); how it works, about,
  contact, help, security; legal: privacy, terms, business terms, cookies, acceptable use, refunds,
  sub-processors — written from what the system does, marked as drafts until legal review
  (`LEGAL_REVIEWED`), contact details from settings and never placeholders; `security.txt` once a
  security address is set.
- **3.2b Business page — ✅ done.** `/b/[slug]` (ids redirect to it): cover photo or a quiet
  category pattern, verified or "Not verified", rating, reliability, open now in the business's
  timezone; services and prices, booking terms from its settings, team, week hours, directions and
  contact, reviews (summary, details, replies, more on request), the walk-in queue live over
  server-sent events; schema.org data (escaped), share image, canonical address. Each section
  loads on its own: one failing service shows its own message, never a broken page.
- **3.2c Discovery — ✅ done.** Home page with live data: search with suggestions, a city
  people can switch (cities and figures from `GET /v1/cities`, #43), shelves — open now, popular
  this week, top rated, verified with photos — each left out when it has nothing true to show;
  `/explore` (words, city, open now, queue open, verified, 4 stars and up, order, pages — all in
  the address, filters are plain links), "Near me" (location asked, rounded to ~100 m, used for
  that search only); `/categories` and `/c/[slug]`. Browser tests also check that no page scrolls
  sideways at 320 and 390 px.
- **3.2d Pricing, for businesses, sitemap — ✅ done.** `/pricing`: every plan, price, limit and
  trial from the plan catalog (customers and businesses; the iPhone price stated as the App
  Store's; "everything is included" while paid plans are off); features not offered yet are left
  out by the API (D-087, #48). `/for-business`: only what the platform does today, and how to get
  verified. `sitemap.xml` (site pages, categories, every listed business; hourly), referenced from
  `robots.txt` once indexing is allowed. **3.2 (public site) complete.**
- **3.3a Sign-in (development) — ✅ done.** `/signin` offers only what the site really has:
  development sign-in (any email, a role to try; never on the live site) or, where nothing is set
  up, an honest "not open yet". Back to where you were after signing in (`?next=`, same-site paths
  only — no open redirects); signed-in visitors skip the page. The header knows on the server
  whether you're signed in (no flash) and shows "Sign in" or your account menu; a session that
  ended elsewhere is cleared. `/signout`: this device or every device, ending the sessions at the
  API; nothing happens on a plain visit.
- **3.3b Employee sign-in and two-step codes — ✅ done.** `/signin/business`: the business's
  handle (or its whole BUKU link, pasted), username and password; a link can fill in the first
  two. Wrong details get one answer that never says which part was wrong; a locked account says
  when it can try again. A temporary password from the business is replaced right there (no
  retyping it), checked by the same rules as the API (D-088), then the employee is signed straight
  back in; `/signin/new-password` covers the same step after a two-step code or a later visit.
  `/signin/verify`: the authenticator code (sent once six digits are in, spaces from a paste
  ignored) or a recovery code (recognised when pasted into the code box; how many are left is
  said); expired challenges start again. The challenge token never reaches the page (D-088).
- **Fixes before 3.3c — ✅ done.** Public data on server-rendered pages is kept for its
  `revalidate` time under the API address alone, and fetched as the visitor who needed it, so
  the gateway's per-visitor limits fall on them instead of on the website as a whole (D-089).
  Two simultaneous first sign-ins with one email make one account (#53).
- **3.3c-1 Welcome — ✅ done.** A new account's first stop is `/welcome` (then on to where it was
  going): the name businesses see (reviews show only first name and initial), which emails to
  get — booking updates and reminders, each described exactly as the notification rules send
  them — and the device's time zone. Both email choices start on, so "Skip for now" loses
  nothing. It asks only about what BUKU sends today: no phone number until WhatsApp is set up
  (the phone is only used for WhatsApp), no promises of settings pages that don't exist yet.
- **3.3c-2 Sign in with Google — ✅ done; verified end to end locally with the real Google client
  (2026-10-05).** "Continue
  with Google" on `/signin`, run by the web server (authorization code + PKCE, state and nonce
  checked, no Google script on our pages; D-090); new accounts go to `/welcome`, accounts with
  two-step sign-in to `/signin/verify`, and an account scheduled for deletion can be restored.
  Shown only where `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set and the API is reachable
  (setup in DEVELOPMENT.md); the live site gets it once the API is deployed (Phase 5). Where it
  isn't set up, its routes answer calmly, never with an error page (#57). **3.3 complete.**
- **3.4a Booking — ✅ done.** `/b/[slug]/book`: service → who (anyone available, or a person who
  does it) → day and time → book, on one page. Every choice lives in the address, so a refresh,
  the back button or signing in at the last step never loses it. Days show how many times are
  free (two weeks at a time, up to the business's horizon); times come fresh from the API, on the
  business's clock (said so when the visitor's differs). Before booking, a time inside the
  business's notice period is flagged (cancelling it would count as late). A time taken
  meanwhile is said so, with the other choices kept; after a lost connection the page checks
  whether the booking went through before saying anything. Team accounts can't book (said up
  front). The receipt `/appointments/[id]` is the ticket: code, QR (the code only), what, when,
  where, price paid at the venue, the cancellation terms for this visit; only its owner sees it.
  The business page has "Book a visit" and a Book button on every service someone takes bookings
  for.
- **3.4b Visits — ✅ done.** `/account`: the next visit as its ticket, how reliably you keep
  bookings (with exactly what businesses see: the label only), and "book again" for places you
  went. `/account/appointments`: upcoming and past, a page at a time. On a receipt, only what the
  API allows right now: **add to calendar** (an iCalendar file made in the browser; a request
  not yet confirmed is tentative), **move** (until the notice period; the visit gets a new code,
  the person is kept unless another is chosen; a new time inside the notice period is flagged),
  **cancel** (a reason, an optional note the business sees, one "book again" reminder in 3 days;
  said plainly when it counts as late — "Keep my visit" is as easy as cancelling), and **book
  again** afterwards. Declines and cancellations by the business are named as such. The account
  menu links to the account and visits.
- **3.4c Walk-in queue — ✅ done.** On a business page the live queue card now lets people join
  from their phone: the position is asked for only when "Join the queue" is pressed, used once for
  the distance rule and not kept (the API stores only that they joined remotely) — said next to
  the button. Every refusal is said plainly (how far away they are and the limit; paused, closed,
  full; counter only; location turned off). One ticket at a time: the card shows it instead of a
  second "Join". `/queue/[id]`: the live ticket — place in line and wait worked out from the
  public live stream (ticket numbers only), the API asked again only when the ticket's state
  changes; when called, "Go to the counter" with the time to be there by, in the tab's title too
  and with a buzz on phones that allow it; leaving says first that the place goes to the next
  person. The account page shows a live ticket at the top. Joining is the page's loud button while
  the queue is open; booking otherwise. Pushes to a closed phone come with the mobile app
  (Phase 4): the web ticket says to keep the page open.
- **3.4d-1 Reviews — ✅ done.** After a visit that happened (completed, or checked in and started),
  for 30 days: the receipt's main button is "Review this visit" and the account page asks "How
  did it go?". `/appointments/[id]/review`: overall stars (needed, each with its word), four
  optional details, words (clean text; the page says phone numbers and emails are removed, and
  the API does it), and exactly how it appears — "Ayesha K." with the month of the visit, never
  the full name, and that the business can reply publicly. Changeable for 7 days, deletable any
  time (with any reply). `/account/reviews`: every review as the business page shows it, its
  reply, until when it can change, and plainly when moderators hid it. Names ending in "s" take a
  plain apostrophe across the site ("Fade Masters’ notice period"). There are no favourites: the
  API has none, so the site doesn't offer them.
- **3.4d-2 Notifications — ✅ done.** `/account/notifications`: the inbox — every message BUKU
  sent the account, newest first, unread ones marked; opening one marks it read and goes where it
  leads (a booking, its review, a queue ticket, a suggested booking pre-filled; messages about
  screens the site doesn't have yet are shown without a link); remove one; mark all read. The
  header shows how many are unread. `/account/notifications/settings`: only the ways BUKU reaches
  someone on the website today — email (booking updates, reminders, business alerts for teams)
  and suggestions as an explicit opt-in (inbox, and by email only if also chosen; turning
  suggestions off turns the emailed ones off too); each switch saves at once and puts itself back
  if saving fails; what's always sent is listed with why. App push settings come with the app,
  WhatsApp once it's set up.
- **3.4d-3a Your details — ✅ done.** `/account/settings` (a Settings tab, and in the account
  menu): the profile picture — private, only ever shown to the person themself (D-051); checked in
  the browser first (JPEG, PNG or WebP, up to 10 MB), sent straight to storage by a signed link,
  then cleaned by the API (no location or camera details survive); removing asks first, since a
  picture from Google doesn't come back by itself — the name businesses see and the account's
  time zone (with this device's offered when they differ, and what it's used for: notices about
  the person's own plan; visit times are always the business's), saved together; and how the
  account signs in, read-only. The Content-Security-Policy names object storage
  (`STORAGE_ORIGIN`) for pictures and uploads only. No phone number yet: its only use is
  WhatsApp, which isn't live.
- **3.4d-3b Sign-in and security — ✅ done.** On `/account/settings`: two-step sign-in — off,
  with a way to turn it on; on, since when and how many recovery codes are left, new codes, and
  turning it off (platform admins can't) — each proved with a code from the app or, for a lost
  phone, a recovery code (the API took only app codes before: someone who lost the phone could
  never turn it off, fixed in auth). `/account/settings/two-step`: what it is and what's needed,
  then the app (QR code, or the key in groups of four), a code to prove it works, then the
  recovery codes shown once — copy, download as a text file, and say they're kept before going
  on. "Where you're signed in": every device, this browser first, since when, last active, a
  shortened network address; sign any other one out (its session ends at the API), or everywhere.
- **3.4d-3c Your data — ✅ done.** On `/account/settings`: download a copy of everything BUKU
  keeps (the API's export, saved as a JSON file); deleting the account is one step away, except for
  employee accounts (their business closes them). `/account/settings/delete` says what happens
  before asking: signed out everywhere at once, visits still to come cancelled and the businesses
  told, queues left (the API didn't do this before: nobody consumed `users.deleted` — fixed in
  booking and queue), 30 days to change one's mind (cancelled visits stay cancelled), then what's
  removed for good and what businesses keep; a copy of the data first; an optional reason; the word
  DELETE typed; then, if any visits still to come or a queue place would be cancelled, a pop-up lists
  them ("These will be cancelled") and asks once more: keep the account, or cancel them and delete.
  A sign-in older than the API's window is asked to sign in again first, and comes straight back. `/goodbye` says the day the details are removed and how to restore before then.
- **3.4d-4 Your plan — ✅ done.** `/account/plan` (a Plan tab) says only what's true of the plan
  now: while paid plans are switched off, that everything is free with no limits; otherwise the
  plan, what's used of its limits (in total), a free trial when one is offered (no card, once, back
  to the free plan after — nothing charged), a trial's end date, a plan given by BUKU and until
  when, and a plan bought in the app managed in its store. A plan bought on the website: renews or
  ends on a date, a failed payment said first, payment details and receipts on the payment
  provider's own pages (only ever its https address), stop renewing (asks first) or keep it
  renewing. No "buy" button: buying online needs the payment provider set up (the owner's Paddle
  account), so the page says plans can't be bought on the website yet.
- **Hardening before 3.4d ships (owner's request, 2026-10-06) — in progress.** Deleting an account
  lists what it cancels first; the API refuses passwords seen in data breaches (Have I Been Pwned,
  k-anonymity; allowed if unreachable); the public sign-in offers no admin role and its API
  pass-through refuses every admin path; browser tests prove tokens are HttpOnly only, admin is
  enforced on the server, and sign-in is rate-limited. **Separate admin app (D-091) — foundation
  done:** `apps/admin` on its own address (port 3200 in development), its own `buku_admin_…`
  cookies, platform admins only (any other account is signed out at once), two-step sign-in set
  up before anything shows, the access review as its first page; Kong answers `/v1/admin` only to
  the admin app's key (`ADMIN_GATEWAY_KEY`); both web servers share `@buku/web-security`. The
  operator tools themselves (3.6) build on it. Next: isolating the services from each other, then
  the premium redesign.

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

| Topic        | Decision                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Services     | Add `business-service` and `billing-service`; outgoing webhooks (later) live in notification-service                                                                                                                                                                                                                   |
| Sign-in      | Google now; Apple built but locked until the Apple Developer account; business sub-accounts use username + password; SMS/Twilio later                                                                                                                                                                                  |
| Sessions     | Signed in until logout; password change logs out every device with a clear "sign in again" message                                                                                                                                                                                                                     |
| Guests       | No guest bookings                                                                                                                                                                                                                                                                                                      |
| Monetisation | Customers: 1 free booking or queue join, then BUKU Plus ($1.99 web/Android, $4.99 iPhone). Businesses: Essential $24.99, Professional $49.99, Enterprise $99.99 (employee logins and other limits by tier). Every price, limit and plan is editable at any time (D-065). Appointments themselves are paid at the venue |
| Market       | Pakistan first, built for worldwide from day one                                                                                                                                                                                                                                                                       |
| Language     | English first; more languages by user majority                                                                                                                                                                                                                                                                         |
| Verification | Unverified businesses may take bookings, clearly badged; detailed country-flexible business details                                                                                                                                                                                                                    |
| Teams        | AWS-style sub-accounts with Owner / Manager / Front desk / Staff roles                                                                                                                                                                                                                                                 |
| Reputation   | Two-way: customer reliability (no-shows, last-minute cancels) and business reliability (business cancellations)                                                                                                                                                                                                        |
| Scheduling   | No overlapping appointments per customer across businesses; business-set booking horizon; 3 future bookings per customer per business                                                                                                                                                                                  |
| Queue        | Remote join within a business-set distance (default 5 km); one active queue per customer; alerts at 10, 5, then every step                                                                                                                                                                                             |
| Data rights  | Self-service section for customers and businesses to export or delete their data                                                                                                                                                                                                                                       |
| Hosting      | Web app on Vercel (thebuku.vercel.app) until a domain is bought; backend on DigitalOcean (lean: droplet + managed Postgres/Valkey)                                                                                                                                                                                     |
| Search       | Postgres first; Elasticsearch kept, not running                                                                                                                                                                                                                                                                        |
| Pictures     | Business cover + logo; optional employee photos chosen by the business; customer profile picture visible only to that customer; ad images and videos only on the Enterprise business plan                                                                                                                              |

**Still open:** whether the business a customer booked with may see the customer's profile
picture (default: no) · Enterprise plan contents and price · SMS/WhatsApp provider choice and cost (before launch) · AI receptionist
specification · app-store in-app-purchase rules for the subscription (Phase 4) · lawyer review
of legal pages and of the process for government data requests.
