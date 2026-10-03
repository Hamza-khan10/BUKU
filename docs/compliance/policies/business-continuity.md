# Business continuity and disaster recovery

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly. **Tested:** restore drill
quarterly ([runbook](../runbooks.md#restore-drill-quarterly)).

## Objectives

| What                                        | Recovery point (data loss at most)  | Recovery time |
| ------------------------------------------- | ----------------------------------- | ------------- |
| Bookings, accounts, businesses (PostgreSQL) | 15 minutes                          | 4 hours       |
| Pictures and documents (object storage)     | 24 hours                            | 8 hours       |
| Queues, caches, sessions in Valkey          | none needed (rebuilt from Postgres) | 1 hour        |
| Event stream (Kafka)                        | none needed (outbox re-sends)       | 4 hours       |
| Analytics (ClickHouse)                      | 24 hours (can be rebuilt)           | 3 days        |

## How

- **PostgreSQL (DigitalOcean managed):** daily backups plus point-in-time recovery (7 days), a
  standby node in production; backups encrypted by the provider.
- **Object storage (Spaces):** versioning on for documents; a nightly copy to a second region.
- **Code and configuration:** GitHub (and every developer's clone); infrastructure as code; the
  secret store backed up by the provider — secrets can also be re-issued.
- **Kafka:** replication factor 3, min in-sync 2; the transactional outbox means a lost message is
  sent again from Postgres.
- **Rebuild from scratch:** the platform can be recreated in a new region from code + the latest
  database backup + object storage copy; this is rehearsed yearly.

## When something big happens

1. Declare it (incident response, SEV-1), decide: wait for the provider or fail over/restore?
2. Restore into a fresh environment, point DNS at it, verify with the acceptance suite.
3. Tell businesses and customers what happened and when service returns (status page).

Phase 5 sets these up in production; the quarterly drill records the actual times achieved.
