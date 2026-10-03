# SOC 2 readiness report

**System:** the BUKU platform (booking and queue marketplace) — 7 services behind a Kong gateway,
PostgreSQL, Valkey, Kafka, object storage, ClickHouse; the web and mobile apps (Phases 3–4) and
production hosting (Phase 5) are planned. **Reviewed:** 2026-10-04 against the 2017 Trust
Services Criteria (revised points of focus 2022): Security (common criteria CC1–CC9),
Availability (A1), Processing Integrity (PI1), Confidentiality (C1), Privacy (P1–P8).
**Reviewer:** engineering (BUILD_GUIDE 2.10). This is a readiness review, not an audit opinion —
only an independent CPA firm can issue a SOC 2 report.

## Verdict

| Area                                 | Readiness  | In short                                                                                                             |
| ------------------------------------ | ---------- | -------------------------------------------------------------------------------------------------------------------- |
| Application security controls        | 🟢 Strong  | Access control, encryption, audit log, MFA for admins, tested on every run                                           |
| Change management                    | 🟢 Strong  | Protected branch, 12 required checks incl. image scans (CodeQL to become the 13th); compensating controls while solo |
| Vulnerability management             | 🟢 Strong  | Pinned deps, audit, image scanning, CodeQL, Dependabot                                                               |
| Monitoring and incident response     | 🟡 Partial | Alert rules, runbooks and policy written; Prometheus/paging/log shipping arrive with production (Phase 5)            |
| Availability (backups, DR)           | 🟡 Partial | Objectives and drill defined; backups and restores exist only once production exists (Phase 5)                       |
| Confidentiality and privacy          | 🟢 Good    | Classification, retention in code, data rights built; privacy notice needs legal review                              |
| Governance (policies, risk, vendors) | 🟡 Written | Policies, risk register, sub-processors list now exist; they need operating evidence over time                       |

**Recommendation:** finish Phase 5 (production with monitoring, backups, restore drill), operate
for ~3 months collecting evidence, run an external penetration test, then a **Type I** audit;
start the **Type II** observation window (6 months recommended for a first report) right after.
Scope: Security + Availability + Confidentiality first; add Privacy and Processing Integrity
when customers ask for them.

## Fixed during this review

| Gap found                                                                       | Fix                                                                        | Where     |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------- |
| No multi-factor authentication anywhere; admins see every business's data       | Two-step sign-in (TOTP), required for platform admins on every admin route | #30 D-081 |
| App database role could rewrite or delete audit entries                         | Audit log append-only (privileges on every partition + trigger), tested    | #29 D-080 |
| No retention schedule; logs and tokens grew forever                             | Retention in code, fixed in the database, applied daily, audited           | #29 D-080 |
| No controlled way to grant admin; no access-review evidence                     | `pnpm admin:role` (reason, audit, sessions ended); access review endpoint  | #29 D-080 |
| Container images never scanned; base images unpinned (stale vulnerable base)    | Trivy scan blocks merging, SBOM per image, digest-pinned bases, Dependabot | #31 D-082 |
| No static analysis                                                              | CodeQL security-extended on every PR                                       | #31 D-082 |
| No security alerting signals                                                    | `security_events_total` + 12 Prometheus alert rules with runbooks          | #31 D-082 |
| Billing routes told outsiders whether payments were set up before checking them | Permission first                                                           | #28 D-079 |
| Every route's protection was tested by sampling                                 | Acceptance scans all routes (gateway and each service directly)            | #28 D-079 |
| No written policies, risk register, vendor list                                 | Policy set, risk register, sub-processors, privacy notice draft, runbooks  | this PR   |

## Control matrix

Status: ✅ in place and tested · 🟡 partly / needs operating evidence · 🔜 planned (phase) · 📝 written procedure.
Evidence paths are relative to the repository root.

### CC1 Control environment · CC2 Communication · CC3 Risk · CC4 Monitoring of controls · CC5 Control activities

| Criterion | Control                                                                                             | Evidence                                                                                         | Status  |
| --------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------- |
| CC1.1–1.5 | Information security policy, roles, acceptable use, acknowledgement                                 | `docs/compliance/policies/information-security.md`, `acceptable-use.md`                          | 📝      |
| CC1.4     | Hiring: background checks, security training at joining and yearly                                  | to add when the first hire happens (policy section)                                              | 🔜      |
| CC2.1–2.3 | System description, architecture and decisions documented                                           | `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, this report                                         | ✅      |
| CC2.3     | External: vulnerability reporting address, privacy notice, sub-processors                           | `docs/SECURITY.md` (security@ mailbox to create), `privacy-notice-draft.md`, `sub-processors.md` | 🟡      |
| CC3.1–3.4 | Risk assessment twice a year, incl. fraud and change risks                                          | `docs/compliance/risk-register.md`                                                               | 📝      |
| CC4.1–4.2 | Controls checked continuously: CI, `pnpm verify`, `pnpm acceptance`, access reviews, restore drills | `.github/workflows/`, `scripts/verify.sh`, `scripts/acceptance/`, runbooks                       | ✅ / 🟡 |
| CC5.1–5.3 | Policies turned into controls in code where possible (deny-by-default, schedules in DB)             | D-079–D-082                                                                                      | ✅      |

### CC6 Logical and physical access

| Criterion | Control                                                                                                                                                                              | Evidence                                                                                                | Status                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | -------------------------- |
| CC6.1     | Identity via Google/Apple (no customer passwords); employees: Argon2id passwords, lockout; RS256 JWT, 15-min access tokens, rotating refresh tokens with theft detection, revocation | `services/auth`, tests `services/auth/test/auth.int.test.ts`                                            | ✅                         |
| CC6.1     | **Two-step sign-in required for platform admins**; optional for everyone                                                                                                             | D-081, `services/auth/src/mfa/`, tests "Two-step sign-in"                                               | ✅                         |
| CC6.1     | Least privilege: role-based permissions per business (`authz.ts`), database roles (app cannot change schema or audit log)                                                            | `packages/common/src/authz.ts`, `docker/postgres/init/`, `packages/database/test/retention.int.test.ts` | ✅                         |
| CC6.2     | Granting and removing platform admin only through an audited tool with a reason                                                                                                      | `services/auth/scripts/set-role.ts` (`pnpm admin:role`)                                                 | ✅                         |
| CC6.2–6.3 | Quarterly access review incl. dormant-account flag, audited                                                                                                                          | `GET /v1/admin/access-review`, runbook "Access review"                                                  | ✅ / 🟡 evidence over time |
| CC6.3     | Business teams: owners/managers manage members; removal ends sessions and removes staff photos                                                                                       | `services/auth/src/members/`                                                                            | ✅                         |
| CC6.4     | Physical security of data centres                                                                                                                                                    | DigitalOcean SOC 2 report (carved-out/inherited control)                                                | 🔜 collect                 |
| CC6.6     | Boundary: one gateway, deny-by-default routes, rate limits, CORS, security headers; every route checked                                                                              | `infrastructure/kong/`, `scripts/acceptance/run.ts`                                                     | ✅                         |
| CC6.6     | WAF / DDoS protection in front of the gateway                                                                                                                                        | Cloudflare (Phase 5)                                                                                    | 🔜                         |
| CC6.7     | Encryption in transit (TLS required in production configs: DB `sslmode=require`, `rediss`, Kafka SSL, SMTP TLS enforced)                                                             | `.env.production.example`, config validation                                                            | ✅ config · 🔜 certs       |
| CC6.7     | Encryption at rest (managed services) + field encryption of contact details, private buckets, signed short links                                                                     | D-016, `packages/common/src/security/encryption.ts`                                                     | ✅                         |
| CC6.8     | Malicious or unauthorised software: pinned deps with release delay, audit, image scan, CodeQL, secret scanning                                                                       | `.github/workflows/ci.yml`, `codeql.yml`, `.gitleaks.toml`                                              | ✅                         |

### CC7 System operations

| Criterion | Control                                                                                                                   | Evidence                                                                      | Status                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- |
| CC7.1     | Vulnerability management: Dependabot (npm, Docker, Actions), audit, Trivy, CodeQL; external pen test yearly               | `.github/dependabot.yml`, CI                                                  | ✅ · 🔜 pen test                          |
| CC7.2     | Monitoring: per-route metrics, security event counters, 12 alert rules                                                    | `packages/common/src/http/metrics.ts`, `infrastructure/monitoring/alerts.yml` | ✅ rules · 🔜 Prometheus/paging (Phase 5) |
| CC7.2     | Audit log of security actions, append-only, 24 months                                                                     | D-080, `packages/database/test/retention.int.test.ts`                         | ✅                                        |
| CC7.2     | Centralised logs with retention (1 year), structured, personal data redacted                                              | redaction ✅ (`packages/common/src/logger.ts`); shipping 🔜 Phase 5           | 🟡                                        |
| CC7.3–7.5 | Incident response: severity, steps, notification duties (GDPR 72 h), lessons learned; runbooks per alert; yearly tabletop | `policies/incident-response.md`, `runbooks.md`                                | 📝                                        |

### CC8 Change management

| Criterion | Control                                                                                                                                                                                               | Evidence                                                            | Status        |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------- |
| CC8.1     | PRs into protected `main`: required checks (lint, types, tests, audit, secrets, integration + drift, image build + scan, dependency review, CodeQL), linear history, no force pushes, admins included | `scripts/github/protect-main.sh`, GitHub settings, PR history       | ✅            |
| CC8.1     | Second-person review                                                                                                                                                                                  | Compensating controls while solo; required from the second engineer | 🟡 documented |
| CC8.1     | Migrations tested on a throwaway database; drift check in CI                                                                                                                                          | `docs/DEVELOPMENT.md`, CI job                                       | ✅            |
| CC8.1     | Emergency change procedure; deployment records                                                                                                                                                        | `policies/change-management.md`; deploy pipeline (Phase 5)          | 📝 · 🔜       |

### CC9 Risk mitigation

| Criterion | Control                                                          | Evidence                                             | Status               |
| --------- | ---------------------------------------------------------------- | ---------------------------------------------------- | -------------------- |
| CC9.1     | Business disruption: continuity plan with RPO/RTO                | `policies/business-continuity.md`                    | 📝                   |
| CC9.2     | Vendors: review before use and yearly, DPAs, sub-processors list | `policies/vendor-management.md`, `sub-processors.md` | 📝 · collect reports |

### A1 Availability

| Criterion | Control                                                                                          | Evidence                                                  | Status     |
| --------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ---------- |
| A1.1      | Capacity: resource limits per service, health/readiness, autoscaling                             | `docker-compose.dev.yml` limits; Kubernetes HPA (Phase 5) | 🟡 · 🔜    |
| A1.2      | Backups: managed PostgreSQL PITR 7 days + standby; object storage versioning + cross-region copy | business continuity policy                                | 🔜 Phase 5 |
| A1.3      | Restore tested quarterly; recovery objectives RPO 15 min / RTO 4 h                               | runbook "Restore drill"                                   | 📝 · 🔜    |
| A1.2      | Status page for customers and businesses                                                         | Phase 5                                                   | 🔜         |

### PI1 Processing integrity

| Criterion | Control                                                                                                                      | Evidence                              | Status |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------ |
| PI1.1–1.3 | Inputs validated strictly (Zod, mass-assignment protection), sanitised text                                                  | `packages/common/src/validation.ts`   | ✅     |
| PI1.3     | Correct processing under concurrency: exclusion constraints, advisory locks, one-ticket rules — races tested through the API | constraints tests, acceptance "Races" | ✅     |
| PI1.4     | Outputs complete and once: transactional outbox, idempotent consumers, scheduled messages exactly once                       | `packages/kafka`, D-073               | ✅     |
| PI1.5     | Payments: signed webhooks, out-of-order protection, prices immutable once used                                               | `services/billing`, tests             | ✅     |

### C1 Confidentiality

| Criterion | Control                                                                                  | Evidence                                        | Status              |
| --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------- |
| C1.1      | Data classified; Restricted data encrypted at field level, never logged, ids-only events | `policies/data-classification-and-retention.md` | ✅                  |
| C1.2      | Disposal on schedule (automatic, audited) and on account deletion                        | D-080, data-rights tests                        | ✅                  |
| C1.2      | KYB documents deleted 1 year after a business closes                                     | written in the policy; job not yet built        | 🟡 build in Phase 5 |

### P Privacy

| Criterion | Control                                                                                                            | Evidence                                             | Status |
| --------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | ------ |
| P1        | Privacy notice                                                                                                     | `privacy-notice-draft.md` (legal review per country) | 🟡     |
| P2        | Consent with timestamps: terms, marketing, suggestions, WhatsApp; withdrawal anytime (settings, STOP, unsubscribe) | auth + notification services                         | ✅     |
| P3        | Collect only what's needed (no customer passwords; location not stored; analytics without user or coordinates)     | D-076, D-077                                         | ✅     |
| P4        | Use and retention limited; schedule in code                                                                        | D-080                                                | ✅     |
| P5        | Access: export everything (`/v1/auth/me/export`), correct profile                                                  | `services/auth/src/users/data-rights.ts`             | ✅     |
| P6        | Disclosure: businesses see names and labels only; sub-processors listed                                            | views, `sub-processors.md`                           | ✅     |
| P7        | Quality: people edit their own data                                                                                | profile endpoints                                    | ✅     |
| P8        | Complaints and inquiries channel                                                                                   | privacy@ mailbox (to create)                         | 🔜     |

## Remaining work before an audit

| #   | Item                                                                                                    | When                | Owner   |
| --- | ------------------------------------------------------------------------------------------------------- | ------------------- | ------- |
| 1   | Production on DigitalOcean with TLS certificates, WAF/DDoS (Cloudflare), secret store                   | Phase 5             | Founder |
| 2   | Prometheus + Alertmanager with paging, log shipping with 1-year retention, uptime checks, status page   | Phase 5             | Founder |
| 3   | Backups (PITR, standby, storage versioning + copy); first restore drill and its record                  | Phase 5             | Founder |
| 4   | Create `security@` and `privacy@` mailboxes; publish SECURITY.md contact and the privacy notice         | Before launch       | Founder |
| 5   | Legal review of privacy notice and terms for each launch country (incl. Pakistan's data protection law) | Before launch       | Counsel |
| 6   | Collect vendor reports/DPAs for every sub-processor; record the review                                  | Before Type I       | Founder |
| 7   | External penetration test; fix findings                                                                 | Before Type I       | Vendor  |
| 8   | KYB document deletion job (1 year after closing)                                                        | Phase 5             | Founder |
| 9   | Make CodeQL a required check once it has run on `main`                                                  | Next PR after #31   | Founder |
| 10  | Break-glass access for a trusted second person (R2)                                                     | Before launch       | Founder |
| 11  | Hardware security keys for the founder's Google and GitHub accounts                                     | Now                 | Founder |
| 12  | Start the evidence folder (below) and the quarterly rhythm                                              | From production day | Founder |
| 13  | Compliance automation tool (optional: Vanta, Drata, Secureframe) to collect evidence continuously       | Before Type II      | Founder |

## Evidence to keep (the auditor will sample it)

| Rhythm       | Evidence                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| Continuous   | Merged PRs with checks (GitHub), CI logs and SBOMs, audit log, alert history, incident notes |
| Monthly      | Dependabot/CodeQL/Trivy findings and how they were resolved                                  |
| Quarterly    | Access review record (endpoint output + vendor consoles), restore drill record               |
| Twice a year | Risk register review                                                                         |
| Yearly       | Policy review and acknowledgements, vendor review, tabletop exercise, penetration test       |

Keep them in a dated, access-controlled evidence folder (or the compliance tool), never in the
public repository.
