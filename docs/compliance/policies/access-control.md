# Access control policy

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly.

## Principles

- **Least privilege, by role.** Access is granted for a job, not a person, and only as much as
  that job needs.
- **Separate accounts** for each person; no shared logins (service accounts are owned by a person
  and documented).
- **Two-step sign-in** on every account that reaches production or personal data.

## BUKU's own access layers

| Layer                          | How access is controlled                                                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform admin (`super_admin`) | Granted/removed only with `pnpm admin:role` (reason + operator, audited, sessions ended); two-step sign-in required by the system (D-080, D-081)              |
| Businesses' teams              | Each business manages its own team (owner, manager, front desk, staff) with fixed permissions (`@buku/common` authz); BUKU staff don't join businesses' teams |
| Database                       | Services use `buku_app` (data only, no schema changes, audit log append-only); migrations use `buku_migrator`; the superuser is for the provider only         |
| Cloud, GitHub, vendors         | Named accounts with two-step sign-in; admin rights only for the founder until a second person needs them                                                      |
| Secrets                        | Production secrets only in the cloud secret store; read by the deploy pipeline; never on laptops except for break-glass                                       |

## Lifecycle

- **Grant:** a written request (who, what, why) — for one person, the reason in `pnpm admin:role`
  or a note in the evidence folder is the record.
- **Review quarterly:** the [access review runbook](../runbooks.md#access-review): app admins from
  `GET /v1/admin/access-review`, plus every cloud/vendor console. Dormant (90 days) access is
  removed.
- **Remove on leaving:** the same day ([joiner/leaver](../runbooks.md#joiner--leaver)).

## Customer and business sign-in

Customers sign in with Google or Apple (no BUKU passwords to steal); employees of businesses use
username + password with lockout after 5 tries; anyone may turn on two-step sign-in. Sessions:
short access tokens (15 minutes), rotating refresh tokens with theft detection, sign-out
everywhere, shorter idle timeout for admins.
