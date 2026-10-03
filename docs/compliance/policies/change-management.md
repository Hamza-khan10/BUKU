# Change management policy

**Owner:** founder · **Version:** 1.0 (2026-10-04) · **Review:** yearly.

## Normal changes

Every change to code, database schema, infrastructure configuration or CI goes through a pull
request into `main`, which is protected:

- **Required checks** (all must pass): lint, types, unit tests, dependency audit, secret scan,
  integration tests with migration-drift check, production image build and vulnerability scan
  per service, dependency review, CodeQL. Force pushes and branch deletion are blocked; history
  is linear; admins are not exempt.
- **Description:** what changed, why, how it was verified (template in `.github/`).
- **Database migrations** are tested on a throwaway database before they run anywhere, are
  additive where possible, and never rewrite history.
- **Records:** the merged PR, its checks and the deploy log are the change record.

## Working alone

Until there is a second engineer, a required human approval would block every change. The
compensating controls are: the automated checks above (they encode the review checklist —
tests, security scans, formatting, migration safety), a self-review against the PR template
before merging, and the acceptance run (`pnpm acceptance`) for changes touching access or
journeys. When a second engineer joins, one approval becomes required
(`APPROVALS=1 scripts/github/protect-main.sh`).

## Emergency changes

When production is down or under attack and the normal path is too slow: make the smallest
change that stops the harm, still through a PR (checks may run in parallel with the deploy),
then within 2 working days write an incident note explaining why the emergency path was used
and confirm the checks passed afterwards.

## Deployments

Only CI builds deployable images (scanned, with an SBOM); deploys roll out gradually and can be
rolled back to the previous image (Phase 5). Configuration changes in vendor consoles (DNS,
Paddle, Meta) are recorded in the change log of the evidence folder.
