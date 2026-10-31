import { type SERVICES, type ServiceName } from '../src/access.js';
import { crossBusinessRoleStatements, roleStatements } from '../src/access-sql.js';
import { applyStatements } from '../src/apply-access.js';
import { createDatabaseClient, type Database } from '../src/index.js';
import { testEnv } from './int-env.js';

/**
 * The services' own database roles (D-092) and their cross-business roles (DB-020), as
 * apply-access makes them; created once per run (CI starts with none), on the test cluster.
 */
let made: Promise<void> | undefined;
export const passwords = testEnv.servicePasswords as Record<ServiceName, string>;
export function ensureServiceRoles(): Promise<void> {
  // Roles belong to the whole server: made from any of its databases.
  made ??= applyStatements(testEnv.adminUrl('postgres'), [
    ...roleStatements(passwords),
    ...crossBusinessRoleStatements(passwords),
  ]);
  return made;
}

/** A connection to one database, signed in as a service's own role. */
export function asService(service: (typeof SERVICES)[number], database: string): Database {
  const url = new URL(testEnv.cluster);
  url.username = `buku_svc_${service}`;
  url.password = encodeURIComponent(passwords[service]);
  url.pathname = `/${database}`;
  return createDatabaseClient({
    url: url.toString(),
    applicationName: `${service}-int-test`,
    maxConnections: 2,
  });
}
