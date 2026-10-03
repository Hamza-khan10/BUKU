# Incident response policy

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly, and after every
significant incident. **Rehearsal:** a tabletop exercise yearly.

## What counts

Anything that threatens the confidentiality, integrity or availability of BUKU or its data:
outages, suspected account takeover, leaked secrets, lost devices, data sent to the wrong person,
vulnerabilities reported to us, suspicious alerts.

## Severity

| Severity | Examples                                                                  | Respond within |
| -------- | ------------------------------------------------------------------------- | -------------- |
| SEV-1    | Personal data exposed or likely exposed; production down for everyone     | 1 hour         |
| SEV-2    | A feature down; an attack in progress but contained; a leaked secret      | 4 hours        |
| SEV-3    | Suspicious activity with no impact found; a low-risk vulnerability report | 2 working days |

## Steps

1. **Detect** — alerts ([alert rules](../../../infrastructure/monitoring/alerts.yml)), reports to
   `security@` (see `SECURITY.md`), customer reports.
2. **Record** — open an incident note at once: time, what is known, who is handling it. Keep
   adding as you go.
3. **Contain** — stop the harm: end sessions, rotate secrets, block addresses, roll back, take a
   feature offline ([runbooks](../runbooks.md)).
4. **Assess personal data** — what data, whose, how many people, could it harm them?
5. **Notify** — see below.
6. **Recover** — restore service and data; confirm with checks.
7. **Learn** — within 5 working days: what happened, why, what changes (tracked as issues), and
   update the risk register.

## Notification duties

- **Personal data breach:** where GDPR applies (customers in the EU/UK), notify the supervisory
  authority within **72 hours** of becoming aware, unless the breach is unlikely to risk people's
  rights; tell affected people **without undue delay** when the risk to them is high. For
  Pakistan and other countries, follow local law — confirm current obligations with counsel
  before launch in each country.
- **Businesses** using BUKU are told about incidents affecting their data or their customers.
- **Vendors:** Paddle (payments) and Meta (WhatsApp) are informed when an incident involves their
  services or keys.
- Notifications are factual: what happened, what data, what we've done, what they should do.

## Evidence

Incident notes, timelines and follow-ups are kept 3 years.
