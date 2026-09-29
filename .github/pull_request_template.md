## What & why

<!-- One paragraph: what this PR changes and the reason. Link the issue. -->

## How it was verified

- [ ] `pnpm typecheck && pnpm lint && pnpm test` pass locally
- [ ] Integration tests (`pnpm test:int`) pass, if data/Kafka code changed
- [ ] New/changed behaviour has tests

## Checklist

- [ ] Conventional commit title, e.g. `feat(booking): add reschedule endpoint`
- [ ] `pnpm changeset` added if a package/service behaviour changed
- [ ] DB change? New migration created with `pnpm db:migrate:dev`, reviewed SQL, no drift
- [ ] New env var? Added to `.env.example` (+ `.env.production.example`) and the service's Zod schema
- [ ] Security: input validated with Zod, authz checked, no secrets/PII in logs or events
- [ ] Docs updated (docs/*.md) if behaviour or operations changed
