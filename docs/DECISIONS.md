# Decision log

Every place where the build deliberately differs from the original spec
(`Buku-platformd-developement-guide.md`), or where the spec left a choice open.
Format: decision → why → consequence. Newest decisions go at the bottom.

## Versions & tooling

**D-001 · Current stable versions instead of the spec's 2024 versions.**
Node 24 LTS, TypeScript 6.0, Express 5, Prisma 7.10, Zod 4, PostgreSQL 17 + PostGIS 3.5,
Kafka 4.3, Elasticsearch 9.5, ClickHouse 26.3 LTS, Kong 3.9.
_Why:_ a new build should not start on versions that leave support soon.
_Not_ adopted: TypeScript 7 (the new native compiler — typescript-eslint doesn't support it yet)
and Prisma 8 (still a release candidate). Both are one-line upgrades later.

**D-002 · pnpm 12 instead of npm workspaces.**
_Why:_ blocks dependency install scripts unless allow-listed, refuses packages published < 24 h
ago, strict dependency isolation (no phantom imports), and `pnpm deploy` for minimal images.

**D-003 · Vitest instead of Jest; pino instead of Winston + Morgan.**
_Why:_ Vitest runs TypeScript ESM natively (no transform config); pino is structured JSON by
default, much faster, and has built-in path redaction for PII.

**D-004 · Confluent's Kafka client instead of KafkaJS.**
_Why:_ KafkaJS has been unmaintained since 2023 and does not track Kafka 4.x. Confluent's client
is built on librdkafka (same engine as the Java/Go clients) and exposes a KafkaJS-style API.

**D-005 · `@prometheus-io/client` instead of `prom-client`.**
_Why:_ `prom-client` is deprecated; the Prometheus project now publishes it under this name.

## Infrastructure

**D-006 · LocalStack replaced by RustFS (S3) + Mailpit (email).**
_Why:_ the LocalStack community edition was archived; its unified image needs a paid plan for
commercial use. BUKU only needs S3 (production: DigitalOcean Spaces) and email (production: SES
via SMTP); SMS goes to Twilio, jobs to BullMQ, secrets to the platform's secret store.

**D-007 · Valkey instead of Redis; `noeviction` instead of `allkeys-lru`.**
_Why:_ DigitalOcean Managed Caching runs Valkey, so dev matches prod. The spec's `allkeys-lru`
would silently delete booking locks, queue state and BullMQ jobs under memory pressure.

**D-008 · Kong on port 8000; the web app keeps port 3000.**
_Why:_ the spec put both on 3000.

**D-009 · Kafka topics created from a TypeScript registry, not a shell list.**
_Why:_ one source of truth for code and infrastructure; `--check` mode verifies drift.

**D-010 · One dev image for all Node workloads, read-only source mounts.**
_Why:_ the spec built 7 separate images with 7 installs; one image is faster, and read-only
mounts mean a container can't modify your source tree.

**D-011 · Kong OSS 3.9 kept, with an exit plan.**
Kong stopped publishing OSS images after 3.9.x. The gateway holds no business rules (services
enforce auth and validation themselves), so it is replaceable (e.g. Traefik, Envoy, APISIX, or
plain nginx) in Phase 5 if 3.9 stops receiving fixes.

**D-012 · Kong DNS TTL capped at 5 s.**
_Why:_ found during verification — Kong otherwise keeps routing to a replaced container's old IP.

## Security

**D-013 · Argon2id (Node built-in) instead of bcrypt.**
_Why:_ OWASP's first recommendation; memory-hard; no native addon. Parameters are stored in each
hash so they can be raised without breaking logins.

**D-014 · SHA-256 (not bcrypt) for refresh, reset and invite tokens.**
_Why:_ the spec's "bcrypt token_hash UNIQUE" cannot work — bcrypt is salted, so you can't look a
token up by its hash. Tokens are 256-bit random, so a fast hash is sufficient and indexable.

**D-015 · Encrypted PII + blind index.**
_Why:_ the spec asks for encrypted email/phone _and_ unique email/phone lookups; ciphertext with
random IVs can't be unique-indexed. A keyed HMAC of the normalized value provides both.

**D-016 · Password policy per NIST SP 800-63B (length ≥ 10, common-password block), not "mixed chars".**
_Why:_ composition rules produce predictable passwords; length is what resists guessing.

**D-017 · Webhook signature includes a timestamp: `X-Buku-Signature: t=…,v1=…`.**
_Why:_ the spec's `sha256=HMAC(body)` lets a captured delivery be replayed forever.

**D-018 · Least-privilege Postgres roles** (`buku_migrator` owns schema, `buku_app` data-only).

## Data model

**D-019 · Seven tables added that the spec's own features require:**
`oauth_accounts` (Google/Apple sign-in), `notification_preferences` (preferences screen),
`favourites` (favourites screen), `appointment_status_history` (`/timeline` endpoint),
`outbox_events` (Section 24), `processed_events` (Paddle + Kafka idempotency), and
`ai.business_knowledge_chunks` (Section 23). Also added: `businesses.timezone`/`currency`
columns (availability math cannot live in a JSON blob), `draft` ad status (the spec's
"update draft only" had no draft state), `in_app` notification channel, `subscriptions`
(the spec's `subscription_plans` holds subscriptions, not plans).

**D-020 · Prisma migrations (`migrate deploy`), never `db push --accept-data-loss`.**
_Why:_ migrations are reviewable, ordered and reproducible; `db push` can drop data.

**D-021 · Extensions in an `extensions` schema; partitions in `partitions`; vectors in `ai`.**
_Why:_ keeps Prisma's `public` schema exactly equal to `schema.prisma`, so migration drift is
zero and CI can fail on any real drift.

**D-022 · Triggers (not generated columns) for `location` and `search_vector`.**
_Why:_ Prisma misreads generation expressions as defaults and would rewrite them every migration.

**D-023 · UUIDv7 primary keys instead of UUIDv4.** Time-ordered → faster inserts, smaller indexes.

**D-024 · ClickHouse tables use ReplacingMergeTree + TTLs.**
_Why:_ Kafka is at-least-once (duplicates collapse on merge); TTLs implement retention.

**D-025 · Elasticsearch versioned index `businesses_v1` behind alias `businesses`, strict mapping.**
_Why:_ mapping changes become a zero-downtime alias swap; strict mapping prevents field explosions.

## Build & release

**D-026 · Production images: distroless + tsup bundle + `pnpm deploy`.**
Workspace packages are bundled; third-party packages stay external. The Prisma CLI is kept out
of runtime images (`autoInstallPeers: false`), and unused database WASM compilers are pruned.
823 MB → 349 MB.

**D-027 · Minimal CI in Phase 1 (not Phase 5).**
_Why:_ branch protection needs checks to require; catching problems from the first commit is cheaper.

## Phase 2 product decisions (2026-09-30)

**D-028 · Sign-in with Google; Apple built but locked; SMS later.**
_Why:_ free during development (Apple needs a $99/yr developer account; SMS costs per message).
The `oauth_accounts` table means adding providers needs no schema change.

**D-029 · Sessions last until logout (sliding refresh tokens), revoked everywhere on password change.**
_Why:_ the product owner wants apps to stay signed in. Security is kept by rotating refresh
tokens with reuse detection, a long inactivity timeout, a visible device list, and
"log out all devices"; the revocation reason is returned so clients can explain it.

**D-030 · No guest bookings; customer subscription with a one-use free trial.**
_Why:_ monetisation is at the customer level. Price lives in configuration because it will be
revised after tax/fees review. Paddle (merchant of record) handles tax on the web.

**D-031 · Worldwide-ready from day one, Pakistan first.** Per-business timezone and currency,
E.164 phones, country-flexible business legal details.

**D-032 · Unverified businesses may take bookings, clearly badged "Not verified".**
_Why:_ lowers the barrier to onboarding. Mitigations: badge, report button, admin suspension.

**D-033 · Country-flexible KYB profile; audited per-country export.** Registration identifiers
and tax ids are stored encrypted; exports for government requests are admin-only, audited, and
released only through a documented legal process (to be defined with a lawyer).

**D-034 · AWS-IAM-style business sub-accounts** (Owner, Manager, Front desk, Staff) with
business-scoped username + password and forced password change on first sign-in.

**D-035 · Two-way reputation.** Customer reliability (no-shows, last-minute cancels, small
effect, visible to the customer); business reliability (business cancellations) shown next
to the star rating and used in ranking. Star ratings stay pure customer reviews.

**D-036 · One customer can never hold overlapping appointments, across all businesses.**
Enforced by a database exclusion constraint (`appointments_no_user_overlap`).

**D-037 · Booking horizon per business (default 12 months); 3 future bookings per customer per business.**
_Why:_ people legitimately book months ahead; the per-business cap stops slot hoarding.

**D-038 · Remote queue join within a business-set distance (default 5 km) and one active queue per customer.**
_Why:_ phone GPS can be spoofed, so the one-queue rule plus no-show reputation is the real
deterrent; the distance check filters casual abuse.

**D-039 · Notification channels: push for every alert, WhatsApp for key transactional messages.**
_Why:_ push is free; WhatsApp Business messages sent by the business are billed per message
by Meta (outside a 24-hour window the customer opened), so frequent queue updates go by push.

**D-040 · Postgres search for the MVP; Elasticsearch kept but off (`SEARCH_ENGINE`).**
_Why:_ saves ~1.3 GB RAM on the lean launch server; the GIN/GiST indexes already exist.

**D-041 · Deferred features run only behind compose profiles** (`elasticsearch`, `analytics`,
`ads`). Code, config and tests stay; the default stack is 14 containers instead of 19.

**D-042 · Gateway token check: deny by default, keys selected by `kid`.**
Every route requires a valid token unless listed as public in `kong.template.yml`. Kong looks up
the verification key by the token's `kid` header (not `iss`), so current and previous keys can
both be accepted during a rotation. The config is rendered from a template at container start
from the same `JWT_*` variables the services use, and validated (`kong config parse`) before
Kong starts. Gateway 401s keep Kong's body format rather than adding custom Lua to the gateway.

**D-043 · Account deletion: fresh sign-in, 30-day restorable grace, then anonymization.**
Deletion is recorded only in `deleted_at` (never `status`), so restoring cannot lift a
suspension. Purge anonymizes instead of deleting rows: appointment history stays for the
businesses (and accounting), ratings stay in business averages, while contact data,
credentials, devices, favourites, notifications and review/appointment texts are removed.
The export endpoint reads other services' tables read-only (a deliberate exception).

**D-044 · Identity & access (users, credentials, memberships) belong to auth-service; the business itself to business-service.**
Ownership comes from `businesses.owner_id`, written in the same transaction that creates the
business, so no service writes another's tables. Roles are resolved from the database on every
request (not cached in tokens), so disabling an employee takes effect immediately.

**D-045 · One permission table for business roles** (`@buku/common` `authz.ts`), used by every
service through `requireBusinessPermission()`: no role → 404, role without permission → 403.

**D-046 · Identity changes re-trigger verification.** Editing name, category or address of a
verified business puts it back to `pending` (badge "Not verified") — otherwise a verified
listing could be turned into a different business.

**D-047 · Countries as ISO 3166-1 codes from a fixed list.** Runtime region lookups accept
user-assigned codes like `ZZ`, so the 249 official codes are listed explicitly.

**D-048 · Uploads bypass the API: presigned, single-object links + server-side inspection.**
The link is signed for one key, content type and exact size (storage refuses anything else);
on completion we check size and file signature before accepting. The API never streams files,
so upload size can't exhaust service memory or bandwidth.

**D-049 · Verification needs a legal profile and an approved document** (plus a medical licence
for Health & Medical). One checklist function drives both the owner's view and the admin guard.

**D-050 · KYB is country-flexible, encrypted, and cross-checked.** Registration type is free
text per country; identifiers are encrypted with a keyed fingerprint so admins see when a
different owner reuses the same registration (same-owner reuse is normal: branches).
Photos: presigned links in dev, a CDN/public base URL in production (`MEDIA_PUBLIC_BASE_URL`).
