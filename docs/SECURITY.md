# Security

Security in BUKU is **layered**: every control below assumes the one in front
of it can fail. The gateway rate-limits, _and_ the service validates; the
service checks the booking is free, _and_ the database refuses a double
booking; the app role is trusted, _and_ it still cannot drop a table.

Status legend: ✅ in place and tested (Phase 1) · 🔜 built in the phase shown.

## 1. Identity & access

| Control                                                                                                                                                                              | Status                         | Where                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ | ----------------------------------------- |
| RS256 access tokens, 15 min; algorithm pinned on verify (blocks `alg:none` and RS256→HS256 confusion); `iss`/`aud`/`exp` checked; unknown `kid` rejected                             | ✅                             | `common/security/jwt.ts` (+ attack tests) |
| Private signing key only in auth-service; other services get public keys only                                                                                                        | ✅                             | `docker-compose.dev.yml`                  |
| Key rotation via `kid` + previous-key window                                                                                                                                         | ✅                             | `createJwtVerifierFromEnv`                |
| Boot-time check that the signing/verification keys match                                                                                                                             | ✅                             | `services/auth/src/index.ts`              |
| Role-based access (`requireRole`), token revocation hook (jti deny-list)                                                                                                             | ✅ primitives · 🔜 2.1 wiring  | `common/http/middleware.ts`               |
| Passwords: Argon2id (m=19 MiB, t=2), PHC format, rehash-on-login, length-based policy (NIST 800-63B), 128-char cap, dummy hash against user enumeration                              | ✅                             | `common/security/password.ts`             |
| Refresh tokens: 256-bit random, stored as SHA-256, rotation with family reuse detection                                                                                              | ✅ schema · 🔜 2.1             | `refresh_tokens`                          |
| Employee accounts: same answer for wrong business/username/password (dummy-hash timing); 5 wrong passwords → 15-min lock, counted atomically, password not even checked while locked | ✅ tested                      | `auth/members/password-auth.ts`           |
| Business-issued temporary passwords (~79 bits, shown once, hash only) grant **no** business access until replaced                                                                    | ✅ tested                      | `businessRoleOf()`                        |
| Password change / reset / access removed → every session of that account ends at once (refresh + access tokens)                                                                      | ✅ tested                      | `endAllSessions()`                        |
| "Sign out everywhere" cut-off kept to the millisecond (token id is a UUIDv7), so signing in right after a password change is not caught by it                                        | ✅ tested                      | `common/security/revocation.ts`           |
| Managers can't create or manage managers; nobody changes their own access                                                                                                            | ✅ tested                      | `MANAGEABLE_ROLES`                        |
| OTP: keyed hash, 10-min TTL, 3 attempts → lockout, per-destination send limits                                                                                                       | 🔜 2.1                         | —                                         |
| Object-level authorization (a user can only reach their own data)                                                                                                                    | 🔜 every Phase 2 route + tests | —                                         |

## 2. Input & output

| Control                                                                                                                                                   | Status                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Every body/query/param validated with Zod before business logic; unknown body fields rejected (mass assignment)                                           | ✅ `validated()`       |
| Query parser `simple` (no nested objects from `?a[b]=`; closes prototype-pollution class)                                                                 | ✅                     |
| Free text: HTML and control characters stripped before storage; tags hidden as entities stripped too; stored as plain text ("Salt & Pepper", not "&amp;") | ✅ `zSafeText`         |
| SQL: Prisma parameterized queries; raw SQL only via tagged templates                                                                                      | ✅ convention + review |
| Body size limits (gateway 128 KB, service 100 KB); uploads go direct to S3 via presigned URLs                                                             | ✅ tested              |
| Errors: generic 500 to clients (no stack/SQL), full detail in logs, request id in both                                                                    | ✅ tested              |
| Security headers on every response (CSP `default-src 'none'`, HSTS, nosniff, frame DENY, no-store)                                                        | ✅                     |

## 3. Data protection

| Control                                                                                                                                                                                                                                                                                                                                         | Status                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| User email/phone encrypted (AES-256-GCM, random IV, column-bound AAD, key ring with rotation) + HMAC blind index for lookup/uniqueness                                                                                                                                                                                                          | ✅                                 |
| Webhook signing secrets encrypted (must be recoverable to sign)                                                                                                                                                                                                                                                                                 | ✅ schema                          |
| Logs: redaction of auth headers, cookies, passwords, tokens, OTPs, emails, phones; query strings never logged                                                                                                                                                                                                                                   | ✅                                 |
| Least-privilege DB roles: services connect as `buku_app` (no DDL, no TRUNCATE) — proven by tests                                                                                                                                                                                                                                                | ✅                                 |
| `statement_timeout`, `lock_timeout`, idle-transaction timeout on the app role                                                                                                                                                                                                                                                                   | ✅                                 |
| Private buckets; verification documents viewed by admins only through 5-minute links, every view audited                                                                                                                                                                                                                                        | ✅ tested                          |
| Pictures are re-encoded before anyone sees them: upright, every metadata block removed (GPS, camera, names), resized, WebP; > 40 MP refused before decoding (decompression bombs); corrupt files refused                                                                                                                                        | ✅ tested (incl. production image) |
| Picture originals only ever in the private bucket (`incoming/`), deleted after cleaning, expire within a day otherwise; upload ids single-use, bound to purpose and owner                                                                                                                                                                       | ✅ tested                          |
| Customer profile pictures private: only via `/me` as 1-hour signed links; anonymous access refused; deleted on purge                                                                                                                                                                                                                            | ✅ tested                          |
| Employee photos need confirmed consent; the employee can remove theirs; removed automatically when they leave the team                                                                                                                                                                                                                          | ✅ tested                          |
| Bookings: only times the slot calculator offers can be booked; double-booking of an employee (incl. clean-up time) or a customer (anywhere) refused by the database even under races (10 parallel requests → 1 booking, tested)                                                                                                                 | ✅ tested                          |
| Per-customer booking limit can't be raced (one transaction at a time per customer and business)                                                                                                                                                                                                                                                 | ✅ tested                          |
| Receipts only for their owner (404 otherwise); QR holds only the booking code; businesses see customer names, never contact details or pictures; events carry ids only                                                                                                                                                                          | ✅ tested                          |
| Check-in only by the business that owns the code (others get 404), employees only for their own customers; a checked-in visit can't be cancelled or moved (database rule); attendance corrections audited                                                                                                                                       | ✅ tested                          |
| Queue: one live ticket per customer anywhere (database rule, raced in tests); remote joins only within the business's distance (PostGIS); ticket numbers never handed out twice (session locked per change); public queue state shows ticket numbers only                                                                                       | ✅ tested                          |
| Live queue stream: public data only (ticket numbers), no tokens in URLs, connection limits per address and replica, opening rate-limited                                                                                                                                                                                                        | ✅ tested                          |
| Billing catalog changes admin-only, every change audited with old and new values; prices immutable (new version per change); one live subscription per account and one price in force per plan/channel/currency (database rules); missing billing settings fail open to "unlimited", never to blocking customers                                | ✅ tested                          |
| Plan limits enforced inside the creating transaction behind a per-account advisory lock (parallel requests can't exceed a limit — mutation-tested); platform safety caps stay below any plan (1,000 team logins, 100 photos)                                                                                                                    | ✅ tested                          |
| Payments: card data never touches BUKU (Paddle is merchant of record); checkout bound to the account server-side (`custom_data` set by us); webhooks HMAC-verified in constant time over the raw body, 5-minute replay window, each event once, out-of-order updates ignored; API key server-only, client token is the only value given to apps | ✅ tested (fake Paddle)            |
| Notifications: events carry ids only; messages built server-side; businesses see customers' first name and initial only; deep links carry ids, no personal data; inbox strictly per user (others' ids look missing); marketing needs recorded opt-in; deleted accounts get nothing; push logs record titles only                                | ✅ tested                          |
| Monthly partitions created months ahead daily; rows landing in the catch-all partitions are reported (they would block that month)                                                                                                                                                                                                              | ✅ tested                          |
| Upload links bound to one key, content type and exact size (storage refuses anything else); on completion the real file signature is checked and mismatches deleted                                                                                                                                                                             | ✅ tested                          |
| KYB identifiers and responsible-person contacts encrypted, masked for owners; same registration under a different owner flagged to admins                                                                                                                                                                                                       | ✅ tested                          |
| Per-country business export: admin-only, needs reference + legal basis, rate-limited, audited                                                                                                                                                                                                                                                   | ✅ tested                          |
| Retention: ClickHouse TTLs (13–25 months), monthly partitions for audit/notifications, GDPR export + erasure                                                                                                                                                                                                                                    | ✅ / 🔜 2.1                        |

## 4. Infrastructure

| Control                                                                                             | Status      |
| --------------------------------------------------------------------------------------------------- | ----------- |
| No secrets in git: `.env` ignored, gitleaks pre-commit hook + CI scan of full history               | ✅          |
| Each container gets only the secrets it needs                                                       | ✅          |
| Dev: all ports bound to 127.0.0.1; services unreachable except via the gateway                      | ✅ verified |
| Containers: non-root, read-only root FS, all capabilities dropped, no-new-privileges                | ✅          |
| Production image: distroless (no shell), code read-only to the process                              | ✅          |
| Production refuses to boot with development placeholder secrets                                     | ✅ tested   |
| Valkey: password, `noeviction`, FLUSHALL/FLUSHDB/DEBUG disabled                                     | ✅          |
| Kafka: auto topic creation off; SASL/TLS in production                                              | ✅ / 🔜 5   |
| Elasticsearch/ClickHouse: security + TLS enabled in production (dev runs them on a private network) | 🔜 5        |

## 5. Supply chain

| Control                                                                                             | Status                   |
| --------------------------------------------------------------------------------------------------- | ------------------------ |
| pnpm: dependency install scripts blocked unless allow-listed (4 reviewed entries)                   | ✅                       |
| pnpm: package versions < 24 h old are refused (most malicious releases are pulled within hours)     | ✅                       |
| Exact version pins + lockfile; `pnpm audit` fails CI on high/critical                               | ✅                       |
| Security overrides for vulnerable transitive deps, each with a written justification                | ✅ `pnpm-workspace.yaml` |
| GitHub Actions pinned to commit SHAs; read-only workflow token; Dependabot for npm, actions, Docker | ✅                       |
| Dependency review on PRs (blocks high-severity and copyleft licences)                               | ✅                       |

## Reporting a vulnerability

Email security@buku.app (to be created before launch). Do not open a public issue.

## Known limitations (tracked)

- Queue distance relies on the phone's reported position, which can be faked (D-038); the
  one-ticket rule and no-show reliability are the real deterrents.
- Paddle integration is tested against a faithful fake of its API; a sandbox run with a real
  Paddle account is still to do before switching billing on.
- Employee lockout can be triggered by anyone who knows a business handle and a username (a
  15-minute nuisance, not a takeover); the business can unlock by resetting the password.
- Gateway 401 responses use Kong's `{"message"}` body instead of the BUKU envelope (documented for clients).
- Kong OSS has no releases after 3.9; plan a migration path (see DECISIONS D-011) before 2027.
- Soft-deleted users are hidden from direct queries but can still appear through relations until
  the GDPR purge anonymises them; Phase 2 routes must not expose them.
