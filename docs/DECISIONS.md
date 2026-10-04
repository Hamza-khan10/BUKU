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

**D-068 · How plan limits are enforced.** Each service checks right where it creates the thing,
inside the same transaction, after taking an advisory lock for that account and limit
(`@buku/billing` `assertVisitAllowed`, `assertBusinessLimit`, `assertBusinessFeature`), so two
parallel requests can't both use the last place (verified: removing the lock makes the race test
fail). Counts are of ACTIVE things (turned-off logins, archived services and inactive staff don't
count; re-activating counts like creating). Platform safety caps remain as abuse guards above any
plan (1,000 team logins, 100 photos). A downgrade never deletes or disables anything.

**D-069 · Web payments through Paddle, by API and signed webhooks.** No Paddle SDK: a small fetch
client (timeouts, no customer data in logs). Checkout is a transaction created server-side with
the BUKU account in `custom_data`, opened by Paddle.js with the public client token. Webhooks are
the source of truth: HMAC-SHA256 over `ts:raw body` (constant-time, any of several signatures for
rotation, 5-minute tolerance), each `event_id` once (`processed_events`, released again if
processing fails so Paddle retries), and ordered by the subscription's `updated_at`. Cancelling
is at the end of the paid period; plan changes are prorated immediately; admins end at once.
Prices are created in Paddle from BUKU's catalog ("sync"), so BUKU stays the place prices change.
Paddle is optional configuration: without its three keys, checkout says so and nothing else is
affected.

**D-070 · `.env` lines never carry an inline comment after an empty value.** Docker Compose
reads `KEY=   # note` as the value `# note`, which made empty optional keys look set (found when
the Paddle all-or-none check refused to start). The template puts such comments on their own
line, and `pnpm bootstrap` rewrites existing `.env` files the same way.

**D-071 · Notifications: inbox always, push as preferred, built from events.** Events carry ids;
notification-service reads names and times (read-only) when it builds a message, so personal data
never travels through Kafka. Each event is handled once: its inbox rows commit with the
idempotency record; pushes go out after the commit (a push failure never causes a redelivery).
Push goes through Expo's push service (free; iPhone and Android from the Expo app; no server
credentials, an access token once push security is on), with a log sender in development.
Each push is recorded per device with its ticket; receipts 15 minutes later mark it delivered or
failed and switch off devices that no longer exist. Messages to businesses go to whoever acts:
the employee doing the service (or the owner), or owner/managers/front desk for approvals.

**D-072 · Partition upkeep is a daily job.** The init migration made 12 months of partitions and
a catch-all DEFAULT partition, but nothing created future months — after a year every audit-log
and inbox row would have landed in the catch-all, which then blocks creating that month.
notification-service runs `maintainPartitions` daily (6 months ahead, one replica at a time) and
warns if a catch-all ever holds rows.

**D-073 · Channels per person, timed messages exactly once.** Every message lands in the inbox;
then `planChannels` (pure, unit-tested) picks the outside channels per person: push to every
device (free); email for receipts and the day-before reminder (if wanted, to a verified address
only), and for everything else only when the person has no app seen in the last 60 days (team
members on the web dashboard, customers who never installed it); never email for the live
queue; account/plan notices always. Timed messages (24 h and 2 h reminders, "book again" after
a "remind me later" cancellation, unanswered requests to approvers, trial/plan ending, trial
over, payment failed) run on schedules and carry a key (`appt:<id>:r24`) stored in
`notification_marks` in the same transaction as the inbox rows, so each goes once whatever the
number of replicas (mutation-tested); a Valkey lock only saves duplicate work. Reminders wait for
morning (quiet hours in the business's timezone, editable) and are skipped rather than sent late;
a reminder that would land right after the booking's confirmation is skipped. Admins edit
switches, quiet hours and WhatsApp money in `notification_settings` at any time (audited, cached
30 s). Emails carry an RFC 8058 one-click unsubscribe for exactly their preference, signed with
an HMAC over (user, preference); GET only shows a button, so mail scanners can't unsubscribe
people. Blank optional env values from Compose count as unset (follow-up to D-070).

**D-074 · WhatsApp: prove the number, use the free window, pay only where the app can't reach.**
Meta charges per template message; replies inside the 24-hour window that opens each time the
person messages us are free (from 1 Oct 2026, the first 1,000 per number per month; utility
templates inside the window are now charged too). So: (1) a number is connected only by the
person sending "BUKU <one-time code>" to our number from it (proof of ownership, consent, and
the window opens); the number lives encrypted in notification-service's `whatsapp_contacts`,
separate from the unverified phone on the account; a number moves to whoever proves it next.
(2) Inside the window, worthwhile messages (booking changes, reminders, "your turn") go as free
text, even to app users, while the month's free allowance lasts. (3) Outside it, a paid template
goes only to people without the app, only for types an admin allowed, and only while the month's
estimated spend (counted per message, price set by the admin) stays under the budget (0 by
default = never pay). (4) Anything they send us gets a free, useful answer (their upcoming visits
and tickets) and keeps the window open; STOP/START switch WhatsApp off/on. Webhooks are verified
with the app secret over the raw body; repeated deliveries and day-old messages change nothing.
Provider: Meta's WhatsApp Cloud API directly (no reseller margin); a `log` sender in development.

**D-075 · Suggestions from how each person uses BUKU — opt-in, capped, useful.** Three kinds of
people get different messages. Regulars (3+ visits at one place in ~13 months at a steady rhythm,
typical gap 5–120 days; a check-in counts as a visit, since not every business marks visits
completed) get "Time for your usual Haircut?" when the next visit is coming due, with a real free
time near their usual hour and with their usual employee if possible — asked from booking-service's
availability endpoint, so the app and the message agree (best effort, at most 30 lookups per run
to stay under its rate limit; without an answer the message goes without a time). People whose
last booking or queue join was 45–180 days ago get "<their most-visited place> is taking
bookings". New accounts that never booked get two first-booking nudges (day 2, day 10). Rules:
opt-in only (`suggestions` for app/push/WhatsApp, as app-store rules require for promotional push;
`marketingEmails` for email, which goes only to people without the app); never paid WhatsApp
(free window only); never when they already have something booked there or are in a queue; never
for employee accounts, suspended or deleted accounts, or places that closed; not at night; once
per visit / quiet spell / step (`notification_marks`); and admin caps — a gap between suggestions
(7 days), a monthly maximum (3), and stop after 3 with no booking in between. Inbox items only for
people who opted in to suggestions (an email-only recipient isn't sent unasked-for app messages).

**D-076 · Search runs on Postgres, live; Elasticsearch only when volume needs it.** One search
document per business (name A; category and active service names B — "haircut" finds barbers;
description C; city D) kept current by triggers whenever the business, a service or a category
changes, so search is never behind. Queries use a prefix full-text query rebuilt from plain words
(no syntax from users reaches Postgres), PostGIS for radius and distance, and typo tolerance on
names (every word of 4+ letters within trigram word-similarity 0.5, shorter ones literally).
Ranking (`relevance`): text match + quality (rating as a Bayesian average — pulled to 4.0 as if
from 5 reviews — 70%, reliability 30%, +0.05 verified) + closeness (half weight at 5 km).
Reliability = visits kept / (kept + confirmed bookings the business cancelled) over 90 days;
declining a request doesn't count; shown from 10 bookings. These and "trending" figures live in
`business_search_stats`, recomputed every 10 minutes. Results show live facts: open now
(business hours in its timezone, minus closures), an open queue and how many are waiting, the
lowest price, cover photo. Only live businesses with something to offer appear; unverified ones
are labelled. "Available on a date" means open that day (exact times are on the profile — computing
slots for every result would be too slow). Query parameters are camelCase like the rest of the API
(the original spec's snake_case is not used). Search events go to `analytics.search` without user,
coordinates or contact-like text. `SEARCH_ENGINE=elasticsearch` is refused until that engine is
built; paid placements slot in with the ads service (`isPromoted`).

**D-077 · Reviews: only real visits, fair to both sides.** A customer reviews their own visit that
happened (completed, or checked in and started) within 30 days, once; a database trigger refuses a
review whose business or customer doesn't match its appointment. They can change it for 7 days
(marked "edited") and delete it any time; the rating is recalculated by the existing trigger.
Reviewers are shown as "Ayesha K." ("A customer" once the account is deleted), with the month of
the visit, never ids or contact details; phone numbers and emails typed into reviews or replies
are masked. Owner and managers reply once per review (edits replace it; the reviewer is told about
the first reply only) and can report a review as offensive, fake, not a customer, personal info or
other — reporting never hides it. Only a platform admin hides one (kept, but no longer shown or
counted) or keeps/restores it, always audited. Customers are asked "How was your visit?" once,
30 minutes to 3 days after it, not at night; owner and managers hear about new reviews. The
business's reliability (D-035) sits next to its rating on the profile and in the review summary,
from the same figures and rule as search (`businessReliability` in `@buku/common`).

**D-078 · Customer reliability encourages, never punishes; owners see where bookings are lost.**
Over the last 12 months at every business, appointments and queue tickets alike: visits
(completed, checked in, queue tickets served) against no-shows (counted in full) and late
cancellations inside the business's window (counted half); ordinary cancellations never count.
Under 3 such events a customer is "New customer". The customer sees their figure, what it's made
of and a tip (`GET /v1/appointments/reliability`); businesses only ever see a label — "Shows up 95%"
or "New customer" — on their appointment list, detail and queue board, never the history. The one
effect is opt-in: a business (with the manual-approval plan feature) may hold bookings from
customers below a percentage it chooses (50–99) for approval instead of confirming them at once;
new customers are never held back. The counting lives in `@buku/database` (`showUpCounts`) so
every service shows the same figure. The cancellation insights (`/v1/businesses/:id/insights/
cancellations`, owner and managers; `/reports` already meant reporting a business) give totals and
rates, reasons, weekday and hour in the business's timezone, per service and employee, a weekly
trend, and how many "remind me later" cancellations booked again.

**D-079 · Acceptance runs the real thing, and every route is checked, not sampled.**
`pnpm acceptance` drives the development stack through the gateway like the apps do, creating
its own businesses and people per run (suspended at the end). Routes are read from each
service's real route setup (stand-in dependencies, nothing called), so new routes are checked
automatically — including ones registered in loops. Without a token every route must answer 401
both through the gateway and straight to the service (the gateway must never be the only lock),
except an explicit `PUBLIC` list where each entry is deliberate; team routes refuse a customer of
another business; admin routes refuse customers. Time is simulated in two places only (moving an
appointment in the database, as the app role) so a reminder and a visit can happen within a run;
the test shops use a timezone where it is daytime, because night-time quiet hours correctly hold
reminders back. Not in CI yet: it needs the full stack with the gateway (Phase 5 staging).

**D-080 · Audit log append-only; a retention schedule nobody can shorten; access reviews and
role changes leave evidence (SOC 2 review).** The app role can insert audit entries but never
update, delete or truncate them — revoked on the table and on every monthly partition (including
ones created later), plus a trigger that refuses changes for any role. The retention schedule is
code: audit log 24 months, notifications and ad events 13 months (whole months dropped by a
`SECURITY DEFINER` database function whose periods are fixed in the function, so the app can
run it but not shorten it), processed-event markers 120 days, published outbox events 7 days,
expired sessions 30 days after expiry; it runs daily and each run is audited. Platform roles
change only through `pnpm admin:role` (operator, written reason, audited, sessions ended at once;
never the last admin). `GET /v1/admin/access-review` lists platform admins with their last
activity (sign-in or session use) and flags anyone inactive for 90 days; generating it is audited,
so quarterly reviews leave evidence.

**D-081 · Two-step sign-in with an authenticator app; required for platform admins.** TOTP (RFC
6238: SHA-1, 6 digits, 30 s, one step of clock drift either side), implemented on Node's crypto
and tested against the RFC vectors — works with Google/Microsoft Authenticator, 1Password and
the rest. Set up by scanning a QR code and entering a code; ten single-use recovery codes are
shown once (stored hashed); the secret is encrypted like other personal data. After Google,
Apple or an employee password, someone with it on gets only a 5-minute challenge (nothing about
the account) and a session after a code; sessions remember that they passed it (an `mfa` claim
that refresh keeps). A code works once (replay refused atomically), five wrong codes lock it for
15 minutes, every step is audited. Platform admin routes refuse any session without it — enforced
once, in the shared `requireRole`, so every service applies it — and admins can't switch it off;
everyone else may turn it on. The development sign-in counts as having passed it (it is refused
in production anyway). Chosen over SMS codes (SIM-swap risk, cost) and over relying on the
Google account's own 2-step setting (not something BUKU can verify).

**D-082 · Supply chain and detection: scanned images, pinned bases, CodeQL, security alerts.**
Every production image is scanned by Trivy in CI and can't merge with a known, fixable high or
critical vulnerability; a CycloneDX bill of materials is kept per image (90 days). Base images
are pinned by digest (a stale cached base was exactly how a fixable OpenSSL issue appeared in the
first scan) and Dependabot proposes new digests weekly. CodeQL (security-extended queries) scans
the code on every PR, on main and weekly. Services count security events
(`security_events_total`: refresh-token reuse, wrong/locked two-step codes, employee lockouts,
admin sessions without two-step, forged webhooks) next to the existing per-route status codes;
`infrastructure/monitoring/alerts.yml` turns them, plus availability, error-rate and latency
signals, into Prometheus alerts (validated by `promtool` in `pnpm verify`), each linked to a
runbook in `docs/compliance/runbooks.md`. Prometheus itself, paging and log shipping are Phase 5.

## Phase 3 — web (2026-10-04)

**D-083 · Clean text: one set of rules, refused at the API, explained in the apps.** A
browser-safe package, `@buku/validation`, defines what text BUKU accepts, by kind: person names
(letters of any script, combining marks, spaces, `. ' -`), titles (names of businesses, services,
categories, cities: also digits and `& , ( ) / + # : !`), one line (addresses, short notes) and
free text (reviews, descriptions: up to two line breaks in a row). Everywhere it refuses emoji and
pictographs, control characters, invisible "format" characters (zero-width spaces, bidirectional
overrides — the "Trojan Source" spoofing trick — byte-order marks, soft hyphens) and private-use
or unassigned code points; zero-width joiners are allowed only between letters, which Urdu,
Persian and Indic scripts need. Names and titles are normalised with NFKC (styled "fancy" and
full-width letters become ordinary ones rather than being refused), other text with NFC. Every
API text field is `zSafeText({ kind, … })` — HTML stripped, then these rules, with a message a
person understands — and `kind` is required, so each field states what it holds. Text people
didn't type into our form (a Google/Apple name, a phone's device name) is cleaned instead of
refused, so sign-in never fails over it. The web uses the same package for instant feedback. The
repository holds itself to the rule too: `pnpm check:hidden` (CI and pre-commit) refuses
invisible characters in committed files. (Emoji can't corrupt the database — it stores Unicode
safely — but refusing them keeps names, search, printed tickets and notifications consistent.)

**D-084 · The visitor's real address, also through the web app's server.** The web app keeps
tokens out of the browser by calling the API from its own server (WEB_PLAN §4), so those
connections come from the web server, not the visitor. Left alone, every visitor would share
the web server's address: one sign-in limit (20 a minute at the gateway) for the whole website,
and audit entries naming the web server instead of the person. The web server now sends the
visitor's address in `X-BUKU-Client-IP` together with a shared key (`WEB_GATEWAY_KEY`, 64 hex
characters, also in Kong's environment). A global Kong rule runs first (rewrite phase): only with
the right key is the address believed — and only if it looks like an IPv4 or IPv6 address —
otherwise it is replaced by the address that actually connected (honouring Kong's trusted proxies
in production), and the key never reaches a service. Kong's rate limits count by that header, and
services take `req.ip` from it (`createHttpApp`, only when a proxy is trusted). Checked by `pnpm
verify`: a spoofed header without the key is ignored, the key makes it count. Rotation: deploy
Kong and the web app together. Rewriting `X-Forwarded-For` instead doesn't work: Kong reads the
request headers before plugins can change them.

**D-085 · The web app's foundation: tokens only in cookies, a nonce CSP, one design system.**
`apps/web` is Next.js 16 (App Router, Turbopack), React 19, Tailwind CSS 4, Radix primitives,
TanStack Query; Vercel hosts it, the API stays on DigitalOcean. Sessions: the web server is the
only holder of tokens (WEB_PLAN §4) — sign-in answers pass through `/api/v1/*`, where tokens
become HttpOnly cookies (access `SameSite=Lax`, refresh `SameSite=Strict; Path=/api`, prefixed
`__Host-`/`__Secure-` over HTTPS) and are removed from the answer, including the session inside a
two-step confirmation; a third cookie with no secret says when the access token lapses so the page
renews once per tab just before. A renewal that loses a race with another tab answers "retry",
an API outage never signs anyone out, and signing out ends the session at the API too. Cross-site
use is refused by a custom header plus `Origin`/`Sec-Fetch-Site`. Every page gets a fresh CSP
nonce with `'strict-dynamic'`, so every page is rendered per request (public data is still cached
at the fetch level); styles allow inline (see WEB_PLAN §4 for why). The design system is
CSS-variable tokens whose every text pairing is AA-checked numerically in both themes; the theme
is a cookie the server reads (no flash, no inline script). Text inputs apply D-083 while typing
(removed with a polite note, cursor kept, IME composition untouched, normalised on leaving).
Browser tests (desktop and phone: CSP and headers, axe WCAG 2.2 AA in both themes, clean text,
the session round trip) run in CI against the production build. `@buku/validation` uses
extensionless imports because Turbopack doesn't map ".js" to ".ts". The Next.js ESLint plugin is left out:
it pulls in a package with an unfixed high advisory (GHSA-vfj7-8cjw-p6xm); its rule that matters
here, internal links through `<Link>`, is a `no-restricted-syntax` selector. Service images copy
the web app's manifest only and install without it (Next.js never enters them).

**D-086 · A per-address ceiling in every service, and open code-scanning findings cleared.**
Code scanning (D-082) had collected 115 open findings on `main`; the CodeQL check only blocks new
ones on a pull request. 112 said routes weren't rate-limited: true of the code it could see, not
of the system — the gateway limits every route per visitor address and services aren't reachable
except through it — but a service that is ever reached directly (a misconfiguration, an internal
caller gone wrong) would then have no ceiling at all. So `createHttpApp` now gives every service a
per-address ceiling of its own (3000 requests a minute per process, far above the gateway's
limits, so it never touches normal use; health, readiness and metrics are exempt). The other three
were fixed: two-step recovery codes drew characters with `byte % 31`, which favours some (now
`randomInt`); the acceptance script logged whole errors, which can carry API answers (now the
message only); a test's fake push server trusted a request field's type. The ceiling is built on
`express-rate-limit`, which code scanning recognises, so the scanner itself confirms every route
has one rather than its findings being dismissed by hand. Triage of new findings is
part of every pull request from here on.
