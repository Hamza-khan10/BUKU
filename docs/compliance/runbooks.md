# Runbooks

What to do when an alert fires (`infrastructure/monitoring/alerts.yml`), and the routine
operational procedures auditors ask about. Each incident is handled under the
[incident response policy](policies/incident-response.md): open an incident note, act, record
what happened and what changes.

## Alerts

Every alert has a Grafana dashboard to start from (D-127; `pnpm dev:monitoring` in development,
http://localhost:3300): **BUKU · Platform** (traffic, errors, latency, resources per service),
**BUKU · Security** (refusals, rate limits, security events, firing alerts), **BUKU · Gateway**
(everything that came in from outside) and **BUKU · Database** (the database's health checks).

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

### Database

`DatabaseCheckCritical` / `DatabaseCheckWarning` / `DatabaseChecksNotRunning` — a check of
`scripts/db/health.sh` (`pnpm db:health`, docs/DATABASE.md §14) is critical, has warned for 30
minutes, or the checks stopped running. Run `pnpm db:health` on the database host to see the
measured value of each check.

| Check                | What it means, and what to do                                                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archiving`          | WAL can't reach the backup repository: point-in-time recovery stops and WAL fills the disk. Check the repository (space, credentials), then `pgbackrest check`.  |
| `backup_age`         | No recent backup. Find why the scheduled backup failed; take one (`pnpm db:backup full`).                                                                        |
| `replication_slots`  | A slot nobody reads (a reference copy dropped without its slot): it keeps every WAL file. If its copy is gone, drop the slot (`pg_drop_replication_slot`).       |
| `slot_retained_wal`  | A copy is far behind. Look at that copy's server and its subscription's errors.                                                                                  |
| `reference_copies`   | A copy's subscription isn't running: its reference data goes stale. Its server's log says why; `ALTER SUBSCRIPTION … ENABLE` once fixed.                         |
| `partition_coverage` | A table has no partition for the next interval: partition upkeep has stopped. Run `partman.run_maintenance_proc()` on that shard and fix the scheduled job.      |
| `default_partitions` | Rows outside every partition (a clock or a bug). Find them with `partman.check_default()`; move them with `partman.partition_data_proc()` once partitions exist. |
| `scheduled_jobs`     | A pg_cron job failed: `SELECT * FROM cron.job_run_details WHERE status = 'failed'` in the `postgres` database.                                                   |
| `connections`        | Nearly out of connections: a pool too large, or a leak. `pg_stat_activity` by `application_name`.                                                                |
| `long_transactions`  | A transaction open for minutes holds locks and stops vacuum. Find it in `pg_stat_activity`; end it with `pg_terminate_backend` if it's stuck.                    |
| `wraparound`         | Transaction IDs are ageing: vacuum isn't keeping up. Run `VACUUM (FREEZE)` on the oldest tables; never ignore a critical one.                                    |
| `registry_alerts`    | A shard family filled with no ready shard to take over (DB-011): add a shard (`registry.add_shard`) and provision it (`pnpm db:shards`).                         |
| `break_glass`        | A person's break-glass role outlived its time (its session crashed): `DROP OWNED BY` and `DROP ROLE` it, and check the audit log for what it did.                |

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

### Break-glass database access

Nobody has standing access to data (docs/DATABASE.md DB-021). When a person must look:

1. Write down why (a ticket or incident note).
2. On the database host: `pnpm db:break-glass --reason "<ticket: why>" --db <database>`. It
   opens a session as a role made for this person and this hour only. The session is read-only;
   add `--write` only for a change agreed in the incident. Every statement goes to the audit log,
   with the reason.
3. Quit when done: the role is dropped. If the session crashed, `pnpm db:health` reports the role
   left behind (`break_glass`); drop it.
4. Record in the incident note what was looked at or changed. The access review reads the audit
   log's `human_` sessions.

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
