# Runbooks

What to do when an alert fires (`infrastructure/monitoring/alerts.yml`), and the routine
operational procedures auditors ask about. Each incident is handled under the
[incident response policy](policies/incident-response.md): open an incident note, act, record
what happened and what changes.

## Alerts

### Service down

`ServiceDown` — a service stopped answering metrics scrapes for 2 minutes.

1. Check the service's pods/containers and their last logs (crash loop? out of memory?
   failing readiness because Postgres/Kafka/Valkey is down?).
2. If a dependency is down, follow its provider's status page; services recover by themselves
   once it's back (readiness gates traffic).
3. If a deploy caused it, roll back to the previous image (change management policy: emergency
   change), then investigate.

### Errors

`HighErrorRate` / `VeryHighErrorRate` — more than 2% / 10% of a service's requests answer 5xx.

1. Logs of that service, filtered by `level=error`: the request ids show which routes fail.
2. Recent deploy? Roll back first, investigate after.
3. A dependency (database, payment provider, WhatsApp, email)? Errors from outside providers are
   logged with their status code only.

### Slow

`SlowResponses` / `EventLoopBlocked` — p95 above 1 s, or the event loop lagging.

1. Database: slow queries (`pg_stat_statements`), locks, connection pool exhaustion.
2. CPU: event-loop lag means synchronous work (large JSON, image processing) — find it in a
   profile; scale out if it's load.

### Suspicious sign-in

`RefreshTokenReuse`, `TwoStepCodeGuessing`, `EmployeeLockouts`, `AdminWithoutTwoStep`,
`AuthenticationFailureSpike`, `AccessDeniedSpike`.

1. The audit log has every event with user, IP and time:
   `auth.refresh_token_reuse_detected`, `auth.mfa_failed`, `auth.password_failed`, `auth.account_locked`.
2. Token reuse: the session was already ended automatically. If it repeats for one person,
   contact them (stolen device?) and end all their sessions (`logout-all` on their behalf via
   support).
3. Guessing / stuffing from a few addresses: block them at the gateway (Kong IP restriction)
   and raise the rate limit severity; many addresses: tighten sign-in rate limits.
4. Admin without two-step: someone with admin role is using a session that didn't pass it —
   confirm it was them; if not, treat as a compromised account (below).

### Webhooks

`ForgedWebhooks` — Paddle or WhatsApp webhooks with bad signatures.

1. After rotating a secret: the provider still signs with the old one — update the secret.
2. Otherwise someone is forging calls: nothing was accepted (signatures are checked before any
   change); note the source addresses, consider blocking.

## Procedures

### Compromised account

1. End all sessions: an admin runs `pnpm admin:role` to remove elevated roles (ends sessions at
   once); for any account, support can revoke sessions.
2. Read the account's audit trail (`GET /v1/auth/me/export` as the person, or the audit log).
3. Personal data exposed? → breach assessment under the incident response policy.

### Restore drill (quarterly)

Proves backups work and measures the real recovery time (target: RTO 4 h, RPO 15 min — see the
[business continuity policy](policies/business-continuity.md)).

1. Restore the production database's point-in-time backup to a new, separate cluster at a time
   ~1 hour ago.
2. Run `prisma migrate status` against it (schema intact) and count rows in key tables
   (`users`, `businesses`, `appointments`) against production at that time.
3. Run the acceptance suite against a copy of the stack pointed at it (`pnpm acceptance`).
4. Record: date, backup time restored, time taken, problems, who did it. Delete the restored
   cluster.

### Access review (quarterly)

1. `GET /v1/admin/access-review` (needs admin with two-step sign-in): every platform admin, last
   activity, two-step status. Remove anyone dormant or no longer needing it with
   `pnpm admin:role --role user --reason "Q<n> access review: …"`.
2. Outside the app: GitHub organisation members and their roles, DigitalOcean team, domain
   registrar, Paddle, Google Cloud (OAuth), Meta (WhatsApp), Expo, email provider. Remove what
   isn't needed; confirm 2-step sign-in is on for each.
3. Record the review (date, who, what was removed) in the compliance evidence folder.

### Joiner / leaver

- **Joiner:** least access for the role, granted per the access control policy; two-step sign-in
  set up before any admin access; acceptable-use and security policies acknowledged.
- **Leaver (same day):** remove the BUKU admin role (`pnpm admin:role`), GitHub, cloud and every
  vendor console; rotate any shared secret they could have seen; record it.

### Secret rotation

- **JWT signing key:** add the new key as `JWT_PRIVATE_KEY` with a new `JWT_KEY_ID`, keep the old
  public key as `JWT_PREVIOUS_PUBLIC_KEY` for one access-token lifetime (15 minutes), then remove.
- **PII encryption key:** add a new key to `PII_ENCRYPTION_KEYS` and make it active; old values
  stay readable; re-encrypt in the background (`needsReEncryption`).
- **Webhook secrets (Paddle, WhatsApp), provider tokens:** rotate in the provider, then the
  secret store; watch `ForgedWebhooks` for leftovers.
