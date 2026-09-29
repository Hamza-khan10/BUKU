# Security

Security in BUKU is **layered**: every control below assumes the one in front
of it can fail. The gateway rate-limits, _and_ the service validates; the
service checks the booking is free, _and_ the database refuses a double
booking; the app role is trusted, _and_ it still cannot drop a table.

Status legend: ✅ in place and tested (Phase 1) · 🔜 built in the phase shown.

## 1. Identity & access

| Control                                                                                                                                                  | Status                         | Where                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ----------------------------------------- |
| RS256 access tokens, 15 min; algorithm pinned on verify (blocks `alg:none` and RS256→HS256 confusion); `iss`/`aud`/`exp` checked; unknown `kid` rejected | ✅                             | `common/security/jwt.ts` (+ attack tests) |
| Private signing key only in auth-service; other services get public keys only                                                                            | ✅                             | `docker-compose.dev.yml`                  |
| Key rotation via `kid` + previous-key window                                                                                                             | ✅                             | `createJwtVerifierFromEnv`                |
| Boot-time check that the signing/verification keys match                                                                                                 | ✅                             | `services/auth/src/index.ts`              |
| Role-based access (`requireRole`), token revocation hook (jti deny-list)                                                                                 | ✅ primitives · 🔜 2.1 wiring  | `common/http/middleware.ts`               |
| Passwords: Argon2id (m=19 MiB, t=2), PHC format, rehash-on-login, length-based policy (NIST 800-63B), 128-char cap, dummy hash against user enumeration  | ✅                             | `common/security/password.ts`             |
| Refresh tokens: 256-bit random, stored as SHA-256, rotation with family reuse detection                                                                  | ✅ schema · 🔜 2.1             | `refresh_tokens`                          |
| OTP: keyed hash, 10-min TTL, 3 attempts → lockout, per-destination send limits                                                                           | 🔜 2.1                         | —                                         |
| Object-level authorization (a user can only reach their own data)                                                                                        | 🔜 every Phase 2 route + tests | —                                         |

## 2. Input & output

| Control                                                                                                         | Status                 |
| --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Every body/query/param validated with Zod before business logic; unknown body fields rejected (mass assignment) | ✅ `validated()`       |
| Query parser `simple` (no nested objects from `?a[b]=`; closes prototype-pollution class)                       | ✅                     |
| Free text: HTML and control characters stripped before storage                                                  | ✅ `zSafeText`         |
| SQL: Prisma parameterized queries; raw SQL only via tagged templates                                            | ✅ convention + review |
| Body size limits (gateway 128 KB, service 100 KB); uploads go direct to S3 via presigned URLs                   | ✅ / 🔜 2.2            |
| Errors: generic 500 to clients (no stack/SQL), full detail in logs, request id in both                          | ✅ tested              |
| Security headers on every response (CSP `default-src 'none'`, HSTS, nosniff, frame DENY, no-store)              | ✅                     |

## 3. Data protection

| Control                                                                                                                                | Status              |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| User email/phone encrypted (AES-256-GCM, random IV, column-bound AAD, key ring with rotation) + HMAC blind index for lookup/uniqueness | ✅                  |
| Webhook signing secrets encrypted (must be recoverable to sign)                                                                        | ✅ schema           |
| Logs: redaction of auth headers, cookies, passwords, tokens, OTPs, emails, phones; query strings never logged                          | ✅                  |
| Least-privilege DB roles: services connect as `buku_app` (no DDL, no TRUNCATE) — proven by tests                                       | ✅                  |
| `statement_timeout`, `lock_timeout`, idle-transaction timeout on the app role                                                          | ✅                  |
| Private buckets; documents only via short-lived presigned URLs                                                                         | ✅ buckets · 🔜 2.2 |
| Retention: ClickHouse TTLs (13–25 months), monthly partitions for audit/notifications, GDPR export + erasure                           | ✅ / 🔜 2.1         |

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

- Kong gateway JWT validation is added in Phase 2.1 (services already verify every token).
- Kong OSS has no releases after 3.9; plan a migration path (see DECISIONS D-011) before 2027.
- Soft-deleted users are hidden from direct queries but can still appear through relations until
  the GDPR purge anonymises them; Phase 2 routes must not expose them.
