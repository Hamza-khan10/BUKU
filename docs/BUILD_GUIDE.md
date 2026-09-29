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
| 2     | Backend services (MVP core first)                                                              | ⏭ Next                              |
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

## Phase 2 — Backend services ⏭

Order matters: each step only depends on steps above it. Every step ends with
unit tests, integration tests, and an updated `docs/API_REFERENCE.md`.

### 2.0 Decisions to make first (see "Open questions" below)

Service boundaries for the domains the spec forgot, and the MVP cut.

### 2.1 Auth service — identity is the root of everything

1. Registration by email or phone → OTP (6 digits, keyed hash in Valkey, 10-min TTL, 3 attempts then 15-min lockout, 3 sends/hour per destination, per-IP limits).
2. Verify OTP → access token (RS256, 15 min) + refresh token (256-bit random, stored as SHA-256, 7 days).
3. Refresh **rotation with reuse detection**: reuse of a rotated token revokes the whole session family.
4. Password login (Argon2id, dummy-hash timing equalisation, rehash on login), forgot/reset/change password.
5. Logout / logout-all (refresh revocation + access-token `jti` deny-list in Valkey).
6. `GET/PATCH /me`, push tokens, GDPR export (`/me/export`) and deletion (soft → purge after 30 days).
7. Google / Apple sign-in (server-side token verification) via `oauth_accounts`.
8. Audit log for every security-relevant action; `users.*` events via the outbox.
9. Gateway: render Kong's JWT plugin config from the public key (defense in depth).

### 2.2 Business onboarding & catalog (_spec gap — recommended new `business-service`_)

Business create/update, opening hours, photos & documents (presigned S3 uploads, type/size checks),
admin verification queue, categories admin, reviews + owner replies, favourites. Events: `businesses.*`.

### 2.3 Booking service — the core product

1. Services, staff (+ invites), resources, availability rules and exceptions CRUD.
2. **Availability engine**: slot generation in the business's timezone (DST-safe), buffers, staff/resource
   filters, min-advance / max-advance, exceptions; cached 30 s in Valkey, invalidated on change.
3. **Create booking**: Valkey lock (fast rejection) → DB transaction (exclusion constraint = final
   guarantee) → confirmation code → status history → outbox event. Idempotency-Key header support.
4. State machine: confirm / cancel (policy window) / reschedule (atomic swap) / complete / no-show,
   optimistic concurrency via `version`.
5. BullMQ jobs: 24 h / 2 h reminders, review requests (idempotent, re-check DB before sending).
6. Plan limits (free tier caps) — enforced server-side.

### 2.4 Queue service

Daily sessions, join (atomic `INCR` tickets, priority lane), call-next, serve/complete/no-show/leave,
Valkey ZSET positions, Socket.IO with JWT handshake (`user:{id}` / `biz:{id}` rooms), recompute and
broadcast all positions after each change, grace-period no-show jobs, durable record in Postgres.

### 2.5 Notification service

Idempotent Kafka consumers → channel routing by user preferences → email (SMTP: Mailpit dev / SES prod),
SMS (Twilio; logged in dev), push (FCM); in-app inbox API; templates; failures → `dlq.notifications`.

### 2.6 Search service

Indexer consumers (`businesses.*`) → Elasticsearch; rebuild-on-start if the index lags Postgres;
search / nearby / autocomplete / categories / featured / trending; zero-downtime reindex via alias swap.

### 2.7 Ads service → 2.8 Analytics service → 2.9 Billing (Paddle) → 2.10 Outgoing webhooks

Ads: campaigns, approval, impression batching, click tracking, budgets, attribution, then ad injection
in search. Analytics: Kafka → ClickHouse batch ingestion (dedupe by event id), dashboard queries.
Billing: Paddle checkout, **signature-verified + idempotent** webhooks, plan enforcement.
Webhooks: signed deliveries with timestamp (anti-replay), retries with backoff, **SSRF protection**
(block private/metadata IP ranges on every delivery).

### 2.11 Phase 2 acceptance

End-to-end flows from the spec (register → book → confirm → remind → complete → review; queue join →
call → serve), concurrency tests (50 bookings → 1 success; 200 queue joins → 200 unique tickets),
security tests (authz on every route: a user can never read another user's or business's data).

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

## Open questions (decisions needed from the product owner)

1. **Missing service owners.** The spec defines endpoints for businesses (create/verify), reviews,
   favourites, Paddle billing and outgoing webhooks, but assigns them to no service.
   _Recommendation:_ add `business-service` (profiles, hours, media, verification, reviews,
   favourites) and `billing-service` (Paddle + plan enforcement); outgoing webhooks live in
   `notification-service` (same delivery/retry machinery).
2. **Customer → business payments.** Paddle is a merchant of record for _BUKU's own_ sales
   (subscriptions, ads); it cannot pay out to third-party businesses. _Recommendation:_ MVP is
   pay-at-venue; add a marketplace processor later if deposits are needed.
3. **MVP scope.** _Recommendation for a first launch:_ auth, business onboarding + verification,
   services/staff/availability, booking, queue, email + SMS notifications, search, web app.
   Defer ads, ClickHouse analytics, AI receptionist, outgoing webhooks, paid plans, mobile app
   (the web app is mobile-responsive first). The foundation already supports all of them.
4. **Deployment topology.** k3s (spec) vs. a lean start: one DigitalOcean droplet running the
   production compose stack + **managed** PostgreSQL and Valkey (backups, failover, patching
   handled by DO). _Recommendation:_ lean start; the Kubernetes path stays open (images are
   already production-grade).
5. **SMS provider for Pakistan.** Twilio works but is expensive for +92; compare local providers
   before launch. The notification service will use a provider interface either way.
6. **AI receptionist.** The spec has tables and topics but no service definition (its own
   Section 23 says so). Needs a written spec (telephony provider, LLM + embedding provider)
   before any build work.
7. **Legal pages.** Privacy policy / ToS (governing law: Pakistan) must be reviewed by a lawyer
   before launch; we will draft them in Phase 3.
