# BUKU database architecture (v2)

The database BUKU is built on from here: designed for hundreds of millions of people in many
countries, for recovery from any disaster, and for security that survives a leaked backup or a
compromised service. Every decision below has a number (DB-…) and a reason. Where this document
and the code disagree, this document is the plan and the code is the state; the build phases at
the end say what is done.

Status: **design approved by the owner's brief (2026-10-16); phase D1 next.** Website work pauses
until D1–D3 are done (DB-000).

---

## 1. Why now (DB-000)

**Decision:** rebuild the database now, before more of the website, not after it.

**Why:**

- There is no production data. Every change below (new key types, new tables, partitioning,
  sharding) is a rebuild today and a months-long, risky data migration later.
- Every website page built on the current schema is more code to rework. The key change alone
  (DB-002) touches every service and page.
- What can wait does wait: physical shard servers, cross-region replicas and backup servers are
  deployment work (Phase 5). The schema, the shard registry, the routing code, partitioning,
  indexing and the backup set-up are designed and built now and run with one shard locally.

---

## 2. What the current database is (audit, 2026-10-16)

Measured on the development database, not guessed:

| Finding                                         | Detail                                                                                | Verdict                                                                                                                                                                  |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 56 tables (54 `public`, 1 `ai`, 1 `extensions`) | one database, one schema for every service                                            | needs per-domain placement (DB-004)                                                                                                                                      |
| 3 partitioned tables                            | `audit_logs`, `notifications`, `ad_events`, monthly by `created_at` (272 partitions)  | right idea, too few; nothing else that grows without end is partitioned (DB-006)                                                                                         |
| Primary keys                                    | `uuid` (UUIDv7, time-ordered) on 51 tables                                            | works, but 16 bytes in every key and index, and unreadable as ranges (DB-002)                                                                                            |
| Indexes                                         | most tables have more than the primary key (appointments 12, businesses 12, users 9)  | **23 foreign keys have no index** (e.g. `appointments.service_id`, `checked_in_by_id`, every `reviewed_by_id`): deleting a user or a service scans whole tables (DB-007) |
| Hashes                                          | blind indexes and token hashes stored as 64-character hex (`char(64)`): 64 bytes each | twice the bytes of the same value in binary, four times what a lookup needs (DB-008)                                                                                     |
| Encrypted fields                                | base64 text (≈112 bytes for an email)                                                 | ~25% larger than binary (DB-008)                                                                                                                                         |
| Money                                           | `numeric(12,2)`                                                                       | exact, but slower to sum than integers (DB-009)                                                                                                                          |
| Access                                          | a login role per service, granted only its own tables (D-092)                         | good; kept                                                                                                                                                               |
| Row-level security                              | on 1 table                                                                            | defence in depth is thin (DB-020)                                                                                                                                        |
| Encryption in transit                           | `ssl = off` (development)                                                             | production must require TLS 1.3 (DB-020)                                                                                                                                 |
| Backups                                         | `archive_mode = off`, no backup schedule                                              | **no point-in-time recovery, no disaster recovery** (DB-030…035)                                                                                                         |
| Sharding                                        | none; no registry                                                                     | needed before ~10M users (DB-010…015)                                                                                                                                    |

What is already right and stays: field-level encryption of personal data with blind indexes
(D-083), least-privilege service roles (D-092), an outbox for events, append-only audit logs,
exclusion constraints that make double bookings impossible (D-036), soft deletes.

---

## 3. Targets the design is built for

|                             | Target                                                                                             |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| People                      | 100M+ customers, 10M+ businesses, in many countries                                                |
| Bookings                    | ~2 billion appointments a year at full scale; queue tickets similar                                |
| Reads                       | p99 < 20 ms for a single-entity read; p99 < 100 ms for a business's day                            |
| Writes                      | 50k bookings/s at peak across the fleet (scales by adding shards)                                  |
| RPO (data that may be lost) | 0 for a server failure; ≤ 1 minute for a whole-region disaster                                     |
| RTO (time to recover)       | ≤ 1 minute automatic failover in a region; ≤ 1 hour to another region                              |
| Backups                     | point-in-time recovery for 35 days; monthly copies for 1 year; immutable copies in a second region |
| Residency                   | a person's or business's data can be kept in its region (e.g. EU)                                  |

---

## 4. Topology

```mermaid
flowchart LR
  subgraph Apps
    S[Services] --> R[Shard router in @buku/database]
  end
  R -->|which shard?| D[(Directory cluster<br/>registry + reference data)]
  R -->|user data| U1[(User shard 1<br/>0–10M users)]
  R --> U2[(User shard 2<br/>10–20M users)]
  R -->|business data| B1[(Business shard 1)]
  R --> B2[(Business shard 2)]
  U1 & U2 & B1 & B2 -->|CDC via outbox / WAL| K[[Kafka]] --> W[(ClickHouse<br/>analytics warehouse)]
  U1 & U2 & B1 & B2 & D -->|WAL archive + base backups| BK[(Encrypted backups<br/>2 regions, immutable)]
```

- **Directory cluster** (one per deployment, highly available): the shard registry, ID generator
  leases, and small reference tables every shard needs (categories, plans, settings).
- **User shards**: everything that belongs to one person.
- **Business shards**: everything that belongs to one business, including its appointments and
  queues.
- **Logical vs physical shards (DB-011):** a shard is a logical unit (a numbered database). Many
  logical shards can live on one physical cluster at first and be moved to their own cluster later
  without changing any ID. Locally and at launch: every logical shard on one cluster.
- Each physical cluster: 1 primary + 1 synchronous standby (another zone) + 1 asynchronous replica
  (another region), managed by Patroni, behind PgBouncer (DB-031).

---

## 5. Identifiers

### DB-001 · Every row has a 64-bit internal ID and, where it is ever shown, a public ID

**Decision:** primary keys are `bigint` (8 bytes). Anything that appears in a URL, an API response
or a receipt also has a `public_id`: 12 characters of Base62 from a cryptographic random source
(71 bits).

**Why:** `bigint` keys halve the size of every primary key, foreign key and index compared with
`uuid` (16 bytes): at 2 billion appointments with five keys each that is ~80 GB less, before
indexes, and smaller indexes stay in memory. Internal IDs are never shown, because ordered IDs can
be counted and guessed ("business 1,000,451 exists, so does 1,000,452"), which leaks business
volume and invites enumeration attacks. Public IDs are random, so they leak nothing.

### DB-002 · Internal IDs are time-ordered "snowflake" IDs, made without a central counter

**Decision:** a 64-bit ID made of three parts:

```
 0 | 41 bits: milliseconds since 2026-01-01T00:00:00Z | 10 bits: generator | 12 bits: sequence
     (good until 2095)                                 (1,024 generators)   (4,096 IDs per ms each)
```

- **Generators** are leased from the directory (`id_generators`, DB-013) by each running service
  instance, so two instances never share one; a lease that isn't renewed expires.
- The **top 3 generator bits name the region** (8 regions), so an ID says where it was made
  without a lookup.
- A SQL function `buku_id()` makes IDs inside the database (migrations, seeds), from generators
  reserved for that purpose.

**Why:** time-ordered IDs keep inserts at the end of every index (no random page splits, unlike
UUIDv4), sort by creation time for free, and let partitions be pruned by ID range. No central
sequence means no single point of failure and no round trip per insert. 4M IDs per second per
generator is far beyond need.

**Not chosen:** keeping UUIDv7 (twice the size, awkward ranges); a central sequence per table
(a single point of failure, and block allocation adds complexity for nothing the snowflake doesn't
already give).

---

## 6. Sharding

### DB-010 · Shard by owner: people on user shards, businesses on business shards

**Decision:** two shard families.

- **User shards** hold what belongs to one person: account, sign-in, tokens, devices,
  preferences, notifications, favourites, and _their view_ of their bookings and queue tickets.
- **Business shards** hold what belongs to one business: profile, team, services, staff,
  schedules, **appointments**, queues, reviews, billing, ads.

Every child row lives on its parent's shard (**co-location**), so every everyday query and join is
on one shard: a business's day, a person's bookings, a service's staff.

**Why:** the busiest queries are "this business's day" and "this person's things". Appointments go
with the business because availability, double-booking checks and the front desk all read a
business's appointments together, under one lock.

### DB-011 · Range shards of 10 million, a limit that can be changed at any time

**Decision:** each shard family has a registry (§6.2). A shard covers one range of internal IDs:
`min_id` from its first row, `max_id` set when it fills. A shard accepts new rows until its
`row_limit` is reached, then closes and the next one opens.

- Default limits: **users 10,000,000 per shard** (the owner's brief); **businesses 1,000,000 per
  shard**, because one business brings far more rows than one person (appointments, tickets,
  reviews).
- The limit is a column, changed with one `UPDATE` (audited). Lowering it below the current count
  closes the shard at the next new row; raising it lets a shard keep filling.
- Because IDs only grow, the ranges never overlap: finding a row's shard is "the shard whose range
  contains this ID", in the same region (the region is read from the ID, DB-002).

**Why:** this is the owner's design, and it gives shards a fixed, known size, so capacity
planning, backup time and restore time per shard are predictable.

**The trade-off, handled:** all new people sign up on the newest user shard, so it gets the most
new activity. That's why shards are _logical_ (DB-012): the newest shard starts on the strongest
cluster, older and quieter shards move to cheaper clusters, and moving a shard never changes an
ID.

### DB-012 · Logical shards on physical clusters

**Decision:** `shard_clusters` lists physical clusters (region, connection secret name, role); each
shard row points at one. Moving a shard means copying it to another cluster (logical replication),
then switching the pointer in one transaction while writes for that shard pause for seconds.

**Why:** shards can be rebalanced and tiered without downtime or any change to IDs or code.

### DB-013 · The registry

On the directory cluster, schema `registry`:

```sql
CREATE TABLE registry.shard_settings (
  entity           text PRIMARY KEY CHECK (entity IN ('user', 'business')),
  default_row_limit bigint NOT NULL CHECK (default_row_limit > 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  updated_by       bigint                        -- the admin who changed it (audited)
);

CREATE TABLE registry.shard_clusters (
  cluster_id   smallint PRIMARY KEY,
  region       smallint NOT NULL,              -- 0..7, the same code as in IDs
  name         text NOT NULL UNIQUE,           -- 'pk-1', 'eu-1'
  dsn_secret   text NOT NULL,                  -- the NAME of the secret holding the DSN, never the DSN
  status       text NOT NULL CHECK (status IN ('active', 'draining', 'retired')),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE registry.shards (
  entity        text NOT NULL CHECK (entity IN ('user', 'business')),
  region        smallint NOT NULL,
  shard_no      integer NOT NULL,              -- 1, 2, 3… per entity and region
  min_id        bigint NOT NULL,               -- first ID in this shard
  max_id        bigint,                        -- last ID; NULL while the shard is open
  row_limit     bigint NOT NULL CHECK (row_limit > 0),
  row_count     bigint NOT NULL DEFAULT 0,     -- rows placed here (kept by the allocator)
  status        text NOT NULL CHECK (status IN ('open', 'full', 'read_only', 'moving')),
  cluster_id    smallint NOT NULL REFERENCES registry.shard_clusters,
  database_name text NOT NULL,                 -- the logical shard's database on that cluster
  opened_at     timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz,
  PRIMARY KEY (entity, region, shard_no),
  CHECK (max_id IS NULL OR max_id >= min_id),
  CHECK ((status = 'open') = (max_id IS NULL))
);
-- One open shard per entity and region; ranges never overlap.
CREATE UNIQUE INDEX shards_one_open ON registry.shards (entity, region) WHERE status = 'open';
ALTER TABLE registry.shards ADD CONSTRAINT shards_no_overlap
  EXCLUDE USING gist (entity WITH =, region WITH =, int8range(min_id, max_id, '[]') WITH &&);

CREATE TABLE registry.id_generators (
  generator_id  smallint PRIMARY KEY CHECK (generator_id BETWEEN 0 AND 1023),
  region        smallint NOT NULL,             -- = generator_id >> 7
  leased_by     text,                          -- service instance
  lease_expires timestamptz
);
```

**Placing a new person or business** (one short transaction on the directory, row-locked):
take the open shard for the entity and region, make the ID, add one to `row_count`; if the count
reaches `row_limit`, set `max_id`, mark it `full` and open the next shard with `min_id` = the next
ID. Routing an existing ID reads a cached copy of the registry (a few hundred rows), refreshed on a
version bump, so it costs no round trip.

### DB-014 · Rules that cross shards

- **No database foreign keys across shards** (they can't exist). A business's owner is a person on
  a user shard: the business row keeps `owner_user_id` as a plain `bigint`, checked by the service
  when written, and kept consistent by events (e.g. a deleted person's businesses are handled by the
  `users.deleted` consumer, as today).
- **One appointment at a time per person, across all businesses (D-036)** stays a database
  guarantee: the booking first claims the time on the person's shard in
  `user_time_reservations` (an exclusion constraint on `(user_id, time range)`), then writes the
  appointment on the business shard; if the second step fails, the claim is released. A sweeper
  removes claims with no appointment after 2 minutes.
- **One queue at a time per person** works the same way (`user_active_ticket`, one row per person).
- **"My bookings" and "my businesses"** are read from small index tables on the person's shard
  (`user_appointments`, `user_business_roles`), kept up to date from the business shards' outbox
  events. They hold only what a list needs (IDs, times, names), so the person's pages are one-shard
  reads.

### DB-015 · Reference data is global and copied, not sharded

Categories, plans and prices, billing and notification settings, cities: a few thousand rows
that every shard reads. They live on the directory and are copied to every shard (read-only there)
by logical replication, so joins with them stay local.

---

## 7. Partitioning and retention

### DB-006 · Partition what grows without end, by time; leave the rest alone

**Decision:** declarative range partitions, created ahead and dropped behind by `pg_partman`,
scheduled by `pg_cron`:

| Table (shard)                                | Partitioned by | Partition size | Kept online           | Then                                            |
| -------------------------------------------- | -------------- | -------------- | --------------------- | ----------------------------------------------- |
| `appointments` (business)                    | `start_at`     | month          | 25 months             | detached to cheap storage, still restorable     |
| `appointment_events` (business)              | `created_at`   | month          | 25 months             | same                                            |
| `queue_tickets` (business)                   | `created_at`   | month          | 13 months             | same                                            |
| `staff_shifts` (business)                    | `started_at`   | month          | 25 months             | same                                            |
| `notifications` (user)                       | `created_at`   | month          | 6 months              | dropped (they're also in email/push)            |
| `refresh_tokens` (user)                      | `expires_at`   | week           | until expiry + 7 days | dropped                                         |
| `outbox_events` (every shard)                | `created_at`   | day            | 7 days after sent     | dropped                                         |
| `processed_events` (every consumer)          | `processed_at` | day            | 14 days               | dropped                                         |
| `audit_logs` (every shard)                   | `created_at`   | month          | 25 months online      | copied to immutable storage first, kept 7 years |
| `ad_events`, `webhook_deliveries` (business) | `created_at`   | month / week   | 13 months / 30 days   | dropped                                         |

**Why:** these are the tables that reach billions of rows. Monthly partitions keep each one's
indexes small, let queries on "this month" touch one partition, and turn deleting old data into
dropping a partition (instant, no bloat, no vacuum storm). Small tables (settings, services, staff)
gain nothing from partitions and pay overhead, so they stay plain.

**Keys on partitioned tables:** PostgreSQL requires the partition key in a partitioned table's
primary key, so `appointments` has `PRIMARY KEY (id, start_at)` and rows that point at an
appointment carry both (`appointment_id`, `appointment_start_at`). The snowflake ID alone stays
unique (DB-002).

---

## 8. Indexes and storage

### DB-007 · Index rules

1. **Every foreign key has an index** that starts with its columns (fixes the 23 gaps found).
2. Every index on a sharded table **starts with the owner key** (`business_id`, `user_id`) when
   queries filter by owner, so a business's or person's rows are next to each other.
3. **Partial indexes** for the rows that matter: `WHERE deleted_at IS NULL`, `WHERE status IN
('pending','confirmed')`.
4. **Covering indexes** (`INCLUDE`) for the lists that run all day (a business's day, a person's
   upcoming visits), so they never touch the table.
5. **BRIN indexes** on time columns of the biggest append-only tables (audit, events): a few
   kilobytes instead of gigabytes.
6. **No unused or duplicate indexes:** `pg_stat_statements` and `pg_stat_user_indexes` are reviewed
   every release; an index nothing uses is removed.
7. Every index added in a migration is created `CONCURRENTLY` on large tables.

### DB-008 · Hashes and encrypted values are stored as bytes, at the size they need

| Value                                             | Now                             | v2                                                         | Why                                                                                                                                                    |
| ------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Blind indexes (email, phone, registration number) | 64 hex chars                    | `bytea`, **16 bytes** (HMAC-SHA-256 truncated to 128 bits) | 128 bits is collision-free at any number of people we'll ever have (a collision needs ~2⁶⁴ values) and still keyed (the key never leaves the services) |
| Token hashes (refresh, reset)                     | 64 hex chars                    | `bytea`, 32 bytes (SHA-256)                                | tokens are random 256-bit values; the full hash keeps them unguessable                                                                                 |
| Encrypted fields (email, phone, secrets)          | base64 text                     | `bytea`                                                    | ~25% smaller, no encoding step                                                                                                                         |
| Password hashes                                   | Argon2id PHC string (≈97 chars) | unchanged                                                  | the standard self-describing format; parameters can change per user. Its size is fixed and small next to everything else                               |
| IP addresses (ads, security)                      | hex hash                        | `bytea` 16 bytes, keyed                                    | same as blind indexes                                                                                                                                  |

At 100M people this alone saves ~30 GB of table and index space on user shards.

### DB-009 · Money in integer minor units

**Decision:** amounts are `bigint` in the currency's minor unit (paisa, cents), with the
currency's exponent from a reference table.

**Why:** exact like `numeric`, but 8 bytes, and sums and comparisons are integer operations (much
faster in reports). The payment industry stores money this way.

### DB-016 · Rows laid out to waste nothing

Columns are ordered by size in every `CREATE TABLE` (8-byte, then 4-byte, 2-byte, 1-byte, then
variable length), so PostgreSQL's alignment adds no padding. On a row with mixed types this saves
10–30% of the row header and padding.

---

## 9. Diagrams (entity–relationship)

Solid lines are foreign keys inside a shard. Dotted lines (`..`) are references across shards,
kept by the services and events (DB-014). Keys: `id` is the internal `bigint`; `public_id` is shown
only where it exists.

### 9.1 Directory and reference data

```mermaid
erDiagram
  shard_settings ||--o{ shards : "default limit for"
  shard_clusters ||--o{ shards : hosts
  id_generators }o..|| shard_clusters : "region of"
  categories ||--o{ categories : "group of"
  plans ||--o{ plan_prices : "priced as"
  plans ||--o{ billing_settings : "used by"
  currencies ||--o{ plan_prices : "in"

  shards {
    text entity PK
    smallint region PK
    int shard_no PK
    bigint min_id
    bigint max_id
    bigint row_limit
    bigint row_count
    text status
    smallint cluster_id FK
  }
  shard_settings {
    text entity PK
    bigint default_row_limit
  }
  shard_clusters {
    smallint cluster_id PK
    smallint region
    text name
    text dsn_secret
    text status
  }
  id_generators {
    smallint generator_id PK
    smallint region
    text leased_by
    timestamptz lease_expires
  }
  categories {
    bigint id PK
    bigint parent_id FK
    text slug UK
    text name
    bytea name_key UK
    bool pending
  }
  plans {
    bigint id PK
    text code UK
    text audience
  }
  plan_prices {
    bigint id PK
    bigint plan_id FK
    char currency FK
    bigint amount_minor
    text channel
  }
  currencies {
    char code PK
    smallint exponent
  }
```

### 9.2 A person (user shard)

```mermaid
erDiagram
  users ||--o{ oauth_accounts : "signs in with"
  users ||--o| user_mfa : "protects with"
  users ||--o{ refresh_tokens : "holds"
  users ||--o{ push_tokens : "receives on"
  users ||--|| notification_preferences : "chooses"
  users ||--o{ notifications : "gets"
  users ||--o{ favourites : "saves"
  users ||--o{ user_appointments : "sees (index)"
  users ||--o{ user_time_reservations : "claims time"
  users ||--o| user_active_ticket : "waits with"
  users ||--o{ user_business_roles : "works at (index)"
  users ||--o{ whatsapp_contacts : "talks on"
  favourites }o..|| businesses : "points at"
  user_appointments }o..|| appointments : "mirrors"

  users {
    bigint id PK
    char public_id UK
    smallint region
    bytea email_hash UK
    bytea phone_hash UK
    bytea email_enc
    bytea phone_enc
    text name
    text role
    text status
    timestamptz created_at
    timestamptz deleted_at
  }
  oauth_accounts {
    bigint id PK
    bigint user_id FK
    text provider
    bytea subject_hash UK
  }
  user_mfa {
    bigint user_id PK
    bytea secret_enc
    bytea[] recovery_hashes
  }
  refresh_tokens {
    bigint id PK
    timestamptz expires_at PK
    bigint user_id FK
    bytea token_hash UK
  }
  notifications {
    bigint id PK
    timestamptz created_at PK
    bigint user_id FK
    text kind
    jsonb data
    timestamptz read_at
  }
  user_appointments {
    bigint user_id PK
    bigint appointment_id PK
    bigint business_id
    timestamptz start_at
    text status
  }
  user_time_reservations {
    bigint id PK
    bigint user_id FK
    tstzrange during
    bigint appointment_id
    timestamptz expires_at
  }
  user_active_ticket {
    bigint user_id PK
    bigint ticket_id
    bigint business_id
  }
  user_business_roles {
    bigint user_id PK
    bigint business_id PK
    text role
  }
```

### 9.3 A business (business shard)

```mermaid
erDiagram
  businesses ||--o{ business_members : "employs"
  businesses ||--o{ business_hours : "opens"
  businesses ||--o{ business_photos : "shows"
  businesses ||--o| business_legal_profiles : "registered as"
  businesses ||--o{ business_documents : "proves with"
  businesses ||--o| booking_settings : "books by"
  businesses ||--o| queue_settings : "queues by"
  businesses ||--o{ service_groups : "groups"
  service_groups ||--o{ services : "contains"
  businesses ||--o{ services : "offers"
  businesses ||--o{ staff : "has"
  staff ||--o{ staff_services : "does"
  services ||--o{ staff_services : "done by"
  staff ||--o{ availability_rules : "works"
  staff ||--o{ availability_exceptions : "is away"
  staff ||--o{ staff_shifts : "clocks"
  businesses ||--o{ resources : "uses"
  businesses ||--o{ appointments : "takes"
  services ||--o{ appointments : "for"
  staff ||--o{ appointments : "with"
  appointments ||--o{ appointment_events : "history"
  appointments ||--o| reviews : "reviewed in"
  businesses ||--o{ queue_sessions : "runs"
  queue_sessions ||--o{ queue_tickets : "issues"
  businesses ||--o{ subscriptions : "pays"
  businesses ||--o{ business_ads : "advertises"
  business_ads ||--o{ ad_events : "counts"
  businesses }o..|| users : "owned by"
  business_members }o..|| users : "is"
  appointments }o..|| users : "booked by"
  businesses }o..|| categories : "is a"

  businesses {
    bigint id PK
    char public_id UK
    text slug UK
    smallint region
    bigint owner_user_id
    bigint category_id
    text name
    text status
    text timezone
    char currency
    geography location
    timestamptz deleted_at
  }
  business_members {
    bigint id PK
    bigint business_id FK
    bigint user_id
    text role
    text status
  }
  services {
    bigint id PK
    bigint business_id FK
    bigint group_id FK
    text name
    int duration_min
    bigint price_minor
    bool active
  }
  staff {
    bigint id PK
    bigint business_id FK
    bigint user_id
    text display_name
    bool active
  }
  appointments {
    bigint id PK
    timestamptz start_at PK
    char public_id UK
    char code UK
    bigint business_id FK
    bigint user_id
    bigint service_id FK
    bigint staff_id FK
    timestamptz end_at
    text status
    timestamptz checked_in_at
    bigint price_minor
  }
  appointment_events {
    bigint id PK
    timestamptz created_at PK
    bigint appointment_id
    timestamptz appointment_start_at
    text from_status
    text to_status
    bigint actor_id
  }
  queue_sessions {
    bigint id PK
    bigint business_id FK
    date day
    text status
  }
  queue_tickets {
    bigint id PK
    timestamptz created_at PK
    bigint session_id FK
    bigint business_id FK
    bigint user_id
    text ticket
    text status
  }
  reviews {
    bigint id PK
    bigint business_id FK
    bigint appointment_id
    bigint user_id
    smallint rating
  }
```

### 9.4 Analytics warehouse (ClickHouse, star schema)

```mermaid
erDiagram
  fact_appointments }o--|| dim_business : at
  fact_appointments }o--|| dim_user : by
  fact_appointments }o--|| dim_service : for
  fact_appointments }o--|| dim_date : on
  fact_queue_tickets }o--|| dim_business : at
  fact_queue_tickets }o--|| dim_date : on
  fact_reviews }o--|| dim_business : of
  dim_business }o--|| dim_category : "is a"
```

Facts carry the same internal IDs as the shards, so every join that is impossible across shards
(e.g. "bookings per category per city per month") is a plain join here (DB-040).

---

## 10. Table catalogue

Where every current table goes. "→" is its v2 name when it changes.

| Current table                                                                                                                                                                         | Home                         | Partitioned            | Notes                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------------- | -------------------------------------------------- |
| users                                                                                                                                                                                 | user shard                   | no (sharded)           | bigint id + public_id; bytea blind indexes; region |
| oauth_accounts, user_mfa, push_tokens, notification_preferences, notification_marks, whatsapp_contacts, favourites                                                                    | user shard                   | no                     | co-located by `user_id`                            |
| refresh_tokens                                                                                                                                                                        | user shard                   | weekly by `expires_at` | dropped after expiry                               |
| notifications                                                                                                                                                                         | user shard                   | monthly                | 6 months                                           |
| — (new) user_appointments, user_time_reservations, user_active_ticket, user_business_roles                                                                                            | user shard                   | no                     | DB-014                                             |
| businesses, business_members, business_hours, business_photos, business_documents, business_legal_profiles, business_reports, business_search_stats, booking_settings, queue_settings | business shard               | no                     | co-located by `business_id`                        |
| services, service_categories → service_groups, staff, staff_services, staff_photos, resources, availability_rules, availability_exceptions                                            | business shard               | no                     |                                                    |
| staff_attendance → staff_shifts                                                                                                                                                       | business shard               | monthly                |                                                    |
| appointments                                                                                                                                                                          | business shard               | monthly by `start_at`  | PK `(id, start_at)`                                |
| appointment_status_history → appointment_events                                                                                                                                       | business shard               | monthly                |                                                    |
| queue_sessions                                                                                                                                                                        | business shard               | no                     |                                                    |
| queue_entries → queue_tickets                                                                                                                                                         | business shard               | monthly                |                                                    |
| reviews, payments, subscriptions, plan_requests                                                                                                                                       | business shard               | no                     | user subscriptions stay dormant (D-101)            |
| business_ads, webhooks                                                                                                                                                                | business shard               | no                     |                                                    |
| ad_events, webhook_deliveries                                                                                                                                                         | business shard               | monthly / weekly       |                                                    |
| ai_receptionist_configs, ai_call_logs, ai.business_knowledge_chunks                                                                                                                   | business shard               | ai_call_logs monthly   |                                                    |
| audit_logs                                                                                                                                                                            | every shard                  | monthly                | + immutable archive (DB-022)                       |
| outbox_events, processed_events                                                                                                                                                       | every shard / consumer       | daily                  |                                                    |
| categories, plans, plan_prices, billing_settings, billing_channel_fees, billing_cost_items, notification_settings                                                                     | directory (copied to shards) | no                     | DB-015                                             |
| — (new) registry.*, currencies                                                                                                                                                        | directory                    | no                     | DB-013, DB-009                                     |

---

## 11. Security

### DB-020 · Defence in depth, layer by layer

1. **Network:** databases only on private networks; no public address; firewall allows only the
   service hosts and the bastion.
2. **Transport:** `hostssl` only, TLS 1.3 minimum, server certificate verified by every client
   (`sslmode=verify-full`).
3. **Authentication:** SCRAM-SHA-256; one login role per service (kept from D-092), each granted only
   its own tables and only the verbs it uses; no service uses a superuser or owns tables; the
   migrator role is used only by migrations.
4. **Row-level security** on business-shard tables as a second wall: each transaction sets
   `buku.business_id` and policies allow only that business's rows, so a bug that forgets a
   `WHERE business_id = …` returns nothing instead of another business's data.
5. **Field encryption** of personal data (AES-256-GCM, keys versioned and rotatable, D-083) and
   keyed blind indexes (DB-008): a stolen backup or disk shows no emails or phone numbers.
6. **Keys** live in a key manager (KMS), never in the database or its backups; services get them at
   start.
7. **Timeouts per role** (`statement_timeout`, `idle_in_transaction_session_timeout`, `lock_timeout`)
   so one bad query can't hold a shard.
8. **Encryption at rest** of every disk and every backup (DB-033).

### DB-021 · People who touch the database

- No standing human access to production. Access is **break-glass**: time-limited (1 hour),
  requires two-step sign-in and a reason, read-only by default, and every statement is logged.
- Development and test data is always synthetic (the seed). Production data is never copied to
  any other environment.

### DB-022 · Audit that can't be rewritten

- `pgaudit` logs every DDL, role and permission change, and every human session.
- Application audit rows (`audit_logs`) are append-only for every role (no `UPDATE`/`DELETE`
  grant), and each month's partition is copied to object storage with **object lock** (WORM) before
  it leaves the database: kept 7 years.

---

## 12. Backups and disaster recovery

### DB-030 · Continuous archiving and point-in-time recovery

**Decision:** `pgBackRest` on every cluster: WAL archived continuously (`archive_timeout = 60s`),
a full backup weekly, differential daily, incremental every 6 hours. Point-in-time recovery to any
second in the last **35 days**.

**Why:** a full backup alone loses up to a day; with WAL, at most the last minute (and nothing for a
single-server failure, DB-031).

### DB-031 · High availability in a region

Each cluster: primary + **synchronous** standby in another zone (no committed write is ever lost if
the primary dies) + Patroni with a consensus store (etcd) for automatic failover in under a minute.
PgBouncer in front, so services reconnect without noticing.

### DB-032 · Another region

An asynchronous standby of every cluster in a second region (a few seconds behind), plus the
backups (DB-033). Region failover is a documented, rehearsed runbook (promote, switch the registry's
cluster pointers, switch DNS): **≤ 1 hour**.

### DB-033 · Where backups live

Two object stores in two regions, both encrypted (AES-256, keys in KMS), the second with object lock
(backups can't be deleted or altered for 35 days, even by an administrator: protection against
ransomware and mistakes). Monthly full backups kept 12 months.

### DB-034 · Restores are tested, not assumed

- **Every day:** `pgbackrest verify` checks every backup and WAL file.
- **Every week (automatic):** the latest backup of one shard, picked in turn, is restored to a
  scratch server, brought to a point in time, and checked: row counts against the source, sample
  checksums, and the service smoke tests. The result is a metric; a failure pages someone.
- **Every quarter:** a full region-failover exercise.

### DB-035 · Logical safety nets

Mistakes that replicate instantly (a wrong `DELETE`) are recovered by point-in-time restore of the
affected shard to a side server and copying back the rows. Soft deletes (`deleted_at`) and the
audit log make most mistakes reversible without a restore.

---

## 13. Analytics and joins

### DB-040 · Analytics run on a warehouse, never on the shards

**Decision:** every shard's changes stream to ClickHouse (outbox events today; WAL change data
capture with Debezium at scale) into the star schema of §9.4. Dashboards, reports, the profit
calculator and any cross-business question read the warehouse.

**Why:** questions across all businesses or all people need joins across shards, which a sharded
OLTP database can't do quickly, and heavy reports must never slow down booking. The warehouse is
built for scans and aggregates over billions of rows.

**Joins on the shards** are kept fast by co-location (DB-010): every join a page needs is inside
one shard, on indexed keys.

---

## 14. Operations

- **Extensions:** `pg_stat_statements` (query costs), `pgaudit`, `pg_partman`, `pg_cron`,
  `btree_gist` (exclusion constraints), `pg_trgm` (search), `postgis` (places), `vector` (AI); all
  in the BUKU Postgres image.
- **Connection pooling:** PgBouncer in transaction mode per cluster; Prisma connects through it.
- **Monitoring:** replication lag, WAL archive lag, backup age, bloat, slow queries, connection
  saturation, partition coverage (a missing future partition is an alert).
- **Migrations:** expand → migrate → contract; every shard migrated by the same migration, tracked
  per shard; large indexes `CONCURRENTLY`.

---

## 15. Build phases

| Phase                 | What                                                                                                                                                                                                                                                     | Done when                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1 Foundation**     | Postgres image with the extensions; directory schema (registry, generators, settings, currencies); the ID generator (`@buku/ids`: TypeScript and `buku_id()` in SQL) and public IDs; the shard router in `@buku/database` (one shard per family locally) | unit and integration tests for IDs (uniqueness under concurrency, ordering, region bits), allocation (limit reached → next shard, limit changed), routing |
| **D2 Schema v2**      | the new baseline: every table rebuilt per §5–§10 (bigint keys, public IDs, bytea hashes, money in minor units, partitions, every index, constraints, the new user-side tables), RLS policies, grants per service; a new seed                             | migrations apply on an empty database; the seed loads; constraint tests (double booking, overlaps, one queue) pass                                        |
| **D3 Services**       | every service on v2 (auth, business, booking, queue, search, notification, billing, ads, analytics) through the router; the API keeps returning public IDs, so the website changes little                                                                | all unit, integration, acceptance and website tests pass                                                                                                  |
| **D4 Safety**         | pgBackRest in development (archive, backups, a restore script), TLS in development, pgaudit, partition maintenance jobs, monitoring queries; the restore drill as a script                                                                               | a restore to a point in time is demonstrated and tested in CI                                                                                             |
| **D5 Proof at scale** | a synthetic data set (10M people, 1M businesses, 200M appointments) on a test cluster; the slow-query review                                                                                                                                             | the targets in §3 met for the main queries                                                                                                                |

Website work resumes after D3.
