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
