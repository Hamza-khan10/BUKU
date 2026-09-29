-- ═══════════════════════════════════════════════════════════════════════════
-- BUKU analytics — ClickHouse schema (idempotent; runs on first container start,
-- and analytics-service re-applies it on boot in later phases).
--
-- Design notes
--  • Kafka delivers at-least-once, so the same event can arrive twice.
--    ReplacingMergeTree collapses rows with the same ORDER BY key during
--    background merges; read with FINAL (or argMax) when exactness matters.
--  • ORDER BY starts with business_id: every dashboard query filters by one
--    business, so it reads a contiguous slice of the table.
--  • TTLs enforce data retention (GDPR: keep behavioural data only as long
--    as it is useful — 25 months for business trends, 13 for searches).
--  • Missing ids use the nil UUID instead of Nullable, which keeps sort keys
--    cheap (Nullable key columns are slower and need a special setting).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS buku_analytics.events
(
    event_id    UUID,
    event_type  LowCardinality(String),
    business_id UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    user_id     UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    -- JSON payload. Must never contain secrets or raw contact details.
    properties  String CODEC(ZSTD(3)),
    timestamp   DateTime64(3, 'UTC'),
    date        Date MATERIALIZED toDate(timestamp)
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (business_id, date, event_type, event_id)
TTL toDateTime(timestamp) + INTERVAL 25 MONTH DELETE;

-- One row per booking state change; the latest version (by updated_at) wins.
CREATE TABLE IF NOT EXISTS buku_analytics.booking_analytics
(
    booking_id       UUID,
    business_id      UUID,
    service_id       UUID,
    staff_id         UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    user_id          UUID,
    status           LowCardinality(String),
    amount           Decimal(10, 2),
    currency         LowCardinality(String),
    duration_minutes UInt16,
    -- Local wall-clock of the appointment in the business's timezone (for heatmaps).
    day_of_week      UInt8,
    hour_of_day      UInt8,
    is_new_customer  UInt8,
    start_at         DateTime64(3, 'UTC'),
    created_at       DateTime64(3, 'UTC'),
    updated_at       DateTime64(3, 'UTC'),
    date             Date MATERIALIZED toDate(start_at)
)
ENGINE = ReplacingMergeTree(updated_at)
PARTITION BY toYYYYMM(start_at)
ORDER BY (business_id, date, booking_id)
TTL toDateTime(start_at) + INTERVAL 25 MONTH DELETE;

CREATE TABLE IF NOT EXISTS buku_analytics.queue_analytics
(
    session_id          UUID,
    business_id         UUID,
    session_date        Date,
    entry_count         UInt32,
    served_count        UInt32,
    no_show_count       UInt32,
    left_count          UInt32,
    avg_wait_seconds    UInt32,
    avg_service_seconds UInt32,
    closed_at           DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree(closed_at)
PARTITION BY toYYYYMM(session_date)
ORDER BY (business_id, session_date, session_id)
TTL session_date + INTERVAL 25 MONTH DELETE;

CREATE TABLE IF NOT EXISTS buku_analytics.search_analytics
(
    search_id    UUID,
    -- Free-text queries can contain personal data: short retention below.
    query        String,
    filters      String CODEC(ZSTD(3)),
    result_count UInt32,
    user_id      UUID DEFAULT toUUID('00000000-0000-0000-0000-000000000000'),
    city         LowCardinality(String),
    category     LowCardinality(String),
    timestamp    DateTime64(3, 'UTC')
)
ENGINE = ReplacingMergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (city, toDate(timestamp), search_id)
TTL toDateTime(timestamp) + INTERVAL 13 MONTH DELETE;
