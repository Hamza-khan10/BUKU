# Changesets

Every PR that changes a package or service's behaviour adds a changeset:

```bash
pnpm changeset          # pick the affected packages, bump type, one-line summary
```

On release, `pnpm changeset version` bumps versions of every affected package
(including internal dependents: a change to `@buku/common` bumps the services
that use it) and writes CHANGELOG.md files. See docs/DEVELOPMENT.md → Releases.
