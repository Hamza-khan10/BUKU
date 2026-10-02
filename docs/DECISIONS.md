# Decision log

Every place where the build deliberately differs from the original spec
(`Buku-platformd-developement-guide.md`), or where the spec left a choice open.
Format: decision → why → consequence. Newest decisions go at the bottom.

## Versions & tooling

**D-001 · Current stable versions instead of the spec's 2024 versions.**
Node 24 LTS, TypeScript 6.0, Express 5, Prisma 7.10, Zod 4, PostgreSQL 17 + PostGIS 3.6,
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

**D-051 · Pictures of people are opt-in and minimal-exposure.** Employee photos are optional,
added by the business with the employee's consent and removed when they leave; customer
profile pictures are private to the customer (other customers never see them). Every image
goes through the part-2 upload checks and has metadata (e.g. GPS) stripped before display.
Ad images and videos are an Enterprise-plan feature, built with ads after the MVP; videos will
need their own size/length limits and processing.

**D-052 · Employee accounts are ordinary `users` rows that belong to one business.**
`managed_by_business_id` + a username unique within that business; platform role `staff`.
Sessions, revocation, audit and purge work unchanged. A temporary password gives no business
access (`businessRoleOf` ignores it) until the employee picks their own, and any password change
signs the account out everywhere, this device included (D-029). Lockout: 5 wrong passwords →
15 minutes; the business can unlock by resetting. Turning an employee off, resetting or
removing them ends that account's sessions; a personal BUKU account that is a member keeps its
sessions (it loses the business's access immediately anyway, D-044). Removing an employee
closes the account at once and frees the username.

**D-053 · "Sign out everywhere" is cut off to the millisecond.** Access-token ids are UUIDv7, so
the issue time is known to the millisecond (`iat` has whole seconds). Without this, a token
issued right after a password change, within the same second, would be treated as revoked.

**D-054 · The database image is built on the official `postgres:17-bookworm`.**
The previous base, `postgis/postgis:17-3.5`, runs on Debian 11, which reached end of life; the
PostgreSQL apt repository stopped serving it on 2026-10-01 and the image could no longer be
built. PostGIS and pgvector now come from that repository for Debian 12, which ships PostGIS
3.6 (was 3.5). Existing databases upgrade in place: `ALTER EXTENSION postgis UPDATE`. Text is
sorted by code point (`C.UTF-8`), so changing the operating system does not reorder indexes.

**D-055 · Business-service owns all business media, employee photos included.**
Staff profiles belong to booking-service, but their photos live in business-service's
`staff_photos` (with the gallery and logo), keyed by staff id with a composite foreign key so a
photo can't be attached to another business's employee. Removal when someone leaves the team is
event-driven: auth-service publishes `businesses.member_removed`; business-service consumes it
(its first consumer) and deletes the photo, idempotently.

**D-056 · One picture pipeline: private original → checked → cleaned → published.**
Originals go to a private bucket under `incoming/` (expiry rule: 1 day) and are deleted after
cleaning; pending uploads live in Valkey (30 minutes, single use, bound to purpose and owner), so
no table or sweeper is needed. Cleaning with sharp/libvips (Apache-2.0 / LGPL, prebuilt, no
install scripts): auto-orient, strip all metadata, sRGB, resize per use, WebP, 40 MP input
limit, one image at a time per process. Public pictures get a new key on every change so CDNs
can cache them forever. Adds ~55 MB to the auth and business images.

**D-057 · Receipts and queue tickets instead of customer pictures; nothing extra stored.**
Businesses never see a customer's profile picture. Customers identify themselves with what
they already have: the appointment's booking code (`BK-XXXXXX`, a QR of it) or their queue
ticket number (`A-023`). The business sees all receipts and tickets on its side and can serve a
customer without a phone from its own list. Receipts are views of the appointment / queue row,
rendered on request; the QR is drawn by the app from the code, so no PDF, image or file is ever
generated or stored. A screenshot can't be forged into a booking: the business checks against
its own list. The QR carries only the code, never personal data.

**D-058 · Booking settings in their own table; staff profiles without e-mail invites.**
Settings (confirmation mode, horizon, per-customer limit, cancellation window, notice, slot step)
are columns of `booking_settings`, owned by booking-service, with ranges enforced by the database;
no row means the defaults. The Phase 1 staff invite-by-e-mail columns are dropped: employee
accounts (D-034) replace them. A staff profile links to a team account (owner or member, also
before their first sign-in), lets that person manage their own hours, and is deactivated when
they leave the team (`businesses.member_removed`). Working hours and time off can only point at
a staff member of the same business (composite keys). Services and profiles are archived, never
deleted: past appointments point at them.

**D-059 · Free text is stored as plain text.** `sanitizeText` used to keep sanitize-html's
escaping, so "Salt & Pepper" was stored as "Salt &amp; Pepper" and apps (which escape on output)
would show it literally. It now strips tags, decodes the escaping, and repeats until nothing
changes, so stored text contains no tags (also none hidden as `&lt;script&gt;`) and reads as typed.

**D-060 · How booking works.** A pure slot calculator (Intl timezones, no date library,
daylight-saving tested) both shows free times and checks a booking, so only offered times can be
booked. The database settles races: an employee's busy time runs to `blocked_until` (end + clean-up
buffer) and both no-overlap rules are exclusion constraints; "anyone" tries the least-booked free
person first and moves to the next if someone else just took them. The per-customer limit is
counted under an advisory lock per (customer, business). Rescheduling creates a new appointment
(new code) and marks the old one `rescheduled`, allowed until the cancellation window starts.
Declining a request is not counted as a business cancellation.

**D-061 · Arrival is a timestamp, not a status; shifts are their own table.**
Checking in sets `checked_in_at` and keeps the appointment `confirmed`, so the no-overlap rules
keep protecting the visit while it happens; a database rule allows an arrival time only on
confirmed or completed appointments, which makes "checked in, then cancelled" impossible. Check-in
opens 2 hours before the start; a no-show can be recorded after a per-business grace period
(default 15 min) and never after check-in. Employee shifts (`staff_attendance`) have at most one
open shift per person (partial unique index); front desk can clock anyone (shared tablet).

**D-062 · How the queue works.** One session per business per day; every change locks the
session row, so ticket numbers and "who's next" can never be handed out twice. One live ticket
per customer in any queue is a partial unique index (was: per queue). Remote joins are checked
with PostGIS against the business's location; a business without one takes sign-ups at the
counter. The priority lane goes first; "last called" is the ticket most recently called (not the
highest number). Wait estimates divide the people ahead among the staff clocked in and learn the
day's real average service time. Alerts (10, 5, then every step) are events, sent once per count
and only when moving closer. Queue settings live in `queue_settings` (owned by queue-service).

**D-063 · Live queue screens: one public Server-Sent Events stream per business.**
SSE instead of WebSockets: updates only flow one way, it passes through the gateway as plain
HTTP (route with response buffering off), and browsers reconnect by themselves. The stream holds
ticket numbers and the line order only, so it needs no sign-in (tokens are never accepted in
URLs, D-042) and no per-person streams exist: each phone computes its own position. Every
committed change is announced on one Valkey channel; each replica re-reads the queue from the
database (coalesced to one read per 100 ms per watched business), so a late or duplicate
announcement can never show an old state. Heartbeats every 15 s; per-replica and per-address
connection limits; streams are closed before the server stops on shutdown (`beforeClose`),
measured at 0.4 s instead of waiting out the 25 s deadline.

**D-064 · SOC 2 compliance review closes Phase 2.** Requested by the product owner: a review of
the whole system against the SOC 2 Trust Services Criteria with gaps fixed before Phase 3
(BUILD_GUIDE 2.10). Certification itself is done by an independent auditor.

**D-065 · Billing is data, not code.** Plans (with pricing-page benefits, limits and features),
prices per channel and currency, the on/off switch and fallback plans per audience, running costs
and channel fees all live in tables edited by platform admins at any time, every change audited.
Prices are versioned: a change creates a new price and archives the old one, so subscribers keep
what they agreed to (grandfathering) until deliberately moved. Plans are archived, never deleted;
the plans an audience falls back to can't be archived. One resolver (`@buku/billing`
`entitlementsOf`) decides what an account may do: billing off → the "billing off" plan; a live
subscription → its plan; otherwise the default plan; settings missing → unlimited. Limits only
block creating MORE; downgrades never delete anything. Business tiers (Essential $24.99, Professional
$49.99, Enterprise $99.99) differ by team logins, staff, services, photos and features; customers
have Free (1 visit) and BUKU Plus ($1.99 web/Android, $4.99 iPhone to absorb the App Store's cut).
Billing launches switched off until checkout exists (part 3). A billing-service owns it all;
Paddle is the merchant of record on the web (collects and remits sales tax/VAT).

**D-066 · Unbuilt products are recorded as limits/features first.** Ads (Enterprise only) and
priority support exist as plan features now, so the pricing page and entitlements are right from
the start; each is enforced when its product is built.

**D-067 · Free trials, grants and plan requests.** A trial is a subscription with provider
`trial`: one per account ever (partial unique index), started by the account whenever it likes,
ending on its own date (it stops counting at once; a sweeper marks it `expired`). Trial length,
plan and on/off are settings per audience (default 30 days of BUKU Plus / Professional); switching
trials off only stops new ones. Any plan can be given to any account free of charge (admin grant,
optionally until a date, optionally replacing a grant or trial — never a store-billed plan, which
is cancelled in the store). Businesses can request a plan; approval creates the grant. Plan names
are professional: Starter (default), Essential, Professional, Enterprise — editable like
everything else.
