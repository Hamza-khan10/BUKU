/**
 * Makes every service's database rights exactly what src/access.ts says (D-092): creates missing
 * roles, sets their passwords (rotation: change the password in the environment and run this
 * again), and in each database takes away everything else and grants the map — the directory
 * (registry, leases, placing, handles, reference data), the catalog, and every shard in the
 * registry, reached through its cluster's address (the setting its `dsn_secret` names, e.g.
 * BUKU_DB_CLUSTER_LOCAL_1) with the same administrator. Business-shard work across businesses goes
 * through each service's buku_svc_<name>_all role (DB-020), made here too. Idempotent; run after
 * migrations and after provisioning shards, as an admin that can create roles (the Postgres
 * superuser in development; doadmin on managed Postgres).
 *
 *   DATABASE_ADMIN_URL=postgresql://<admin>@host:5432/buku_directory \
 *   BUKU_DB_PASSWORD_AUTH=… BUKU_DB_PASSWORD_BOOKING=… … tsx scripts/apply-access.ts
 *
 * DATABASE_DIRECTORY_ADMIN_URL and DATABASE_CATALOG_ADMIN_URL name those databases when they live
 * elsewhere; by default they are buku_directory and buku_catalog on DATABASE_ADMIN_URL's server.
 */
import { SERVICES, type ServiceName } from '../src/access.js';
import { applyAccess } from '../src/apply-access.js';
import { sameServer } from '../src/data-plane.js';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('apply-access: DATABASE_ADMIN_URL is not set');
  process.exit(1);
}
const passwords: Partial<Record<ServiceName, string>> = {};
for (const s of SERVICES) {
  const value = process.env[`BUKU_DB_PASSWORD_${s.toUpperCase()}`];
  if (value && !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    console.error(`apply-access: BUKU_DB_PASSWORD_${s.toUpperCase()} must be 16-128 letters, digits, _ or -`);
    process.exit(1);
  }
  if (value) passwords[s] = value;
}

const admin = new URL(url);
await applyAccess({
  directoryUrl: process.env.DATABASE_DIRECTORY_ADMIN_URL ?? sameServer(url, 'buku_directory'),
  catalogUrl: process.env.DATABASE_CATALOG_ADMIN_URL ?? sameServer(url, 'buku_catalog'),
  shards: {
    admin: { user: decodeURIComponent(admin.username), password: decodeURIComponent(admin.password) },
  },
  passwords,
  log: (line) => console.log(`apply-access: ${line}`),
});
