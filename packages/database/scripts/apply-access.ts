/**
 * Makes every service's database role exactly what src/access.ts says (D-092):
 * creates missing roles, sets their passwords (rotation: change the password in
 * the environment and run this again), takes away everything else, grants the
 * map. Idempotent; run after every migration, as an admin role that can create
 * roles (the Postgres superuser in development; doadmin on managed Postgres).
 *
 *   DATABASE_ADMIN_URL=postgresql://<admin>@host:5432/buku \
 *   BUKU_DB_PASSWORD_AUTH=… BUKU_DB_PASSWORD_BOOKING=… … tsx scripts/apply-access.ts
 */
import { createDatabaseClient } from '../src/index.js';
import { SERVICES, type ServiceName } from '../src/access.js';
import { accessStatements } from '../src/access-sql.js';

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error('apply-access: DATABASE_ADMIN_URL is not set');
  process.exit(1);
}
const database = decodeURIComponent(new URL(url).pathname.slice(1));
const passwords: Partial<Record<ServiceName, string>> = {};
for (const s of SERVICES) {
  const value = process.env[`BUKU_DB_PASSWORD_${s.toUpperCase()}`];
  if (value && !/^[A-Za-z0-9_-]{16,128}$/.test(value)) {
    console.error(`apply-access: BUKU_DB_PASSWORD_${s.toUpperCase()} must be 16-128 letters, digits, _ or -`);
    process.exit(1);
  }
  if (value) passwords[s] = value;
}

const db = createDatabaseClient({ url, applicationName: 'apply-access' });
try {
  const statements = accessStatements(database, passwords);
  await db.$transaction(async (tx) => {
    for (const sql of statements) await tx.$executeRawUnsafe(sql);
  });
  console.log(
    `apply-access: ${Object.keys(passwords).length} service roles on "${database}": ${Object.keys(passwords).join(', ')}`,
  );
} finally {
  await db.$disconnect();
}
