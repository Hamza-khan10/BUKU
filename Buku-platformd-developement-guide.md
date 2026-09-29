# BUKU PLATFORM — COMPLETE PRODUCTION BUILD PROMPT
# For: Fable 5 (AI Coding Agent)
# Platform: BUKU — Universal Appointment & Queue Management System
# Deployment Target: DigitalOcean VPS (Ubuntu 24.04)
# Version: 1.0.0 Production

═══════════════════════════════════════════════════════════════════════════════
MISSION STATEMENT
═══════════════════════════════════════════════════════════════════════════════

Build BUKU — a complete, production-ready, fully deployed universal appointment
and virtual queue platform. This is a two-sided marketplace where consumers book
appointments or join virtual queues at any service business (barbershops, dental
clinics, hospitals, gyms, car washes, pet groomers, government offices, etc.),
and businesses manage their entire booking operation through a professional
dashboard.

You are building EVERYTHING from scratch and deploying it to a DigitalOcean VPS.
When you are done, the system must be live, testable, and have zero known
vulnerabilities. Every single component listed below must be complete, connected,
tested, and working. Do not stop until every item is done.

═══════════════════════════════════════════════════════════════════════════════
SECTION 1: MONOREPO STRUCTURE
═══════════════════════════════════════════════════════════════════════════════

Create this exact monorepo at ~/buku-platform/:

buku-platform/
├── services/
│   ├── auth/                    # Authentication microservice
│   ├── booking/                 # Appointment booking engine
│   ├── queue/                   # Virtual queue engine
│   ├── notification/            # SMS, Push, Email dispatcher
│   ├── search/                  # Business discovery + geo search
│   ├── ads/                     # In-platform advertising engine
│   └── analytics/               # ClickHouse OLAP analytics
├── packages/
│   ├── common/                  # Shared types, errors, utilities
│   ├── database/                # Prisma schema, migrations, seeds
│   └── kafka/                   # Kafka producer/consumer factory
├── apps/
│   ├── web/                     # Next.js 14 public website + dashboards
│   └── mobile/                  # React Native (Expo) iOS + Android app
├── infrastructure/
│   ├── k8s/                     # Kubernetes manifests
│   ├── kong/                    # API Gateway config
│   ├── terraform/               # DigitalOcean IaC
│   ├── nginx/                   # Nginx configs
│   └── localstack/              # Local AWS simulation init scripts
├── scripts/
│   ├── deploy.sh                # Full deployment script
│   ├── rollback.sh              # Rollback script
│   ├── health-check.sh          # System health verification
│   ├── seed-production.sh       # Production data seeding
│   └── debug.sh                 # Debugging utilities
├── docs/
│   ├── DEPLOYMENT_GUIDE.md      # Step-by-step deployment
│   ├── DEBUGGING_GUIDE.md       # Troubleshooting every component
│   ├── API_REFERENCE.md         # Complete API documentation
│   ├── ARCHITECTURE.md          # System architecture overview
│   └── RUNBOOK.md               # Operational runbook
├── tests/
│   ├── unit/                    # Per-service unit tests
│   ├── integration/             # Cross-service integration tests
│   ├── e2e/                     # End-to-end tests (Playwright)
│   └── load/                    # k6 load tests
├── docker-compose.dev.yml       # Full local stack
├── docker-compose.test.yml      # Test environment
├── .env.example                 # Every env variable documented
├── .env.production.example      # Production env variables
├── package.json                 # Root workspace
└── tsconfig.base.json           # Root TypeScript config

═══════════════════════════════════════════════════════════════════════════════
SECTION 2: TECHNOLOGY STACK (EXACT VERSIONS)
═══════════════════════════════════════════════════════════════════════════════

BACKEND:
- Runtime:         Node.js 20 LTS
- Language:        TypeScript 5.4
- Framework:       Express.js 4.18
- ORM:             Prisma 5.x → PostgreSQL 16
- Validation:      Zod 3.x (all endpoints)
- Auth:            jsonwebtoken 9.x + bcryptjs 2.x
- Events:          KafkaJS 2.x → Apache Kafka 3.7 (KRaft mode)
- Cache/Locks:     ioredis 5.x → Redis 7.2
- Queue jobs:      BullMQ 5.x (Redis-backed)
- WebSocket:       Socket.IO 4.x
- File upload:     Multer + AWS S3 SDK v3
- Email:           AWS SES SDK v3
- SMS:             Twilio SDK
- Push:            Firebase Admin SDK
- Logging:         Winston 3.x + Morgan
- Monitoring:      Prometheus + Grafana
- Testing:         Jest + Supertest + Testcontainers
- API Gateway:     Kong 3.7 (DB-less declarative)

FRONTEND (Web):
- Framework:       Next.js 14 (App Router)
- Styling:         Tailwind CSS 3.x
- Components:      shadcn/ui
- State:           Zustand 4.x
- Data fetching:   TanStack Query 5.x
- Forms:           React Hook Form + Zod
- Charts:          Recharts
- Calendar:        FullCalendar
- Maps:            Mapbox GL JS
- Animation:       Framer Motion
- Testing:         Playwright (E2E) + Vitest

MOBILE (React Native):
- Framework:       Expo SDK 51 (managed workflow)
- Navigation:      Expo Router 3.x
- State:           Zustand
- Data fetching:   TanStack Query
- Maps:            react-native-maps
- Push:            expo-notifications
- Storage:         expo-secure-store
- Camera:          expo-camera
- Testing:         Jest + RNTL

INFRASTRUCTURE:
- Container:       Docker + Docker Compose
- Orchestration:   Kubernetes (k3s on DigitalOcean)
- Database:        PostgreSQL 16 + PostGIS 3.4
- Cache:           Redis 7.2
- Message broker:  Apache Kafka 3.7 (KRaft)
- Search:          Elasticsearch 8.13
- Analytics:       ClickHouse 24.3
- Gateway:         Kong 3.7
- Reverse proxy:   Nginx
- SSL:             Let's Encrypt (Certbot)
- Storage:         DigitalOcean Spaces (S3-compatible)
- CDN:             DigitalOcean CDN
- Monitoring:      Prometheus + Grafana + AlertManager
- Log aggregation: Loki + Promtail
- CI/CD:           GitHub Actions
- IaC:             Terraform

═══════════════════════════════════════════════════════════════════════════════
SECTION 3: DATABASE — COMPLETE PRISMA SCHEMA
═══════════════════════════════════════════════════════════════════════════════

Build the complete production-grade PostgreSQL schema with these tables.
Every table must have proper indexes, constraints, and comments.

TABLES TO CREATE:

1. users
   - id (UUID, PK)
   - phone (VARCHAR 20, UNIQUE, nullable)
   - email (VARCHAR 255, UNIQUE, nullable)
   - name (VARCHAR 200, NOT NULL)
   - avatar_url (TEXT, nullable)
   - timezone (VARCHAR 60, default: 'UTC')
   - locale (VARCHAR 10, default: 'en')
   - role (ENUM: user | staff | business_owner | super_admin)
   - status (ENUM: active | suspended | deleted)
   - email_verified_at (TIMESTAMPTZ, nullable)
   - phone_verified_at (TIMESTAMPTZ, nullable)
   - deleted_at (TIMESTAMPTZ, nullable) — soft delete
   - created_at, updated_at (TIMESTAMPTZ)
   INDEXES: email, phone, status, created_at

2. refresh_tokens
   - id (UUID, PK)
   - user_id (UUID, FK → users)
   - token_hash (VARCHAR 255, UNIQUE) — bcrypt hash
   - device_info (JSONB)
   - ip_address (VARCHAR 45)
   - expires_at (TIMESTAMPTZ)
   - revoked_at (TIMESTAMPTZ, nullable)
   - created_at (TIMESTAMPTZ)
   INDEXES: user_id, token_hash, expires_at

3. push_tokens
   - id (UUID, PK)
   - user_id (UUID, FK → users, CASCADE)
   - token (TEXT, UNIQUE)
   - platform (ENUM: ios | android | web)
   - is_active (BOOLEAN, default: true)
   - created_at (TIMESTAMPTZ)

4. categories
   - id (UUID, PK)
   - name (VARCHAR 100)
   - slug (VARCHAR 100, UNIQUE)
   - icon (VARCHAR 10)
   - parent_id (UUID, FK → categories, nullable) — self-referential
   - depth (INTEGER, default: 0)
   - is_active (BOOLEAN, default: true)
   - sort_order (INTEGER, default: 0)
   - created_at (TIMESTAMPTZ)

5. businesses
   - id (UUID, PK)
   - owner_id (UUID, FK → users)
   - category_id (UUID, FK → categories)
   - name (VARCHAR 200)
   - slug (VARCHAR 200, UNIQUE)
   - description (TEXT)
   - phone (VARCHAR 20)
   - email (VARCHAR 255)
   - website (VARCHAR 500)
   - address (TEXT)
   - city (VARCHAR 100)
   - state (VARCHAR 100)
   - country (VARCHAR 100)
   - postal_code (VARCHAR 20)
   - lat (DECIMAL 10,8)
   - lng (DECIMAL 11,8)
   - location (GEOGRAPHY POINT 4326) — PostGIS for geo search
   - status (ENUM: pending | verified | suspended | rejected)
   - verified (BOOLEAN, default: false)
   - verified_at (TIMESTAMPTZ)
   - rejection_reason (TEXT)
   - settings (JSONB, default: '{}')
     Shape: { autoConfirm, cancellationHours, minAdvanceHours,
              maxAdvanceDays, timezone, currency, queueEnabled,
              aiReceptionistEnabled, aiReceptionistPhone,
              bookingInstructions, depositRequired, depositPercent }
   - subscription_tier (ENUM: free | professional | enterprise)
   - subscription_expires_at (TIMESTAMPTZ)
   - avg_rating (DECIMAL 3,2, default: 0)
   - review_count (INTEGER, default: 0)
   - created_at, updated_at (TIMESTAMPTZ)
   INDEXES: owner_id, category_id, slug, status+verified, city+country,
            location (GIST), avg_rating, created_at

6. business_photos
   - id, business_id (FK CASCADE), url, alt_text
   - is_primary (BOOLEAN), sort_order, created_at

7. business_documents
   - id, business_id (FK CASCADE)
   - type (ENUM: business_license | medical_license | id_proof | address_proof)
   - url (TEXT), status (ENUM: pending | approved | rejected)
   - reviewed_at, review_note, created_at

8. business_hours
   - id, business_id (FK CASCADE)
   - day_of_week (0-6), open_time VARCHAR(5), close_time VARCHAR(5)
   - is_closed (BOOLEAN, default: false)

9. services
   - id (UUID, PK)
   - business_id (UUID, FK CASCADE)
   - name (VARCHAR 200)
   - description (TEXT)
   - duration_minutes (INTEGER, NOT NULL)
   - buffer_minutes (INTEGER, default: 0)
   - max_concurrent (INTEGER, default: 1)
   - price (DECIMAL 10,2)
   - currency (VARCHAR 3, default: 'USD')
   - deposit_required (BOOLEAN, default: false)
   - deposit_amount (DECIMAL 10,2)
   - group_name (VARCHAR 100) — for menu grouping
   - sort_order (INTEGER, default: 0)
   - is_active (BOOLEAN, default: true)
   - created_at, updated_at

10. staff
    - id (UUID, PK)
    - business_id (UUID, FK CASCADE)
    - user_id (UUID, FK, nullable) — linked after invite accepted
    - display_name (VARCHAR 100)
    - bio (TEXT), photo_url (TEXT)
    - specializations (TEXT[])
    - role (ENUM: owner | manager | staff)
    - is_active (BOOLEAN, default: true)
    - invite_email (VARCHAR 255)
    - invite_token_hash (VARCHAR 255)
    - invite_accepted (BOOLEAN, default: false)
    - invite_expires_at (TIMESTAMPTZ)
    - created_at

11. staff_services (junction)
    - staff_id (FK CASCADE), service_id (FK CASCADE)
    - PK: (staff_id, service_id)

12. resources
    - id, business_id (FK CASCADE)
    - name (VARCHAR 100), type (VARCHAR 50)
    - is_active (BOOLEAN), created_at

13. availability_rules
    - id, business_id (FK CASCADE)
    - staff_id (FK, nullable), resource_id (FK, nullable)
    - day_of_week (0-6)
    - start_time (VARCHAR 5), end_time (VARCHAR 5)
    - is_active (BOOLEAN)
    INDEXES: business_id+day_of_week, staff_id+day_of_week

14. availability_exceptions
    - id, business_id (FK CASCADE)
    - staff_id (FK, nullable), resource_id (FK, nullable)
    - exception_date (DATE)
    - type (ENUM: holiday | modified | extra_hours)
    - start_time (VARCHAR 5, nullable), end_time (VARCHAR 5, nullable)
    - reason (VARCHAR 200), created_at
    INDEXES: business_id+exception_date, staff_id+exception_date

15. appointments
    - id (UUID, PK)
    - business_id (UUID, FK)
    - service_id (UUID, FK)
    - staff_id (UUID, FK, nullable)
    - user_id (UUID, FK)
    - resource_id (UUID, FK, nullable)
    - status (ENUM: pending | confirmed | rescheduled | completed | cancelled | no_show)
    - start_at (TIMESTAMPTZ)
    - end_at (TIMESTAMPTZ)
    - notes (TEXT) — customer notes
    - internal_notes (TEXT) — business only
    - price (DECIMAL 10,2)
    - currency (VARCHAR 3)
    - payment_status (ENUM: unpaid | deposit_paid | paid | refunded)
    - version (INTEGER, default: 1) — optimistic concurrency control
    - confirmation_code (VARCHAR 20, UNIQUE) — format: BK-XXXX
    - reminder_24h_sent_at (TIMESTAMPTZ)
    - reminder_2h_sent_at (TIMESTAMPTZ)
    - cancelled_at (TIMESTAMPTZ)
    - cancel_reason (TEXT)
    - cancel_by (ENUM: user | business | system, nullable)
    - rescheduled_from_id (UUID, FK → appointments, nullable)
    - created_at, updated_at
    INDEXES: business_id+start_at, user_id+start_at, staff_id+start_at,
             status+start_at, confirmation_code, created_at

16. payments
    - id (UUID, PK), appointment_id (UUID, UNIQUE FK)
    - user_id (UUID, FK), business_id (UUID, FK)
    - amount (DECIMAL 10,2), currency, platform_fee (DECIMAL 10,2)
    - status (ENUM: pending | authorized | captured | refunded | failed)
    - method (VARCHAR 30) — card | apple_pay | google_pay
    - paddle_transaction_id (VARCHAR 200, UNIQUE, nullable)
    - paddle_subscription_id (VARCHAR 200, nullable)
    - refund_id (VARCHAR 200, nullable)
    - captured_at, refunded_at, created_at

17. reviews
    - id (UUID, PK), appointment_id (UUID, UNIQUE FK)
    - user_id, business_id (FK)
    - overall_rating (1-5)
    - wait_time_rating, staff_rating, cleanliness_rating, value_rating (1-5, nullable)
    - comment (TEXT)
    - owner_response (TEXT), owner_responded_at
    - is_flagged (BOOLEAN), flag_reason (VARCHAR 200)
    - is_visible (BOOLEAN, default: true)
    - created_at
    INDEXES: business_id+is_visible+created_at, business_id+overall_rating

18. queue_sessions
    - id (UUID, PK), business_id (UUID, FK)
    - session_date (DATE)
    - status (ENUM: open | paused | closed)
    - current_number (INTEGER, default: 0)
    - last_called_number (INTEGER, default: 0)
    - total_served (INTEGER, default: 0)
    - avg_service_seconds (INTEGER, default: 300)
    - max_queue_size (INTEGER, default: 200)
    - grace_period_seconds (INTEGER, default: 300)
    - opened_at, closed_at, created_at
    UNIQUE: (business_id, session_date)

19. queue_entries
    - id (UUID, PK), session_id (UUID, FK)
    - user_id (UUID, FK, nullable) — nullable for walk-ins
    - ticket_number (INTEGER), ticket_prefix (VARCHAR 5, default: 'A')
    - status (ENUM: waiting | called | serving | completed | left | no_show)
    - estimated_wait_seconds (INTEGER)
    - priority_lane (BOOLEAN, default: false) — elderly, disabled
    - notes (VARCHAR 500)
    - joined_at, called_at, served_at, left_at
    - actual_service_seconds (INTEGER)
    UNIQUE: (session_id, ticket_number)
    INDEXES: session_id+status, user_id+joined_at

20. notifications
    - id (UUID, PK), user_id (UUID, FK)
    - appointment_id (UUID, nullable), queue_entry_id (UUID, nullable)
    - type (VARCHAR 50) — booking_confirmation | reminder_24h | reminder_2h |
                          queue_called | queue_position | booking_cancelled |
                          booking_completed | review_request | welcome |
                          queue_session_opened
    - channel (ENUM: push | sms | email)
    - title (VARCHAR 200), body (TEXT)
    - data (JSONB) — deep link payload
    - status (ENUM: pending | sent | delivered | failed | read)
    - external_id (VARCHAR 500) — SNS/Twilio message ID
    - failure_reason (TEXT)
    - sent_at, delivered_at, read_at, created_at
    INDEXES: user_id+created_at, user_id+read_at, status+created_at

21. business_ads
    - id (UUID, PK), business_id (UUID, FK)
    - type (ENUM: featured_listing | category_spotlight | city_banner |
                  appointment_boost | new_user_promo)
    - category_id (UUID, nullable), city (VARCHAR 100), country (VARCHAR 100)
    - status (ENUM: pending_approval | active | paused | expired | rejected)
    - start_date, end_date (TIMESTAMPTZ)
    - weekly_budget (DECIMAL 10,2), total_budget (DECIMAL 10,2)
    - amount_spent (DECIMAL 10,2, default: 0)
    - impressions (INTEGER, default: 0)
    - clicks (INTEGER, default: 0)
    - bookings (INTEGER, default: 0)
    - revenue_attributed (DECIMAL 10,2, default: 0)
    - payment_method (VARCHAR 30), payment_ref (VARCHAR 200)
    - paid_at, approved_at, created_at, updated_at
    INDEXES: business_id+status, status+start_date+end_date,
             type+city+country+status

22. ad_events
    - id (UUID, PK), ad_id (UUID, FK), business_id (UUID, FK)
    - user_id (UUID, nullable)
    - type (ENUM: impression | click | booking | profile_view)
    - session_id (VARCHAR 100), ip_hash (VARCHAR 64)
    - created_at
    INDEXES: ad_id+type+created_at, business_id+type+created_at

23. ai_receptionist_configs
    - id (UUID, PK), business_id (UUID, UNIQUE FK)
    - is_enabled (BOOLEAN, default: false)
    - phone_number (VARCHAR 20)
    - voice_id (VARCHAR 100)
    - greeting_message (TEXT)
    - business_context (TEXT) — injected into AI system prompt
    - active_overrides (JSONB, default: '[]')
      Shape: [{ type: "staff_leave", staffId: "...", reason: "...", until: "..." }]
    - total_calls_handled (INTEGER, default: 0)
    - total_bookings_made (INTEGER, default: 0)
    - created_at, updated_at

24. ai_call_logs
    - id (UUID, PK), business_id (UUID, FK)
    - caller_phone (VARCHAR 20)
    - duration_seconds (INTEGER)
    - transcript_url (TEXT)
    - appointment_id (UUID, nullable FK)
    - outcome (ENUM: booked | not_booked | transferred | error)
    - failure_reason (TEXT), created_at

25. webhooks
    - id (UUID, PK), business_id (UUID, FK)
    - url (TEXT)
    - secret (VARCHAR 255) — for HMAC signature verification
    - events (TEXT[]) — array of subscribed event types
    - is_active (BOOLEAN, default: true)
    - last_triggered_at (TIMESTAMPTZ)
    - failure_count (INTEGER, default: 0)
    - created_at, updated_at

26. webhook_deliveries
    - id (UUID, PK), webhook_id (UUID, FK)
    - event_type (VARCHAR 100)
    - payload (JSONB)
    - response_status (INTEGER)
    - response_body (TEXT)
    - attempt_count (INTEGER, default: 1)
    - delivered_at (TIMESTAMPTZ)
    - next_retry_at (TIMESTAMPTZ)
    - created_at

27. subscription_plans (Paddle)
    - id (UUID, PK), business_id (UUID, FK)
    - paddle_subscription_id (VARCHAR 200, UNIQUE)
    - paddle_customer_id (VARCHAR 200)
    - plan (ENUM: free | professional | enterprise)
    - status (ENUM: active | past_due | cancelled | paused | trialing)
    - current_period_start, current_period_end (TIMESTAMPTZ)
    - cancel_at_period_end (BOOLEAN)
    - cancelled_at (TIMESTAMPTZ)
    - created_at, updated_at

28. audit_logs
    - id (UUID, PK)
    - user_id (UUID, nullable FK)
    - action (VARCHAR 100)
    - resource_type (VARCHAR 50), resource_id (UUID)
    - old_values (JSONB), new_values (JSONB)
    - ip_address (VARCHAR 45), user_agent (TEXT)
    - created_at
    INDEXES: user_id+created_at, resource_type+resource_id+created_at

ADDITIONAL DATABASE SETUP:
- Enable extensions: uuid-ossp, postgis, pg_trgm, pgcrypto, btree_gist
- Create GIN index on businesses for full-text search (tsvector)
- Create GiST index on businesses.location for geo queries
- Create all triggers for: updated_at timestamps, search vector updates,
  avg_rating recalculation on review insert/update/delete
- Create all database-level constraints and check constraints
- Write seed data: 8 categories, 20 businesses, 50 users, 5 staff per
  business, 200 appointments, 10 queue sessions, 30 reviews

═══════════════════════════════════════════════════════════════════════════════
SECTION 4: KAFKA — COMPLETE TOPICS AND PARTITIONS
═══════════════════════════════════════════════════════════════════════════════

Run Apache Kafka 3.7 in KRaft mode (no ZooKeeper).
Generate a valid base64 CLUSTER_ID automatically during setup.

CREATE THESE EXACT TOPICS:

BOOKING EVENTS (high traffic):
- bookings.created      → 12 partitions, retention: 7 days
- bookings.confirmed    → 12 partitions, retention: 7 days
- bookings.cancelled    → 12 partitions, retention: 7 days
- bookings.rescheduled  → 6 partitions,  retention: 7 days
- bookings.completed    → 6 partitions,  retention: 30 days
- bookings.reminder     → 6 partitions,  retention: 1 day
- bookings.no_show      → 6 partitions,  retention: 30 days

QUEUE EVENTS (very high frequency):
- queue.session.opened        → 3 partitions,  retention: 1 day
- queue.session.closed        → 3 partitions,  retention: 1 day
- queue.entry.joined          → 12 partitions, retention: 1 day
- queue.entry.called          → 12 partitions, retention: 1 day
- queue.entry.served          → 6 partitions,  retention: 1 day
- queue.entry.completed       → 6 partitions,  retention: 30 days
- queue.entry.left            → 6 partitions,  retention: 1 day
- queue.entry.no_show         → 6 partitions,  retention: 1 day
- queue.position.updated      → 24 partitions, retention: 1 hour

NOTIFICATION DISPATCH:
- notifications.send          → 12 partitions, retention: 3 days
- notifications.delivered     → 6 partitions,  retention: 7 days

USER & BUSINESS LIFECYCLE:
- users.registered            → 6 partitions,  retention: 30 days
- users.verified              → 3 partitions,  retention: 30 days
- users.deleted               → 3 partitions,  retention: 30 days
- businesses.created          → 3 partitions,  retention: 30 days
- businesses.verified         → 3 partitions,  retention: 30 days
- businesses.updated          → 6 partitions,  retention: 7 days
- businesses.suspended        → 3 partitions,  retention: 30 days

PAYMENT EVENTS:
- payments.initiated          → 6 partitions,  retention: 90 days
- payments.completed          → 6 partitions,  retention: 90 days
- payments.failed             → 6 partitions,  retention: 90 days
- payments.refunded           → 3 partitions,  retention: 90 days

ANALYTICS (high volume):
- analytics.events            → 24 partitions, retention: 90 days
- analytics.search            → 12 partitions, retention: 30 days
- analytics.ad.impressions    → 12 partitions, retention: 30 days

AI RECEPTIONIST:
- ai.call.started             → 3 partitions,  retention: 30 days
- ai.call.completed           → 6 partitions,  retention: 30 days
- ai.call.failed              → 3 partitions,  retention: 30 days

WEBHOOKS:
- webhooks.dispatch           → 6 partitions,  retention: 7 days
- webhooks.delivered          → 3 partitions,  retention: 7 days
- webhooks.failed             → 6 partitions,  retention: 30 days

DEAD LETTER QUEUES:
- dlq.failed-events           → 6 partitions,  retention: 30 days
- dlq.notifications           → 6 partitions,  retention: 30 days
- dlq.webhooks                → 6 partitions,  retention: 30 days

PRODUCER CONFIG (all services):
- acks: 'all' (wait for all replicas)
- retries: 5
- retry.backoff.ms: 300
- enable.idempotence: true
- max.in.flight.requests.per.connection: 5

CONSUMER CONFIG:
- Group IDs: buku-{service-name}-{env}
- auto.offset.reset: 'earliest' for critical topics, 'latest' for analytics
- enable.auto.commit: false (manual commit after processing)
- session.timeout.ms: 30000
- heartbeat.interval.ms: 3000

═══════════════════════════════════════════════════════════════════════════════
SECTION 5: COMPLETE MICROSERVICES — ALL 7 SERVICES
═══════════════════════════════════════════════════════════════════════════════

Build each service completely with all endpoints, all Kafka consumers/producers,
all error handling, all validation, all security middleware, all tests.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.1 AUTH SERVICE (Port 3001)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
POST   /v1/auth/register              Register with phone or email, send OTP
POST   /v1/auth/verify-otp            Verify OTP, issue JWT pair
POST   /v1/auth/resend-otp            Resend OTP (rate limited: 3/hour)
POST   /v1/auth/login                 Login with email+password (business owners)
POST   /v1/auth/refresh               Rotate refresh token (sliding window)
POST   /v1/auth/logout                Revoke refresh token
POST   /v1/auth/logout-all            Revoke all user tokens
POST   /v1/auth/forgot-password       Send password reset email
POST   /v1/auth/reset-password        Reset password with token
POST   /v1/auth/change-password       Change password (authenticated)
POST   /v1/auth/oauth/google          Google OAuth2 Sign-In
POST   /v1/auth/oauth/apple           Apple Sign-In
GET    /v1/auth/me                    Get current user with role
PATCH  /v1/auth/me                    Update profile (name, timezone, locale)
POST   /v1/auth/me/avatar             Upload profile photo to S3
DELETE /v1/auth/me                    Soft-delete account (GDPR)
POST   /v1/auth/push-token            Register FCM/APNs device token
DELETE /v1/auth/push-token/:token     Remove device token on logout

SECURITY REQUIREMENTS:
- OTP: 6 digits, bcrypt stored in Redis, 10-minute TTL
- OTP attempts: max 3, then 15-minute lockout per IP+destination
- OTP rate: max 3 sends per hour per destination
- JWT access token: 15 minutes expiry, RS256 algorithm
- JWT refresh token: 7 days expiry, stored as bcrypt hash in DB + Redis
- Refresh token rotation: new token on each refresh, old immediately revoked
- Password: bcrypt rounds 12 in production
- Password reset tokens: cryptographic random, 1-hour TTL, single use
- Google OAuth: verify ID token server-side with google-auth-library
- Apple OAuth: verify identity token with Apple's public keys
- All endpoints: rate limiting via Kong (20 req/min auth endpoints)
- All sensitive operations: audit log entry created

JWT PAYLOAD SHAPE:
{
  sub: userId,
  role: UserRole,
  iat: number,
  exp: number,
  jti: string  — unique token ID for revocation
}

KAFKA EVENTS PRODUCED:
- users.registered (on new registration)
- users.verified (on OTP verification)
- users.deleted (on account deletion)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.2 BOOKING SERVICE (Port 3002)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
POST   /v1/appointments                   Create booking (atomic slot lock)
GET    /v1/appointments                   List user's appointments (paginated)
GET    /v1/appointments/:id               Get appointment details
POST   /v1/appointments/:id/confirm       Business confirms booking
POST   /v1/appointments/:id/cancel        Cancel (user or business)
POST   /v1/appointments/:id/reschedule    Reschedule (atomic slot swap)
POST   /v1/appointments/:id/complete      Mark as completed
POST   /v1/appointments/:id/no-show       Mark as no-show
GET    /v1/appointments/:id/timeline      Status change history
GET    /v1/businesses/:id/appointments    Business appointment calendar
GET    /v1/businesses/:id/availability    Compute available time slots
GET    /v1/businesses/:id/services        List active services
POST   /v1/businesses/:id/services        Create service
PATCH  /v1/businesses/:id/services/:sid   Update service
DELETE /v1/businesses/:id/services/:sid   Deactivate service
GET    /v1/businesses/:id/staff           List active staff
POST   /v1/businesses/:id/staff           Add staff member + send invite
PATCH  /v1/businesses/:id/staff/:sid      Update staff
POST   /v1/staff/accept-invite            Accept staff invite by token
POST   /v1/businesses/:id/availability-rules       Set weekly schedule
POST   /v1/businesses/:id/availability-exceptions  Add holiday/closure
GET    /v1/businesses/:id/availability-rules        Get weekly schedule

CRITICAL BOOKING ENGINE:
Implement the exact atomic slot locking algorithm:
1. Generate lock key: `slot:{bizId}:{staffId ?? 'any'}:{startAt.toISOString()}`
2. Redis SETNX with 30-second TTL and random lock ID
3. If lock acquired → validate slot against PostgreSQL (overlapping bookings)
4. If valid → INSERT appointment with confirmation_code (format: BK-[6 alphanum])
5. Release Redis lock in finally block ALWAYS
6. If lock not acquired → return 409 SLOT_UNAVAILABLE immediately
7. After INSERT → publish bookings.created to Kafka
8. Response returns to user BEFORE Kafka publish completes

AVAILABILITY ALGORITHM:
1. Load business settings (timezone, min advance hours, max advance days)
2. Load availability_rules for requested date range (day of week matching)
3. Load availability_exceptions for exact dates
4. Load existing confirmed+pending appointments for staff in range
5. Load staff-specific rules if staffId requested
6. Generate slots every {service.duration_minutes + service.buffer_minutes}
7. Mark slots: available | unavailable | blocked
8. Return slots array with isAvailable, reason, fillPercentage
9. Cache result: key `slots:{bizId}:{staffId}:{date}`, TTL 30 seconds
10. Invalidate cache on: new booking, cancellation, availability rule change

KAFKA EVENTS PRODUCED:
bookings.created, bookings.confirmed, bookings.cancelled,
bookings.rescheduled, bookings.completed, bookings.no_show,
bookings.reminder (scheduled via BullMQ)

KAFKA CONSUMERS:
- bookings.completed → trigger review request job

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.3 QUEUE SERVICE (Port 3003 HTTP, 3013 WebSocket)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
POST   /v1/queue/sessions/open           Open queue for today
POST   /v1/queue/sessions/close          Close queue session
POST   /v1/queue/sessions/pause          Pause queue (no new joins)
POST   /v1/queue/sessions/resume         Resume paused queue
GET    /v1/queue/sessions/status         Live queue status (from Redis)
GET    /v1/queue/sessions/:id            Queue session details
POST   /v1/queue/join                    Join virtual queue
GET    /v1/queue/entries/:id             Get entry status
POST   /v1/queue/entries/:id/leave       Leave queue voluntarily
POST   /v1/queue/call-next               Staff calls next customer
POST   /v1/queue/entries/:id/serve       Mark as serving
POST   /v1/queue/entries/:id/complete    Mark service complete
POST   /v1/queue/entries/:id/no-show     Mark as no-show

REDIS DATA STRUCTURES:
- Queue state:    HASH  `queue:session:{id}:state`
                  Fields: status, currentNumber, lastCalled, totalServed,
                          avgServiceSeconds, openedAt
- Waiting set:    ZSET  `queue:session:{id}:waiters`
                  Score: ticketNumber, Member: entryId
- Position cache: STRING `queue:entry:{id}:position`, TTL: 30s

WEBSOCKET ROOMS (Socket.IO):
- `user:{userId}` — user joins on app open, receives their position updates
- `biz:{bizId}`   — business staff joins, receives full queue dashboard updates

SOCKET.IO EVENTS EMITTED:
- queue:position_updated  → to user room when their position changes
- queue:called            → to specific user when their ticket is called
- queue:closed            → to all users when session closes
- queue:dashboard_update  → to biz room: full queue state
- queue:new_entry         → to biz room: new customer joined

POSITION UPDATE LOGIC:
After every call-next/complete/no-show: recalculate ALL waiting entries'
positions using their ZRANK in the sorted set. Emit position_updated to
each user's room. Update estimated wait time based on avg_service_seconds.

TICKET NUMBERING:
Use Redis INCR `queue:session:{id}:counter` — atomic, no race condition.
Format: {prefix}{number} e.g. A047

KAFKA EVENTS PRODUCED:
queue.session.opened, queue.session.closed, queue.entry.joined,
queue.entry.called, queue.entry.completed, queue.entry.no_show

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.4 NOTIFICATION SERVICE (Port 3004)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
GET    /v1/notifications              User notification inbox (paginated)
PATCH  /v1/notifications/:id/read     Mark as read
POST   /v1/notifications/read-all     Mark all as read
DELETE /v1/notifications/:id          Delete notification
GET    /v1/notifications/unread-count Unread badge count
PATCH  /v1/users/me/notification-prefs Update preferences
GET    /v1/users/me/notification-prefs Get preferences

KAFKA CONSUMERS (each in separate consumer group):
1. bookings.created → Send confirmation push + SMS + email
   Format: "✅ Booking confirmed at {business}. {date} at {time}."
2. bookings.cancelled → Send cancellation notification to both parties
3. bookings.rescheduled → Inform user and business of new time
4. bookings.reminder → Execute 24h and 2h reminder sends
5. bookings.completed → Schedule review request (BullMQ job, 30min delay)
6. queue.entry.called → URGENT SMS + push within 2 seconds
   Format: "🔔 You're next at {business}! Come to the front desk now. Ticket {number}"
7. queue.entry.joined → Confirm queue entry
8. queue.session.opened → Notify users who have upcoming slots
9. users.registered → Send welcome email via SES template
10. notifications.send → Generic notification dispatch

CHANNELS:
- PUSH: Firebase FCM (Android) + APNs via FCM (iOS)
  Priority: HIGH for queue_called, NORMAL for reminders
- SMS: Twilio SMS API
  Only for: OTP, queue_called (urgent), 24h reminder, cancellation
- EMAIL: AWS SES with HTML templates
  Templates: booking_confirmation, booking_reminder, booking_cancelled,
             welcome, review_request, password_reset, staff_invite

BULLMQ JOBS:
- reminder-24h: scheduled at appointment.start_at - 24h
- reminder-2h: scheduled at appointment.start_at - 2h
- review-request: scheduled at appointment.end_at + 30min
- no-show-check: scheduled at queue_call_time + grace_period_seconds
Each job idempotent: check DB before sending (prevent duplicate sends)

NOTIFICATION PREFERENCES (per user):
- push_booking_confirmation: boolean
- push_reminders: boolean
- push_queue_updates: boolean
- sms_reminders: boolean
- sms_queue_called: boolean (cannot be disabled)
- email_booking_confirmation: boolean
- marketing_emails: boolean

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.5 SEARCH SERVICE (Port 3005)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
GET    /v1/businesses/search          Full-text + geo search
GET    /v1/businesses/nearby          Geo distance sort, open-now filter
GET    /v1/businesses/autocomplete    ES completion suggester (< 50ms)
GET    /v1/categories                 Category tree
GET    /v1/categories/:slug           Category with sub-categories
GET    /v1/categories/:slug/businesses Browse businesses by category
GET    /v1/businesses/featured        Homepage featured businesses
GET    /v1/businesses/trending        Trending in city

SEARCH PARAMS: q, lat, lng, radius_km (default 10, max 100),
category, min_rating (1-5), available_date, has_queue,
verified_only, open_now, sort (distance|rating|relevance|newest),
page (default 1), limit (default 20, max 100)

ELASTICSEARCH INDEX (businesses):
Mapping includes:
- name: text(english) + keyword + completion (autocomplete)
- description: text(english)
- category: keyword
- tags: keyword[]
- location: geo_point
- avg_rating: float
- review_count: integer
- verified: boolean
- status: keyword
- city, country: keyword
- services: nested { id, name, duration_minutes, price }
- staff_count: integer
Settings: { number_of_shards: 1, number_of_replicas: 1 }

AD INJECTION ALGORITHM:
1. Run organic ES query, get results
2. Fetch active ads for this category+city from ads-service
3. Inject: city_banners[0] at position 0
4. Inject: spotlights[0..1] at positions 1-2
5. Organic results at positions 3-7
6. featured_listing[0..2] at positions 8-10
7. Continue organic results from 11+
8. Mark each injected item: { isPromoted: true, adType, adId }
9. Trigger impression tracking for each injected promoted listing

KAFKA CONSUMERS:
- businesses.verified → upsert ES index, set verified=true
- businesses.updated → re-index business document
- businesses.created → index new business (status: pending)
- businesses.suspended → update status in ES index

INDEX REBUILD:
On service start: if ES index is empty OR has less than 10% of Postgres
business count → trigger full rebuild from PostgreSQL.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.6 ADS SERVICE (Port 3006)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
POST   /v1/ads                        Create ad campaign
GET    /v1/ads/:id                    Get campaign details
PATCH  /v1/ads/:id                    Update campaign (draft only)
DELETE /v1/ads/:id/pause              Pause active campaign
POST   /v1/ads/:id/resume             Resume paused campaign
POST   /v1/ads/:id/approve            Admin approves (super_admin only)
POST   /v1/ads/:id/reject             Admin rejects with reason
POST   /v1/ads/:id/click              Record click event
POST   /v1/ads/impressions/batch      Batch impression flush (internal)
GET    /v1/ads/:id/stats              Campaign stats with daily breakdown
GET    /v1/businesses/:id/ads         Business ad campaigns
GET    /v1/admin/ads                  Admin: all ads with filters
GET    /v1/ads/active                 Internal: get active ads for search injection

IMPRESSION TRACKING:
- On each search result return: batch impressions in Redis list
- Key: `ads:impressions:pending`, value: JSON array
- BullMQ job flushes every 60 seconds: LRANGE → INSERT → LTRIM
- Also increment Redis counter: `ads:impression:{adId}:count`
- Redis counter sync to Postgres every 5 minutes

BUDGET ENFORCEMENT:
- BullMQ cron every 15 minutes
- Calculate: current spend = impressions × CPM + clicks × CPC
- If spent >= total_budget: set status = 'paused', notify owner
- Redis key: `ads:budget:{adId}:spent` for real-time tracking

CONVERSION ATTRIBUTION:
Kafka consumer on bookings.created:
1. Check if booking user had a click on any ad for this business in last 7 days
2. Attribution window: 7 days from click to booking
3. If yes: INSERT ad_event(type=booking), increment bookings counter
4. Update revenue_attributed = bookings × avg_service_price

KAFKA CONSUMERS:
- bookings.created → conversion attribution
- analytics.ad.impressions → process impression batches

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
5.7 ANALYTICS SERVICE (Port 3007)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ENDPOINTS:
GET    /v1/businesses/:id/analytics/overview     KPIs today vs last week
GET    /v1/businesses/:id/analytics/bookings     Time series chart data
GET    /v1/businesses/:id/analytics/peak-hours   7×24 heatmap array
GET    /v1/businesses/:id/analytics/revenue      Revenue by service
GET    /v1/businesses/:id/analytics/staff        Staff performance table
GET    /v1/businesses/:id/analytics/no-show      No-show trend
GET    /v1/businesses/:id/analytics/customers    New vs returning
GET    /v1/admin/analytics/platform              Platform-wide admin metrics

CLICKHOUSE TABLES:
1. events
   - event_id UUID, event_type String, business_id UUID, user_id UUID
   - properties String (JSON), timestamp DateTime, date Date
   Engine: MergeTree() PARTITION BY toYYYYMM(date) ORDER BY (date, business_id)

2. booking_analytics
   - booking_id, business_id, service_id, staff_id, user_id
   - status, amount, duration_minutes, day_of_week, hour_of_day
   - is_new_customer, created_at, date
   Engine: MergeTree() PARTITION BY toYYYYMM(date) ORDER BY (date, business_id)

3. queue_analytics
   - session_id, business_id, entry_count, served_count, no_show_count
   - avg_wait_seconds, avg_service_seconds, session_date
   Engine: MergeTree() ORDER BY (session_date, business_id)

4. search_analytics
   - query String, filters String, result_count UInt32
   - user_id UUID, city String, category String, timestamp DateTime
   Engine: MergeTree() ORDER BY (toDate(timestamp), city)

KAFKA CONSUMERS:
- analytics.events → batch insert into ClickHouse every 5 seconds (500 events max)
- bookings.created, completed, cancelled → booking_analytics table
- queue.session.closed → queue_analytics table

BATCH INSERT LOGIC:
Collect events in memory array, flush every 5 seconds OR every 500 events.
Use ClickHouse HTTP interface for inserts. Log failed batches to DLQ.

═══════════════════════════════════════════════════════════════════════════════
SECTION 6: SHARED PACKAGES
═══════════════════════════════════════════════════════════════════════════════

packages/common/src/index.ts — EXPORT ALL OF:
- AppError class: message, code (string), httpStatus, details?
- ErrorCodes enum: all error codes (USER_EXISTS, SLOT_UNAVAILABLE, OTP_EXPIRED, etc.)
- HTTP_STATUS constants
- successResponse(data, meta?) → standard API envelope
- errorResponse(error) → standard error envelope
- validateRequest(schema: ZodSchema) → Express middleware
- authenticateToken → JWT verification middleware (RS256)
- requireRole(...roles) → RBAC middleware
- requireBusinessOwner → checks user owns the business in route params
- auditLog(action, resourceType, resourceId, options?) → inserts audit_log
- requestLogger → Winston + Morgan structured logging middleware
- rateLimiter(points, duration) → Redis-backed rate limiter
- pagination(req) → extract page/limit/cursor from query
- generateConfirmationCode() → 'BK-' + 6 random alphanum
- hashToken(token) → bcrypt hash
- verifyToken(token, hash) → bcrypt compare
- encrypt(text) → AES-256-GCM encryption for PII
- decrypt(ciphertext) → AES-256-GCM decryption
- generateHmacSignature(payload, secret) → HMAC-SHA256 for webhooks

packages/kafka/src/index.ts — EXPORT:
- createProducer(clientId) → KafkaJS producer with retry + DLQ fallback
- createConsumer(groupId) → KafkaJS consumer factory
- produceEvent(topic, key, value, headers?) → typed producer
- TOPICS constant → all topic name strings
- KafkaMessage type, KafkaEvent type

packages/database/src/index.ts — EXPORT:
- prisma → singleton PrismaClient with connection pool
- All Prisma-generated types
- Common query helpers: findByIdOrThrow, softDelete, paginate

═══════════════════════════════════════════════════════════════════════════════
SECTION 7: API GATEWAY — KONG COMPLETE CONFIG
═══════════════════════════════════════════════════════════════════════════════

infrastructure/kong/nexus.yml — DB-less declarative config:

SERVICES AND ROUTES:
- auth-service: routes /v1/auth/*
- booking-service: routes /v1/appointments/*, /v1/businesses/*/services,
  /v1/businesses/*/staff, /v1/businesses/*/availability*
- queue-service: routes /v1/queue/*
- notification-service: routes /v1/notifications/*, /v1/users/me/notification-prefs
- search-service: routes /v1/businesses/search, /v1/businesses/nearby,
  /v1/businesses/autocomplete, /v1/categories/*, /v1/businesses/featured
- ads-service: routes /v1/ads/*, /v1/businesses/*/ads, /v1/admin/ads
- analytics-service: routes /v1/businesses/*/analytics/*, /v1/admin/analytics/*

PLUGINS ON ALL ROUTES:
1. rate-limiting: 200 req/min global, 20 req/min auth, Redis backend
2. cors: origins=[https://thebuku.vercel.app, https://buku.app, http://localhost:3000],
         methods=[GET,POST,PUT,PATCH,DELETE,OPTIONS], headers=[Authorization,Content-Type,X-Request-ID]
3. request-size-limiting: 10KB default, 50MB for file upload routes
4. correlation-id: header=X-Request-ID, generator=uuid
5. response-transformer: add headers [X-API-Version: 1.0, X-Request-ID]
6. prometheus: expose /metrics on :9180

PROTECTED ROUTES (add jwt plugin):
All routes EXCEPT:
- POST /v1/auth/register
- POST /v1/auth/verify-otp
- POST /v1/auth/resend-otp
- POST /v1/auth/login
- POST /v1/auth/forgot-password
- POST /v1/auth/reset-password
- POST /v1/auth/oauth/*
- GET  /v1/businesses/search
- GET  /v1/businesses/nearby
- GET  /v1/businesses/autocomplete
- GET  /v1/categories/*
- GET  /v1/businesses/featured
- GET  /v1/businesses/:id (public profile)

JWT PLUGIN CONFIG:
- algorithm: RS256
- key_claim_name: sub
- cookie_names: [] (header only)
- claims_to_verify: [exp]

ADMIN ROUTES:
- POST /v1/ads/:id/approve — add ip-restriction plugin (admin IPs only)
- GET /v1/admin/* — add jwt + require super_admin role check

═══════════════════════════════════════════════════════════════════════════════
SECTION 8: WEBHOOKS SYSTEM
═══════════════════════════════════════════════════════════════════════════════

Build a complete webhook delivery system for businesses to receive events.

SUPPORTED WEBHOOK EVENTS:
- booking.created, booking.confirmed, booking.cancelled
- booking.rescheduled, booking.completed, booking.no_show
- queue.entry.joined, queue.entry.called, queue.entry.completed
- review.created, payment.completed, payment.refunded

WEBHOOK ENDPOINTS:
POST   /v1/businesses/:id/webhooks         Register webhook URL
GET    /v1/businesses/:id/webhooks         List webhooks
PATCH  /v1/webhooks/:id                   Update webhook
DELETE /v1/webhooks/:id                   Delete webhook
POST   /v1/webhooks/:id/test              Send test event
GET    /v1/webhooks/:id/deliveries        Recent delivery history (last 100)
POST   /v1/webhooks/:id/deliveries/:did/retry  Retry failed delivery

DELIVERY LOGIC:
1. Kafka consumer on webhooks.dispatch topic
2. For each event: find all active webhooks subscribed to that event_type
3. Build payload: { id, event, created_at, data: {...eventPayload} }
4. Sign payload: X-Buku-Signature: sha256=HMAC(secret, body)
5. POST to webhook URL with 5-second timeout
6. On 2xx: mark delivered, INSERT webhook_delivery(success)
7. On failure: exponential backoff retry (1min, 5min, 15min, 1hr, 4hr)
8. After 5 failures: pause webhook, email business owner
9. Log all delivery attempts in webhook_deliveries table

SIGNATURE VERIFICATION (documentation for businesses):
```
const signature = req.headers['x-buku-signature'];
const expectedSig = 'sha256=' + crypto
  .createHmac('sha256', webhookSecret)
  .update(rawBody)
  .digest('hex');
const isValid = crypto.timingSafeEqual(
  Buffer.from(signature),
  Buffer.from(expectedSig)
);
```

═══════════════════════════════════════════════════════════════════════════════
SECTION 9: WEBSITE — COMPLETE NEXT.JS 14 APP
═══════════════════════════════════════════════════════════════════════════════

Build a complete, production-ready, fully responsive website.
Domain: thebuku.vercel.app (also deployable to custom domain via Nginx)

PAGES AND ROUTES:

PUBLIC PAGES (SEO-indexed, server-rendered):
/ → Landing page (complete rebuild - see design below)
/search → Search results with filters
/categories → Browse all categories
/categories/[slug] → Category page with business listings
/businesses/[slug] → Business profile page (dynamic OG meta)
/how-it-works → How it works page
/for-business → Business owner landing page
/pricing → Subscription plans (Free/Pro/Enterprise with Paddle integration)
/about → About BUKU
/blog → Blog index (MDX-powered)
/blog/[slug] → Individual blog post
/contact → Contact form

LEGAL PAGES (required before launch):
/legal/privacy-policy → Full GDPR-compliant privacy policy
/legal/terms-of-service → Complete terms of service
/legal/cookie-policy → Cookie policy
/legal/refund-policy → Subscription refund policy
/legal/acceptable-use → Acceptable use policy
/legal/business-terms → Business owner terms (additional)

AUTH PAGES:
/auth/login → Login (email/phone + password or OTP)
/auth/register → User or business registration (toggle)
/auth/verify-otp → OTP verification
/auth/forgot-password → Password reset request
/auth/reset-password → Password reset form
/auth/accept-invite → Staff invite acceptance

USER DASHBOARD:
/account → Account overview + upcoming bookings
/account/appointments → Full appointment history (upcoming/past/cancelled tabs)
/account/queue → Active queue entries
/account/favourites → Saved businesses
/account/reviews → Review history
/account/notifications → Notification inbox + preferences
/account/settings → Profile settings, security, account deletion

BUSINESS DASHBOARD (requires business_owner role + verified business):
/dashboard → Overview with KPI cards + today's schedule
/dashboard/calendar → FullCalendar with day/week/month views
/dashboard/queue → Live queue management screen
/dashboard/bookings → All bookings with filters + export
/dashboard/services → Service catalog CRUD
/dashboard/staff → Team management + invites
/dashboard/availability → Weekly schedule + exceptions
/dashboard/analytics → Charts: bookings, revenue, peak hours, no-show
/dashboard/promotions → Ad campaigns + performance + ROI
/dashboard/reviews → All reviews + owner replies
/dashboard/webhooks → Webhook configuration
/dashboard/settings → Business profile + verification documents
/dashboard/subscription → Plan management via Paddle

ADMIN PANEL (requires super_admin role):
/admin → Platform overview
/admin/businesses → Pending verification queue
/admin/businesses/[id] → Review + approve/reject
/admin/ads → All ad campaigns + approval
/admin/users → User management
/admin/analytics → Platform-wide analytics

LANDING PAGE DESIGN REQUIREMENTS:
Full remake of thebuku.vercel.app with these sections:
1. Navigation: BUKU SVG logo (book+checkmark), nav links, Login + Book CTAs
   Mobile: hamburger with full-screen drawer
2. Hero: Editorial headline "Book your spot. Skip the line."
   Floating booking confirmation cards, hero stats, dual CTA buttons
3. Marquee: Scrolling category ticker (all 40+ categories) on dark background
4. Search: Large 3-field search bar (service, location, date), quick category filters
5. Categories grid: 6 categories with icons, featured badges on sponsored
6. Listings: Business cards (organic + sponsored mixed), filter chips
   Each card: photo, verified badge, name, rating, next slot, Book/Join buttons
7. How It Works: 3-column dark section (Search, Book/Queue, Show Up)
   Include AI Receptionist banner with "Coming Soon" badge
8. Booking Preview: Interactive booking widget (staff select, calendar, time slots)
9. Testimonials: 3-card grid (1 featured dark card, 2 light)
10. For Business: Left text + right ad ROI mockup, perk bullets, CTA
11. Email waitlist signup + App store download CTAs (with coming soon)
12. Footer: 4-column with logo, links, social, legal links

RESPONSIVE: Must work perfectly at:
- Mobile: 375px, 390px, 428px
- Tablet: 768px, 1024px
- Desktop: 1280px, 1440px, 1920px

ACCESSIBILITY:
- All images have alt text
- All interactive elements keyboard-navigable
- ARIA labels on all buttons
- Color contrast ratio ≥ 4.5:1
- Focus visible on all interactive elements

SEO:
- Every page has unique title, description, OG tags
- Sitemap.xml generated
- Robots.txt configured
- Structured data (JSON-LD) for businesses, reviews, FAQs
- Business profile pages: canonical URLs, dynamic OG images

PERFORMANCE TARGETS:
- Lighthouse score ≥ 90 on all categories
- First Contentful Paint < 1.5s
- Time to Interactive < 3.5s
- Core Web Vitals: all green

PRIVACY & LEGAL PAGE CONTENT (write complete versions):

PRIVACY POLICY must include:
- What data we collect (registration data, usage data, location, device)
- How we use data (booking delivery, notifications, analytics, ads)
- Data sharing (with businesses you book with, payment processors)
- Paddle as payment processor (mention explicitly)
- Your rights: access, rectification, erasure, portability, objection
- Cookie usage and types (essential, analytics, marketing)
- Data retention periods per data type
- How to contact for data requests: privacy@buku.app
- Effective date and version number

TERMS OF SERVICE must include:
- Service description and eligibility (18+)
- User obligations and prohibited activities
- Business owner obligations (accuracy of information, handling bookings)
- No-show policy framework
- Booking confirmation and cancellation policies
- Payment terms (subscription billing via Paddle)
- Ad campaign terms (approval process, prohibited content)
- Intellectual property rights
- Limitation of liability
- Dispute resolution
- Governing law (Pakistan)
- Changes to terms policy
- Contact information

COOKIE POLICY must include:
- Essential cookies (session, auth token)
- Analytics cookies (Vercel Analytics, custom)
- How to opt out
- Third-party cookies

═══════════════════════════════════════════════════════════════════════════════
SECTION 10: MOBILE APP — IOS AND ANDROID (EXPO)
═══════════════════════════════════════════════════════════════════════════════

Build a complete React Native app with Expo SDK 51 targeting both iOS and Android.

APP STRUCTURE (Expo Router file-based routing):
app/
├── (auth)/
│   ├── _layout.tsx            Stack navigator
│   ├── welcome.tsx            3-slide onboarding carousel
│   ├── register.tsx           Phone/email + social login
│   ├── verify-otp.tsx         6-digit OTP with auto-advance
│   ├── profile-setup.tsx      Name + photo (skippable)
│   └── forgot-password.tsx
├── (tabs)/
│   ├── _layout.tsx            Bottom tab navigator
│   ├── index.tsx              Home/Discovery feed
│   ├── explore.tsx            Search results + map view
│   ├── appointments.tsx       Upcoming/Past/Cancelled tabs
│   ├── notifications.tsx      Notification inbox
│   └── profile.tsx            User profile + settings
├── business/
│   ├── [slug].tsx             Business profile page
│   ├── [slug]/book/
│   │   ├── service.tsx        Service selection
│   │   ├── staff.tsx          Staff picker
│   │   ├── datetime.tsx       Calendar + time slots
│   │   └── confirm.tsx        Booking confirmation
├── queue/
│   └── [entryId].tsx          Live queue tracker
├── appointment/
│   └── [id].tsx               Appointment details
├── review/
│   └── [appointmentId].tsx    Post-appointment review
├── ai-call/
│   └── [businessSlug].tsx     AI voice call screen
└── settings/
    ├── index.tsx
    ├── security.tsx
    └── notifications.tsx

SCREENS IN DETAIL:

1. WELCOME (Onboarding):
   3 swipeable slides with illustrations:
   - "Book anything, anywhere" — show category icons
   - "Skip the queue" — show live queue number
   - "Your AI receptionist" — show AI calling feature
   Skip button, progress dots, "Get Started" + "I have an account" buttons

2. REGISTER:
   Country code picker + phone number OR email toggle
   Google Sign-In button (expo-auth-session)
   Apple Sign-In button (expo-apple-authentication, iOS only)
   Privacy policy consent checkbox

3. OTP VERIFY:
   6-box input with auto-advance (each box auto-focus next)
   Countdown timer: "Resend in 0:42"
   "Resend code" link (active after countdown)
   "Try different method" link

4. HOME:
   Top: greeting ("Good morning, Alex"), notification bell with badge, avatar
   Search bar with location (expo-location for current coords)
   AI Agent banner (coming soon, with notify button)
   Category pills horizontal scroll (all categories)
   Quick rebook cards (last 2 booked businesses)
   "Near You" horizontal scroll of business cards
   "Open Queues" section (businesses with active queue today)
   Each card: photo emoji, name, category, rating, distance, next slot

5. SEARCH/EXPLORE:
   Active search input at top
   Filter chips: Rating, Distance, Open Now, Has Queue, Price
   Toggle: List view ↔ Map view
   List: Business cards with promoted badges
   Map: Mapbox with pins (gold for promoted, dark for organic)
   Results count "18 barbershops near you"

6. BUSINESS PROFILE:
   Hero: emoji on gradient background, back + favourite buttons
   Verified badge, business name, category, distance, open/closed status
   Stats row: rating, reviews, staff count, next slot
   Action buttons: directions, phone, share
   Services list: name, duration, price, "Book" button per service
   Staff section: avatar grid with names and ratings
   Photos: horizontal scroll
   Reviews: most recent 5 with "See all" link
   Location: static map with address

7. BOOKING FLOW (4 screens):
   a. SERVICE SELECTION: cards with name/duration/price, select one
   b. STAFF SELECTION: "Any" + individual staff cards with availability
   c. DATE + TIME: calendar (highlight available days), time slot grid
      Slot states: available, filling (< 3 left), selected, unavailable
   d. CONFIRMATION: summary card, notes input, confirm button
      Success: confetti animation + "Add to Calendar" option

8. APPOINTMENTS:
   Segmented control: Upcoming | Past | Cancelled
   Each card: business name/icon, service, date+time, status badge
   Status badges: Confirmed (teal), Pending (gold), Cancelled (grey)
   Actions on upcoming: Directions, Reschedule, Cancel
   Pull to refresh
   Empty states with illustration per tab

9. QUEUE TRACKER:
   Business name, category, "Queue Open" badge
   Animated ring: progress based on position/total
   Ticket number (large, bold)
   Stats: estimated wait, positions ahead, currently serving
   Notification info: "We'll alert you when you're 3 away"
   "Leave Queue" button (confirmation dialog)
   Real-time updates via Socket.IO

10. REVIEW SCREEN:
    Business card with service + date
    5-star overall rating (tap to set)
    4 sub-ratings: wait time, staff, cleanliness, value
    Optional text review
    "Submit" button
    "Skip for now" link

11. NOTIFICATIONS:
    Sections: Today, Yesterday, This Week
    Unread dot indicator per item
    Notification types with icons:
    - 🔔 Urgent (queue called) — highlighted
    - ✅ Confirmed booking
    - ⏰ Reminder
    - ❌ Cancellation
    - ⭐ Review request
    Tap-to-navigate to relevant screen
    Mark all as read button

12. AI VOICE CALL:
    Pulsing ring animation (3 concentric rings, purple)
    AI avatar (robot emoji with glow)
    Business name subtitle
    Waveform animation (8 bars animating while AI speaks)
    Speech bubble showing AI's last response
    "Booking will be confirmed automatically after you choose a time"
    Action buttons: mute, end call, transcript
    Call timer

PUSH NOTIFICATIONS SETUP:
- expo-notifications for permission request + token registration
- Register FCM token to auth-service on app start
- Handle foreground notifications: show in-app banner
- Handle background notifications: system notification
- Handle notification tap: navigate to relevant screen
- Types requiring immediate action: queue_called (navigate to queue screen)

OFFLINE HANDLING:
- Cache last-fetched home feed data
- Show "No internet connection" banner
- Retry queue on reconnect
- Appointments list works offline from cache

PERFORMANCE:
- All screens use React.memo and useCallback appropriately
- FlatList with keyExtractor and getItemLayout for long lists
- Image lazy loading with expo-image
- Skeleton loaders while data fetches
- Optimistic UI updates on booking actions

═══════════════════════════════════════════════════════════════════════════════
SECTION 11: SECURITY — COMPLETE IMPLEMENTATION
═══════════════════════════════════════════════════════════════════════════════

Implement every security measure listed. None are optional.

AUTHENTICATION SECURITY:
- JWT RS256: generate 2048-bit RSA keypair, store private key in secrets
- Access token: 15 min expiry, contains sub, role, jti
- Refresh token: 7 days, stored as bcrypt hash in DB, Redis whitelist
- Token rotation: revoke old refresh token atomically with new issuance
- Concurrent login: allowed, tracked per device (push_tokens table)
- Force logout all: clear all refresh tokens for user
- OTP: 6 digits, bcrypt(rounds=10) stored, 10min TTL in Redis
- OTP lockout: 3 wrong attempts → 15min lockout (Redis key with TTL)
- Password: bcrypt rounds=12, reject if < 8 chars, require mixed chars
- Password reset: crypto.randomBytes(32) token, hash before storing, 1hr TTL

INPUT VALIDATION (Zod on EVERY endpoint):
Every request body, query params, and URL params validated with Zod schemas.
Common validations:
- UUIDs: z.string().uuid()
- Email: z.string().email().toLowerCase()
- Phone: z.string().regex(/^\+[1-9]\d{6,14}$/)
- Pagination: page z.coerce.number().int().min(1), limit z.coerce.number().int().min(1).max(100)
- Reject unknown fields: use .strict() on request body schemas
- Strip HTML from all text fields (DOMPurify on frontend, sanitize-html on backend)

SQL INJECTION PREVENTION:
- Prisma ORM parameterized queries ONLY
- Never construct raw SQL with string interpolation
- For raw queries: use prisma.$queryRaw with Prisma.sql template tag

XSS PREVENTION:
- All user content sanitized with sanitize-html before storage
- Content Security Policy headers via Nginx
- HttpOnly cookies for any cookie-based auth
- SameSite=Strict on all cookies

RATE LIMITING (Kong + Redis):
- Auth endpoints: 20 req/min per IP
- OTP send: 3 per hour per destination
- Search endpoints: 200 req/min per IP
- Booking creation: 10 req/min per user
- File upload: 5 req/min per user
- Admin endpoints: 30 req/min per IP
- Global: 500 req/min per IP

CORS:
- Explicit origin whitelist: thebuku.vercel.app, buku.app, localhost:3000/3001
- Never use wildcard origin
- Credentials: true only for required endpoints
- Preflight cache: 86400 seconds

SECURITY HEADERS (Nginx):
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-...';
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(self)

PADDLE WEBHOOK SECURITY:
Verify all Paddle webhooks:
1. Validate X-Paddle-Signature header
2. Use Paddle's public key to verify signature
3. Check event timestamp (reject if > 5 minutes old)
4. Idempotency: store paddle event IDs, reject duplicates

WEBHOOK OUTGOING SECURITY:
- HMAC-SHA256 signature on all outgoing webhook payloads
- X-Buku-Signature: sha256={hex digest}
- Businesses instructed to verify signature

DATA ENCRYPTION:
- Database at rest: DigitalOcean managed encryption
- Passwords: bcrypt
- PII fields (phone, email): encrypted at application level with AES-256-GCM
- S3/Spaces: server-side encryption enabled
- All secrets in environment variables, never in code

DEPENDENCY SECURITY:
- GitHub Dependabot enabled
- npm audit run in CI pipeline
- Fail build on HIGH or CRITICAL vulnerabilities
- All dependencies pinned to exact versions in package-lock.json

GDPR COMPLIANCE:
- Account deletion endpoint: soft delete → hard delete after 30 days
- Data export endpoint: GET /v1/auth/me/export (JSON of all user data)
- Consent recorded: marketing_emails preference stored with timestamp
- Privacy policy link on all forms collecting personal data
- Cookie consent banner with granular options
- Right to erasure: complete data removal from all tables after 30 days

═══════════════════════════════════════════════════════════════════════════════
SECTION 12: KUBERNETES — COMPLETE K8S MANIFESTS
═══════════════════════════════════════════════════════════════════════════════

Deploy to k3s on DigitalOcean using these Kubernetes manifests.

NAMESPACE:
- production
- monitoring
- infrastructure

DEPLOYMENTS (one per microservice):
Each deployment must have:
- replicas: 2 (auth, booking, queue), 1 (notification, search, ads, analytics)
- resource limits: cpu 500m, memory 512Mi
- resource requests: cpu 100m, memory 128Mi
- liveness probe: GET /health every 10s, 3 failures
- readiness probe: GET /ready every 5s, 1 failure
- envFrom: secretRef for service secrets
- anti-affinity: prefer different nodes
- rolling update strategy: maxSurge 1, maxUnavailable 0

SERVICES:
- ClusterIP for each microservice (internal only)
- Port naming: http-{port}

INGRESS (Nginx Ingress Controller):
- TLS termination with Let's Encrypt cert-manager
- Route api.buku.app → Kong API Gateway
- Route buku.app → Next.js web app (or Vercel)
- Route ws.buku.app → queue-service WebSocket

CONFIGMAPS:
- kong-config: nexus.yml content
- nginx-config: nginx.conf content

SECRETS (sealed with kubeseal):
- database-secret: DATABASE_URL, DATABASE_READ_URL
- redis-secret: REDIS_URL
- kafka-secret: KAFKA_BROKERS, CLUSTER_ID
- jwt-secret: JWT_PRIVATE_KEY (RS256), JWT_PUBLIC_KEY
- services-secret: all API keys (Twilio, Firebase, AWS, etc.)
- paddle-secret: PADDLE_API_KEY, PADDLE_WEBHOOK_SECRET

PERSISTENT VOLUMES:
- PostgreSQL: 50Gi SSD
- Redis: 10Gi SSD
- Kafka: 50Gi SSD
- Elasticsearch: 20Gi SSD
- ClickHouse: 30Gi SSD

HORIZONTAL POD AUTOSCALER:
- booking-service: min 2, max 10, CPU target 70%
- queue-service: min 2, max 8, CPU target 60%
- auth-service: min 2, max 6, CPU target 70%

MONITORING STACK:
- Prometheus deployment + service monitor for each service
- Grafana with dashboards: system overview, per-service, Kafka lag, DB
- AlertManager: email alerts for: pod crash loop, high CPU, Kafka lag > 10K,
  DB connections > 80%, booking error rate > 1%
- Loki + Promtail: structured log aggregation, retention 14 days

═══════════════════════════════════════════════════════════════════════════════
SECTION 13: CI/CD PIPELINE
═══════════════════════════════════════════════════════════════════════════════

Build complete GitHub Actions workflows:

.github/workflows/

1. ci.yml — On every push:
   - Lint (ESLint)
   - Type check (tsc --noEmit)
   - Unit tests (Jest)
   - Security audit (npm audit --audit-level=high)
   - Docker build test (ensure images build successfully)
   - Runs in parallel across all services

2. integration-test.yml — On PR to main:
   - Spin up postgres, redis, kafka in containers
   - Run integration tests
   - Run Playwright E2E tests
   - Generate coverage report

3. deploy-production.yml — On merge to main:
   - Build Docker images for linux/amd64
   - Push to DigitalOcean Container Registry
   - Update Kubernetes deployments (rolling update)
   - Run smoke tests
   - Notify on failure (send alert)

4. security-scan.yml — Weekly:
   - Trivy scan on all Docker images
   - Snyk dependency check
   - OWASP ZAP scan on API

5. mobile-build.yml — On tag:
   - EAS Build for iOS (TestFlight)
   - EAS Build for Android (Google Play internal)

═══════════════════════════════════════════════════════════════════════════════
SECTION 14: PAYMENT INTEGRATION — PADDLE
═══════════════════════════════════════════════════════════════════════════════

Integrate Paddle as the merchant-of-record payment processor.

SUBSCRIPTION PLANS:
- free: unlimited (no Paddle subscription needed)
- professional: $29/month or $290/year (save $58)
- enterprise: $99/month or $990/year (save $198)

PADDLE ENDPOINTS:
POST   /v1/payments/create-subscription    Create Paddle checkout
POST   /v1/payments/update-plan            Upgrade/downgrade plan
POST   /v1/payments/cancel-subscription    Cancel subscription
GET    /v1/payments/subscription           Get current subscription status
GET    /v1/payments/portal-url             Get Paddle customer portal URL
POST   /v1/payments/webhook                Paddle webhook receiver (public)

AD PAYMENT:
POST   /v1/payments/create-ad-payment      One-time Paddle checkout for ad purchase

PADDLE WEBHOOK HANDLER:
Handle these Paddle events:
- subscription.created → update subscription_plans table, send welcome email
- subscription.updated → update plan/status
- subscription.cancelled → set cancel_at_period_end=true
- subscription.past_due → email warning to business owner
- subscription.paused → pause business dashboard access
- transaction.completed → for one-time ad purchases
- transaction.refunded → process refund

SECURITY: Verify every Paddle webhook with Paddle's public key.
Idempotency: store paddle_event_id, reject duplicates.

BUSINESS PLAN ENFORCEMENT:
Middleware checkSubscription():
- free: max 50 bookings/month (count from appointments), 1 staff, no ads
- professional: unlimited bookings, 10 staff, access to all features
- enterprise: unlimited everything + AI receptionist + webhooks + API

═══════════════════════════════════════════════════════════════════════════════
SECTION 15: COMPLETE TESTING SUITE
═══════════════════════════════════════════════════════════════════════════════

Every test must PASS before deployment is considered complete.

UNIT TESTS (Jest):
Auth service:
- register: success, duplicate email, duplicate phone, invalid phone format
- verify-otp: success, wrong OTP, expired OTP, lockout after 3 attempts
- login: success, wrong password, non-existent user
- refresh: success, expired token, revoked token
- JWT generation: correct payload, RS256 algorithm, expiry

Booking service:
- slot availability: normal, buffer overflow, staff on holiday,
  max_concurrent=3 (3 succeed simultaneously), timezone edge case
- slot locking: 50 concurrent requests for same slot → only 1 succeeds
- state machine: all valid transitions, all invalid transitions
- confirmation code: format BK-XXXX, uniqueness

Queue service:
- ticket numbering: 500 concurrent joins → all unique sequential numbers
- position calculation: correct after each state change
- estimated wait: correct rolling average
- grace period: no-show triggered exactly at grace_period

Shared packages:
- AppError: correct HTTP status codes
- JWT middleware: valid token, expired, tampered, wrong algorithm
- RBAC: correct role enforcement
- Rate limiter: allows n requests, blocks n+1
- HMAC webhook signature: matches expected, rejects tampered

INTEGRATION TESTS (Supertest + Testcontainers):
Full flow tests using real Postgres and Redis in Docker:
1. Register → verify OTP → create business → add service → add staff →
   set availability → user books → business confirms → user sees confirmed →
   reminder fires → user shows up → business completes → user reviews
2. Register user → search businesses → find open queue → join queue →
   business calls next → user receives notification → business serves → done
3. Business creates ad → admin approves → appears in search results →
   impression tracked → click tracked → booking attributed

LOAD TESTS (k6):
File: tests/load/booking-load-test.js
- 50 concurrent booking requests for same slot
- Expected: 1 success (201), 49 conflicts (409)
- Latency P95 < 500ms

File: tests/load/queue-load-test.js
- 200 concurrent queue join requests
- Expected: 200 unique ticket numbers
- Latency P95 < 300ms

File: tests/load/search-load-test.js
- 500 VU running geo search simultaneously
- Expected: P95 < 200ms, 0% error rate

E2E TESTS (Playwright):
- Landing page: all buttons work, forms submit, navigation works
- User registration flow: complete from scratch
- Business registration + setup flow
- Search and book: end-to-end on test business
- Queue join and track: end-to-end
- Dashboard: create service, set availability, view calendar

═══════════════════════════════════════════════════════════════════════════════
SECTION 16: DEPLOYMENT — COMPLETE SETUP
═══════════════════════════════════════════════════════════════════════════════

Write complete scripts for deploying to DigitalOcean VPS running Ubuntu 24.04.

scripts/deploy.sh — Full deployment:
1. SSH to VPS
2. Pull latest code from git
3. Build Docker images for linux/amd64
4. Push to DigitalOcean Container Registry
5. Apply Kubernetes manifests (kubectl apply -f infrastructure/k8s/)
6. Wait for rollout completion
7. Run database migrations (kubectl exec into db-migrate pod)
8. Run smoke tests against production endpoints
9. Print deployment summary

scripts/first-time-setup.sh — Run once on fresh VPS:
1. apt update && apt upgrade
2. Install Docker, kubectl, helm, k3s
3. Install Certbot + Nginx
4. Configure DNS records (print instructions)
5. Setup DigitalOcean Container Registry authentication
6. Create Kubernetes namespaces and secrets
7. Apply infrastructure manifests (Postgres, Redis, Kafka, ES, ClickHouse)
8. Wait for all infrastructure to be healthy
9. Run database migrations and seeds
10. Apply application manifests
11. Configure Nginx and SSL
12. Print access URLs

scripts/health-check.sh:
Check every component and print status:
- PostgreSQL: connection test + simple query
- Redis: PING command
- Kafka: list topics + broker API
- Elasticsearch: cluster health endpoint
- ClickHouse: HTTP ping endpoint
- Each microservice: /health endpoint
- Kong: /status endpoint
- Website: HTTP 200 check
- API Gateway: test auth endpoint
Print: ✅ or ❌ for each component

scripts/rollback.sh:
1. Accept previous image tag as argument
2. Update all Deployment image refs to previous tag
3. kubectl apply and wait for rollout
4. Verify health

scripts/debug.sh:
Interactive debugging tool:
- Option 1: Show all pod logs for a service
- Option 2: Check Kafka consumer lag per service
- Option 3: Show recent error logs across all services
- Option 4: Check Redis memory usage and key counts
- Option 5: Check database connection count and slow queries
- Option 6: Run health check
- Option 7: Show Kubernetes events (errors only)

═══════════════════════════════════════════════════════════════════════════════
SECTION 17: DOCUMENTATION
═══════════════════════════════════════════════════════════════════════════════

Write these complete documents:

docs/DEPLOYMENT_GUIDE.md:
Step-by-step from zero to live. Include:
- Prerequisites (domain, DigitalOcean account, GitHub repo)
- DNS configuration
- DigitalOcean Droplet setup (exact commands)
- First-time setup walkthrough
- Environment variables reference (all variables, what they do, how to get them)
- SSL certificate setup
- Verification steps (how to confirm each component works)
- Common issues during deployment + solutions

docs/DEBUGGING_GUIDE.md:
Per-component troubleshooting:
For each service: common errors, what causes them, exact fix commands
- "Kafka broker not available" → check KRaft CLUSTER_ID format, verify listeners
- "Redis ECONNREFUSED" → check Redis pod status, test with redis-cli
- "Prisma migration failed" → common migration errors and fixes
- "Elasticsearch index not found" → rebuild command
- "JWT invalid signature" → key mismatch debugging
- "Docker image platform mismatch" → buildx fix
- "OTP not sending" → Twilio credential check, LocalStack test mode
- Pod crash loops: how to read logs, common OOMKilled fix
- Database connection pool exhausted: diagnosis + fix
- Kafka consumer lag growing: partition assignment, consumer restart
- 502 Bad Gateway from Kong: service health check debugging

docs/API_REFERENCE.md:
Complete OpenAPI 3.0 specification for every endpoint.
Include: method, path, auth required, request body schema, response schema,
error codes, example request/response.

docs/RUNBOOK.md:
Day-to-day operations:
- How to add a new category (SQL + ES index update)
- How to verify a business (admin steps)
- How to approve an ad campaign
- How to handle a reported review
- How to investigate a payment dispute
- Weekly maintenance checklist
- Monthly backup verification
- How to scale up a service
- How to handle a database migration in production
- On-call escalation procedures

═══════════════════════════════════════════════════════════════════════════════
SECTION 18: ENVIRONMENT VARIABLES
═══════════════════════════════════════════════════════════════════════════════

Document every environment variable in .env.example with:
- Variable name
- Description
- Example value
- How to obtain (where to get the actual value)
- Required: yes/no
- Default if optional

Groups:
DATABASE, REDIS, KAFKA, ELASTICSEARCH, CLICKHOUSE, JWT (private + public key),
AWS_DIGITALOCEAN_SPACES, SES, SNS, TWILIO, FIREBASE, GOOGLE_OAUTH, APPLE_OAUTH,
PADDLE, MAPBOX, SERVICE_URLS, FEATURE_FLAGS (AI_RECEPTIONIST_ENABLED, etc.)

Create .env.production.example with notes on which values are different from dev.

═══════════════════════════════════════════════════════════════════════════════
SECTION 19: LOCALSTACK INIT SCRIPTS
═══════════════════════════════════════════════════════════════════════════════

infrastructure/localstack/init/01-setup.sh:
Create all AWS resource equivalents locally:
- S3 buckets: buku-media-dev, buku-documents-dev, buku-backups-dev
  with versioning and CORS for web uploads
- SES: verify identity noreply@buku.app, noreply@bukuapp.dev
  Create email templates: booking_confirmation, booking_reminder,
  booking_cancelled, welcome, review_request, staff_invite, password_reset
  (each template must be full HTML with proper BUKU branding)
- SNS: create topic buku-notifications, buku-sms, buku-alerts
  Subscribe to test phone number for development
- SQS: create queues buku-jobs, buku-dlq (with dead letter config)
- Secrets Manager: create secrets for all service credentials
  (with dummy dev values populated)
Print ✅ for each resource created.

═══════════════════════════════════════════════════════════════════════════════
SECTION 20: FINAL VERIFICATION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

Before declaring completion, verify every item:

INFRASTRUCTURE:
[ ] docker compose up starts all 15 containers with no errors
[ ] All containers pass health checks within 60 seconds
[ ] All 41 Kafka topics exist with correct partitions
[ ] PostgreSQL has all 31 tables with correct schema
[ ] All PostGIS extensions enabled
[ ] Elasticsearch businesses index exists with correct mapping
[ ] ClickHouse tables created
[ ] LocalStack has S3 buckets, SES identities, SNS topics
[ ] Kong routes all 7 services correctly
[ ] Kong JWT plugin blocks requests without valid tokens
[ ] Kong rate limiting works (test with rapid requests)

VERSION CONTROL & SCALE-OUT (Sections 22-25):
[ ] main branch protected — no direct pushes, PR + passing CI required
[ ] Husky pre-commit hook blocks bad commit messages and staged secrets
[ ] pgvector extension enabled; business_knowledge_chunks table exists
[ ] Outbox table exists; booking service writes event + row in one transaction
[ ] All Dockerfiles run as non-root user; all K8s manifests set securityContext
[ ] AuditLog, Notification, and AdEvent tables are range-partitioned by created_at

BACKEND:
[ ] POST /v1/auth/register creates user, sends OTP
[ ] POST /v1/auth/verify-otp returns JWT pair
[ ] POST /v1/auth/refresh rotates tokens correctly
[ ] Concurrent booking test: 50 requests → 1 success, 49 conflicts
[ ] Concurrent queue test: 200 joins → 200 unique tickets
[ ] Slot cache invalidates on booking creation
[ ] Kafka events flow from booking → notification service
[ ] Email notification sent on booking confirmation (LocalStack)
[ ] SMS notification sent on queue called (LocalStack)
[ ] Push notification registered and sendable
[ ] Webhook delivery with HMAC signature verification
[ ] Paddle webhook processed and subscription updated
[ ] Search returns results with ad injection
[ ] Analytics events insert into ClickHouse

WEBSITE:
[ ] Landing page loads in < 3 seconds
[ ] All 6 filter chips filter listings correctly
[ ] Booking modal opens, date/time selectable, confirms
[ ] Queue join works and shows toast
[ ] Favourite button toggles
[ ] Email signup form validates and submits
[ ] All legal pages have complete content
[ ] Mobile responsive at 375px, 768px, 1440px
[ ] Lighthouse score ≥ 90 all categories
[ ] All navigation links work
[ ] Business registration page works
[ ] User login/register works against real API
[ ] Dashboard accessible after business login

MOBILE:
[ ] App builds for iOS without errors
[ ] App builds for Android without errors
[ ] Register and OTP verify flow works
[ ] Home feed loads businesses from API
[ ] Search filters work
[ ] Business profile loads
[ ] Booking flow completes successfully
[ ] Queue join and live position updates work
[ ] Push notification received on booking confirmation
[ ] Review submission works after completed appointment

SECURITY:
[ ] Modified JWT rejected with 401
[ ] Expired token rejected with 401
[ ] User cannot access business owner routes
[ ] SQL injection attempt returns 400, not 500
[ ] XSS payload sanitized before storage
[ ] Rate limit triggers after configured threshold
[ ] CORS blocks requests from unlisted origins
[ ] Security headers present on all responses
[ ] Paddle webhook with bad signature rejected
[ ] GDPR deletion removes all user data

═══════════════════════════════════════════════════════════════════════════════
SECTION 21: IMPORTANT THINGS NOT TO MISS
═══════════════════════════════════════════════════════════════════════════════

These are critical items that are easy to forget:

1. CLUSTER_ID: Generate a valid base64 UUID for Kafka KRaft.
   Command: python3 -c "import uuid,base64; print(base64.urlsafe_b64encode(uuid.uuid4().bytes).rstrip(b'=').decode())"
   This must be exactly 22 characters. Wrong format = Kafka won't start.

2. POSTGRES LOCALE: Use C.UTF-8, NOT en_US.utf8.
   en_US.utf8 fails on Alpine-based images.

3. DOCKER PLATFORM: All CI/CD builds must use --platform linux/amd64
   if developing on Apple Silicon Mac.

4. ELASTICSEARCH MEMORY: Set vm.max_map_count=262144 on Linux:
   echo 'vm.max_map_count=262144' >> /etc/sysctl.conf && sysctl -p

5. REDIS PERSISTENCE: appendonly yes + save config must be set.
   Slot locks and queue state must survive Redis restarts.

6. KAFKA INIT ORDER: kafka-init container must complete successfully
   before any microservice starts. Use depends_on + service_completed_successfully.

7. BOOKING LOCK RELEASE: The Redis SETNX lock MUST be released in a
   finally block regardless of success or failure. Never skip this.

8. JWT RS256 KEYS: Generate RSA keypair, not HMAC secret.
   openssl genrsa -out private.pem 2048
   openssl rsa -in private.pem -pubout -out public.pem
   Store both as environment variables (base64 encoded).

9. CONFIRMATION CODES: Must be UNIQUE per appointment.
   Implement collision retry logic (up to 5 attempts).

10. QUEUE POSITION BROADCAST: After every queue state change,
    recalculate ALL waiting entries' positions, not just the affected one.

11. LOCALSTACK DOCKER SOCKET: Must mount /var/run/docker.sock AND
    set DOCKER_HOST=unix:///var/run/docker.sock for Lambda support.

12. PADDLE WEBHOOK IDEMPOTENCY: Store Paddle event IDs in a processed_events
    table. Paddle may deliver the same webhook multiple times.

13. DATABASE MIGRATIONS IN K8S: Run as a Job that must complete before
    Deployments start. Use initContainers or a separate Job with helm hooks.

14. SOFT DELETE: users.deleted_at must be checked in EVERY query that
    fetches users. Add a global Prisma middleware to filter deleted users.

15. SEARCH INDEX REBUILD: On search-service startup, check if ES index
    has < 10% of Postgres business count → trigger full rebuild automatically.

16. CORS PREFLIGHT: Kong must handle OPTIONS requests for all routes
    without requiring JWT authentication.

17. WEBSOCKET AUTH: Socket.IO connections must validate JWT token
    on the initial handshake (auth query param or header).

18. MOBILE DEEP LINKING: Configure expo-linking for notification taps.
    Each notification type has a specific destination screen.

19. LEGAL PAGES: Privacy policy and Terms of Service must have
    effective dates and be linked in every form that collects personal data.

20. SITEMAP: Generate sitemap.xml including all business profile pages
    (dynamic routes). Submit to Google Search Console.

═══════════════════════════════════════════════════════════════════════════════
SECTION 22: GIT WORKFLOW AND VERSION CONTROL
═══════════════════════════════════════════════════════════════════════════════

The monorepo in Section 1 has no branching, commit, or review policy attached
to it. Section 13's CI/CD pipeline assumes "on PR to main" and "on merge to
main" without ever defining what "main" means or how a change gets there.
Fix that here.

BRANCHING MODEL: trunk-based, not GitFlow.
- `main` is always deployable. No `develop`, no `release/*` branches — at
  this team size a second long-lived branch is pure merge-conflict tax with
  no offsetting benefit.
- All work happens on short-lived branches off `main`:
  `feat/<scope>-<slug>`, `fix/<scope>-<slug>`, `chore/<scope>-<slug>`.
  `<scope>` is a workspace name from Section 1 (`booking`, `queue`, `common`,
  `web`, etc.) so the branch name alone says which part of the monorepo it
  touches.
- Branches live 2-3 days max. A feature that needs longer ships behind a
  feature flag rather than drifting from `main`.

COMMIT CONVENTION: Conventional Commits, enforced, not suggested.
- Format: `<type>(<scope>): <description>` — e.g.
  `feat(booking): add reschedule endpoint`,
  `fix(queue): honor priorityLane in sorted-set score`,
  `chore(kafka): consolidate topics.ts and producer.ts into one export`.
- Types: feat, fix, chore, docs, refactor, test, perf, ci.
- Enforce with commitlint + a Husky commit-msg hook — a malformed commit
  message fails locally, before it reaches CI.
- This is not decoration. Conventional Commits are what let you auto-version
  `packages/common`, `packages/kafka`, and `packages/database` — every one
  of the 7 services in Section 5 depends on all three. Use Changesets for
  this, not semantic-release: semantic-release is built to auto-publish one
  package to a registry, and these packages are private, unpublished,
  workspace-linked dependencies. Changesets is built for exactly that shape
  — a monorepo of internal packages that still need coordinated version
  bumps and a real changelog when `@buku/kafka` changes underneath 7
  consumers of it.

BRANCH PROTECTION ON `main` (a GitHub repo setting, not a file):
- No direct pushes, including from admins. Every change goes through a PR.
- Require Section 13's `ci.yml` and `integration-test.yml` to pass before
  merge is allowed.
- Require 1 approving review once there is a second engineer. Solo, still
  require the PR (not a direct push) so there is a reviewable diff on record
  even if the only reviewer is CI.
- Require the branch to be up to date with `main` before merging, so a
  merged PR can never silently reintroduce something another PR just fixed.

PRE-COMMIT HOOKS (Husky + lint-staged):
- On commit: ESLint --fix and Prettier, staged files only.
- On commit: a secret scan (gitleaks or trufflehog) on the staged diff.
  This is not a style nit — `.env.example` in Section 1 already names
  Paddle, Twilio, Firebase, and AWS credentials. One `git add .env` by
  accident is a real-money incident.
- On push: `tsc --build --dry` so a broken build never reaches the CI queue.

MONOREPO-AWARE CI (extends Section 13, does not replace it):
Section 13's `ci.yml` runs lint/typecheck/test "in parallel across all
services" on every push — meaning a one-line fix to the auth service
currently re-lints, re-typechecks, and rebuilds all 7 services and 3
packages, every time. Fine at today's size, expensive once the suite is
real. Add path filtering (`dorny/paths-filter`, or adopt Turborepo purely
for its affected-package graph) so `ci.yml` only runs for workspaces that
actually changed, plus any workspace that depends on one that changed — a
change to `packages/kafka` must still trigger all 7 services' tests, since
all 7 import it.

RELEASE TAGGING:
Tag every `main` merge that reaches production: `v<major>.<minor>.<patch>`,
generated from Conventional Commits via Changesets. `scripts/rollback.sh`
(Section 16) already accepts "previous image tag as argument" — that
argument should always be one of these git tags, never a guessed Docker
tag, so a rollback and a `git revert` always point at the same commit.

.gitignore MUST include: node_modules/, dist/, .env, .env.*.local,
*.tsbuildinfo, coverage/ — and must NOT include .env.example or
.env.production.example, which are the documentation of what secrets exist.

═══════════════════════════════════════════════════════════════════════════════
SECTION 23: VECTOR SEARCH FOR THE AI RECEPTIONIST (AND WHY NOT GRAPH — YET)
═══════════════════════════════════════════════════════════════════════════════

Two additions were evaluated to scale this architecture out: a vector
database and a graph database. Add the first, in a specific narrow form.
Do not add the second yet — the reasoning for both is recorded here,
because "we decided not to, and why" is as important to keep as "we
decided to."

WHY NOT A SEPARATE VECTOR DATABASE (Pinecone, Weaviate, Qdrant, Milvus):
None of them. PostgreSQL 17 is already the system of record — add the
`pgvector` extension to it instead of introducing a new datastore with its
own backup story, its own failure mode, and its own operational surface.
pgvector's HNSW index handles millions of vectors at latencies this
platform will not approach for years. A dedicated vector database is a
scale problem that does not exist here yet; adding one now is the same
mistake as putting this on Kubernetes on day one — infrastructure that
exists to look serious, not to solve a problem you have.

WHERE VECTOR SEARCH ACTUALLY EARNS ITS PLACE: the AI receptionist.
`AiReceptionistConfig.businessContext` (Section 3) is one free-text field,
meant to be stuffed wholesale into the model's context on every call.
That is fine for a barbershop with three sentences of hours and pricing.
It breaks for a multi-location clinic with an insurance list, a
cancellation policy, a service menu with variants, and a parking note —
either the context grows unbounded (cost, latency, and a model that loses
track of the one relevant sentence in a wall of text), or someone manually
trims `businessContext` and the receptionist starts giving wrong answers
to real questions. That is a retrieval problem, not a prompt-length
problem, and retrieval over a business's own content is exactly what a
vector column is for.

ADD to packages/database/prisma/schema.prisma:

model BusinessKnowledgeChunk {
  id          String   @id @default(uuid()) @db.Uuid
  businessId  String   @map("business_id") @db.Uuid
  source      String   @db.VarChar(50)    // "faq" | "service" | "policy" | "hours_note"
  content     String                       // chunk text, ~200-500 tokens
  embedding   Unsupported("vector(1536)")  // pgvector column, text-embedding-3-small
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  business Business @relation(fields: [businessId], references: [id], onDelete: Cascade)

  @@index([businessId])
  @@map("business_knowledge_chunks")
}

Also add to `packages/database/docker-init/01-extensions.sql`:
CREATE EXTENSION IF NOT EXISTS vector;
...and an HNSW index on `business_knowledge_chunks.embedding` once the
table has real rows (HNSW build cost is real; do not build it on an empty
table and call it done — verify it exists after seeding).

RETRIEVAL FLOW (owned by whichever service ends up handling AI-receptionist
call turns — see the note at the end of this section):
1. On each caller utterance, embed it with the same model used to index
   the chunks.
2. `SELECT content FROM business_knowledge_chunks WHERE business_id = $1
   ORDER BY embedding <=> $2 LIMIT 5` — cosine distance via pgvector's
   `<=>` operator, HNSW index on `embedding`.
3. Inject only those 5 chunks into that turn's context, not the whole
   knowledge base. `businessContext` stays as the always-present short
   summary (name, category, one-line description); the new table replaces
   it as the source for anything caller-question-shaped.
4. Re-embed a business's chunks whenever `/dashboard/services` or
   `/dashboard/settings` changes — hook into the existing
   `businesses.updated` Kafka topic (Section 4) the same way the search
   service already re-indexes Elasticsearch on that event. One event, two
   consumers.

SECONDARY USE (same infrastructure, no new work required): embed
`Business.description` + category once, and `ORDER BY embedding <=>
:thisBusinessEmbedding LIMIT 10` gives a free "you might also like" row
for the business profile page. Do not build this first — it falls out of
the receptionist work almost for free once the extension and the embedding
call already exist.

FLAG, DO NOT SILENTLY ASSUME: there is no Section 5.8 (AI Receptionist
Service) anywhere in this document, and no step for it in EXECUTION ORDER
below. `AiReceptionistConfig`, `AiCallLog`, and the `ai.call.*` Kafka
topics (Section 4) exist; the service that owns them, and the retrieval
flow above, does not. Write Section 5.8 before building this — do not
bolt the retrieval flow onto an existing service (booking, notification)
just because it needs a home.

WHY NOT A GRAPH DATABASE (Neo4j, Amazon Neptune) — NOT YET:
Every graph-shaped question this platform has today is shallow enough that
a real graph engine would be solving a problem that does not exist yet:
- Category parent/child (Section 3's `Category.parentId`) is 2-3 levels
  deep. A self-referencing foreign key and a recursive CTE answer every
  query this tree will ever need.
- "Customers who booked X also booked Y" is co-occurrence analytics, not
  graph traversal — a GROUP BY and a JOIN over `booking_analytics` in
  ClickHouse (Section 5.7), which already exists for exactly this kind of
  aggregate query.
- A referral program, if built, is a `referredByUserId` self-reference
  with a bounded lookup depth (2-3 hops for attribution), not an
  open-ended graph walk.
The one future scenario that would genuinely justify a graph engine is
fraud-ring detection on the ads platform (Section 5.6) — clusters of
businesses or accounts sharing payment fingerprints, devices, or IP ranges
to catch coordinated click fraud or fake-listing rings. That is real graph
work (connected components, community detection), but it is not a problem
until the ads platform has real volume and real fraud attempts. When it
is: try the Apache AGE extension on the same Postgres instance first (same
extend-don't-add-a-system logic as pgvector above); reach for a standalone
Neo4j or Neptune only if AGE's performance genuinely runs out, which at
this platform's scale is unlikely before year 2-3.

═══════════════════════════════════════════════════════════════════════════════
SECTION 24: EVENT DELIVERY RELIABILITY AT SCALE
═══════════════════════════════════════════════════════════════════════════════

Not asked for by name, but the same category of question as Section 23:
what does this architecture need before "scale out" stops being a slide
and starts being real traffic.

Section 5.2's own booking algorithm, steps 7-8: "After INSERT → publish
bookings.created to Kafka", then "Response returns to user BEFORE Kafka
publish completes." That is a dual write — a Postgres INSERT and a Kafka
publish as two separate operations with two separate failure modes. At low
volume the Kafka publish basically never fails and nobody notices. At real
scale, "basically never" starts happening on a schedule: the booking
exists in Postgres, confirmed to the customer, and no consumer ever hears
about it — no confirmation notification, no ClickHouse analytics row, no
search re-index trigger. The booking is real and invisible to every other
service in Section 5.

FIX: a transactional outbox, not a bigger retry count.
1. Add an `outbox_events` table: business_id, aggregate_type, aggregate_id,
   event_type, payload (jsonb), created_at, published_at (nullable).
2. In the SAME Postgres transaction as the appointment INSERT, insert one
   row into `outbox_events`. Either both commit or neither does — no
   window where one exists without the other.
3. A separate lightweight relay (a small polling worker to start; Debezium
   reading the Postgres WAL later, if the team wants CDC done properly)
   reads unpublished outbox rows in order, publishes to Kafka, marks
   `published_at`. If the relay crashes mid-batch it resumes from the last
   unpublished row — nothing is lost, because the source of truth for
   "did this happen" is the same database transaction as the business
   write, not a separate network call.
Apply this to every service that currently does DB-write-then-publish
inline (booking, queue, and ads' budget/attribution writes in Section
5.6). Booking first — it is the one event every other service in Section
5 depends on hearing about.

═══════════════════════════════════════════════════════════════════════════════
SECTION 25: PODMAN, SHARDING, AND CONTAINER HARDENING
═══════════════════════════════════════════════════════════════════════════════

Two more additions were evaluated. Neither is adopted, for reasons recorded
below — and both surfaced one real gap that is adopted regardless of either
decision.

WHY NOT PODMAN INSTEAD OF DOCKER — NOT NOW:
The real difference is daemonless, rootless-by-default containers — a
genuine security property, but one that lives entirely in local dev and CI
build tooling. It does not touch production: Section 12's k3s runs on
containerd regardless of which tool built the image, so this decision has
zero effect on how a real request is served or how user data is secured.
Docker Desktop's per-seat licensing (the usual reason teams switch) does
not apply here either — it only applies above 250 employees or $10M
revenue, and Docker Engine on Linux, which is what CI and the production
build pipeline actually use, has been and remains Apache-2.0, free,
unaffected. Meanwhile `docker-compose.dev.yml` already runs 20 services
with specific `depends_on` / `service_healthy` ordering (Section 1) —
podman-compose's compatibility with that spec is real but imperfect, and
rootless volume permissions are a known rough edge for exactly the
stateful services this stack leans on hardest (Postgres, Elasticsearch,
Kafka). Revisit this once the product is live and there is slack for a
low-stakes migration — not while Sections 1-21 are still being reconciled
into one working system.

THE ACTUAL SECURITY GAP THIS SURFACED: Section 11 covers auth, input
validation, rate limiting, and encryption in real depth. Section 12
covers replicas, probes, and autoscaling. Neither says anything about the
containers themselves. No Dockerfile is specified to run as a non-root
user, and no Kubernetes manifest specifies a `securityContext`. Add both,
regardless of Docker vs Podman:
- Every Dockerfile: create and `USER` a non-root user (the official Node
  images already ship a `node` user for exactly this).
- Every Deployment in Section 12: `securityContext: { runAsNonRoot: true,
  readOnlyRootFilesystem: true, allowPrivilegeEscalation: false,
  capabilities: { drop: ["ALL"] } }`.
This is the control that actually reduces blast radius if a service is
compromised. It works identically under Docker or Podman, and it costs
far less than a runtime migration to get.

WHY NOT SHARD THE USERS AND BUSINESSES TABLES — NOT NOW:
Sharding means splitting a table's rows across separate database
instances, each queried through shard-aware routing. This platform has
zero production rows today, and a single well-sized PostgreSQL primary
with read replicas comfortably carries tens of millions of rows and
thousands of transactions per second before it becomes the bottleneck —
this is not a today problem, or a next-year problem.
More specifically wrong for these two tables: `User` and `Business` are
the two tables nearly every query in Section 5 joins against at once — a
single booking touches the customer (`User`), the business (`Business`),
and the staff member (`User` again). Shard `User` and `Business`
independently and almost every query in this system becomes a cross-shard
join, which Postgres does not do natively and Prisma does not support at
all. Doing this now means rewriting every service's data access layer
before a single real booking has happened.
WHAT IS ALREADY RIGHT: every primary key in Section 3 is a UUID, not an
auto-increment integer — that was the correct call, and it is exactly
what makes sharding possible later without an ID migration. Nothing to
change there.
WHAT TO DO INSTEAD, NOW: the tables that will actually grow fast are
event-shaped, not entity-shaped — `AuditLog`, `Notification`, and
`AdEvent` accumulate a row per action, not a row per signup. Use native
PostgreSQL declarative partitioning on these three (`PARTITION BY RANGE
(created_at)`, monthly), inside the same single instance. This keeps
writes and time-range reads fast and makes old-partition archival a
`DETACH PARTITION` instead of a `DELETE` — and it costs zero application
code changes, since Postgres routes to partitions transparently under
Prisma.
THE REAL TRIGGER FOR ACTUAL SHARDING, LATER: a single write primary that
stays CPU- or IO-bound even after read replicas, PgBouncer connection
pooling, and query optimization are all in place — realistically a
tens-of-millions-of-users, sustained-high-write-throughput problem. When
that day comes, reach for Citus (a Postgres extension, not a rewrite —
Prisma and existing SQL mostly keep working) before a hand-rolled
sharding layer.

═══════════════════════════════════════════════════════════════════════════════
EXECUTION ORDER
═══════════════════════════════════════════════════════════════════════════════

Complete work in this exact sequence for maximum efficiency:

PHASE 1 — Foundation (do this first, everything depends on it)
1. Git repo init: branch protection on main, Husky + commitlint +
   lint-staged hooks, gitleaks secret scan, Changesets initialized
   (Section 22) — before the first real commit, not bolted on later
2. Monorepo structure and root config files
3. tsconfig.base.json and per-service configs
4. packages/common (AppError, response helpers, middleware)
5. packages/database (Prisma schema, migrations, seeds, plus
   BusinessKnowledgeChunk and outbox_events tables — Sections 23-24)
6. packages/kafka (producer/consumer factory)
7. docker-compose.dev.yml
8. infrastructure/localstack/init/01-setup.sh
9. packages/search/elasticsearch/mappings/businesses.json
10. packages/database/docker-init/01-extensions.sql (PostGIS + pgvector)
11. packages/database/clickhouse schema
12. Verify: docker compose up starts everything cleanly

PHASE 2 — Backend Services
13. Auth service (complete with all endpoints + tests)
14. Booking service (complete with slot locking, tests, AND
    transactional-outbox event publishing — Section 24 — in place of
    publish-after-response)
15. Queue service (HTTP + WebSocket + Redis state)
16. Notification service (all Kafka consumers + channels)
17. Search service (ES + ad injection)
18. Ads service (tracking + budget enforcement)
19. Analytics service (ClickHouse ingestion)
20. Kong declarative config
21. Integration tests passing

PHASE 3 — Frontend
22. Next.js app structure and layout
23. Landing page (complete rebuild)
24. Auth pages (login, register, OTP)
25. Search and business profile pages
26. Booking flow
27. User dashboard
28. Business dashboard (all sections)
29. Admin panel
30. Legal pages (all 5)
31. E2E tests passing

PHASE 4 — Mobile
32. Expo app structure
33. Onboarding + auth screens
34. Home + search screens
35. Business profile + booking flow
36. Queue tracker with Socket.IO
37. Notifications + review
38. Push notification setup
39. App builds successfully (iOS + Android)

PHASE 5 — Production Readiness
40. Kubernetes manifests (all services, non-root securityContext per Section 25)
41. CI/CD GitHub Actions workflows, with path-filtered / affected-only
    triggers (Section 22)
42. Terraform for DigitalOcean
43. Nginx config + SSL
44. Monitoring (Prometheus + Grafana)
45. All scripts (deploy, rollback, health-check, debug)
46. All documentation (4 guides)
47. Load tests passing
48. Security audit passing
49. AI Receptionist service — NOT YET SPECIFIED. Placeholder step: the
    schema and Kafka topics exist (Section 3, Section 4), but no Section
    5.8 defines its endpoints, and Section 23's retrieval flow has no
    service to live in. Write Section 5.8 before building this; do not
    skip straight to code.
50. Final verification checklist — every item ✅

═══════════════════════════════════════════════════════════════════════════════
DO NOT STOP UNTIL EVERY ITEM IN THE FINAL VERIFICATION CHECKLIST IS ✅
═══════════════════════════════════════════════════════════════════════════════

