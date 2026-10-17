import {
  ACCESS,
  allBusinessesRoleOf,
  CROSS_BUSINESS,
  DIRECTORY_ACCESS,
  DIRECTORY_REFERENCE_ACCESS,
  REFERENCE_TABLES,
  roleOf,
  SERVICES,
  type Access,
  type ServiceName,
} from './access.js';

/** A SQL identifier, quoted. Every name here comes from code, but quoting keeps it exact. */
const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** A SQL string literal (standard_conforming_strings is on: only quotes need doubling). */
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
const cols = (list: readonly string[]) => `(${list.map(ident).join(', ')})`;

/**
 * The statements that make each service's role exactly what ACCESS says, from
 * any starting point (idempotent): the role exists with its current password,
 * everything it had is taken away, then the map is granted. Run as an admin.
 */
export function accessStatements(
  database: string,
  passwords: Partial<Record<ServiceName, string>>,
): string[] {
  const out: string[] = [];
  for (const service of SERVICES) {
    const password = passwords[service];
    if (!password) continue; // a service without a password set doesn't get a role
    const role = roleOf(service);
    const r = ident(role);
    const a = ACCESS[service];
    out.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(role)}) THEN CREATE ROLE ${r} LOGIN; END IF; END $$`,
      `ALTER ROLE ${r} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 40 PASSWORD ${literal(password)}`,
      `ALTER ROLE ${r} SET search_path = public, extensions`,
      `ALTER ROLE ${r} SET statement_timeout = '15s'`,
      `ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '30s'`,
      `ALTER ROLE ${r} SET lock_timeout = '5s'`,
      `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(database)} TO ${r}`,
      `GRANT USAGE ON SCHEMA public TO ${r}`,
      // Start from nothing: table, column, function and partition rights.
      `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`,
      `DO $$ DECLARE c record; BEGIN
         FOR c IN SELECT table_schema, table_name, column_name, privilege_type
                  FROM information_schema.column_privileges WHERE grantee = ${literal(role)} LOOP
           EXECUTE format('REVOKE %s (%I) ON %I.%I FROM ${r}', c.privilege_type, c.column_name, c.table_schema, c.table_name);
         END LOOP;
       END $$`,
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM ${r}`,
      `DO $$ BEGIN IF EXISTS (SELECT FROM pg_namespace WHERE nspname = 'partitions') THEN
         EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA partitions FROM ${role}';
         EXECUTE 'REVOKE USAGE ON SCHEMA partitions FROM ${role}';
       END IF; END $$`,
    );
    for (const t of a.owns) out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${ident(t)} TO ${r}`);
    for (const [t, which] of Object.entries(a.reads ?? {})) {
      out.push(
        which === '*'
          ? `GRANT SELECT ON ${ident(t)} TO ${r}`
          : `GRANT SELECT ${cols(which)} ON ${ident(t)} TO ${r}`,
      );
    }
    for (const t of a.inserts ?? []) out.push(`GRANT INSERT ON ${ident(t)} TO ${r}`);
    for (const [t, which] of Object.entries(a.updates ?? {})) {
      out.push(
        which === '*'
          ? `GRANT UPDATE ON ${ident(t)} TO ${r}`
          : `GRANT UPDATE ${cols(which)} ON ${ident(t)} TO ${r}`,
      );
    }
    for (const t of a.deletes ?? []) out.push(`GRANT DELETE ON ${ident(t)} TO ${r}`);
    for (const f of a.executes ?? []) out.push(`GRANT EXECUTE ON FUNCTION ${f} TO ${r}`);
    if (a.partitions?.length) {
      out.push(`GRANT USAGE ON SCHEMA partitions TO ${r}`);
      for (const t of a.partitions) out.push(`GRANT SELECT ON partitions.${ident(t)} TO ${r}`);
    }
  }
  return out;
}

/** "registry.shards" → "registry"."shards"; a function keeps its argument types as written. */
const qualified = (name: string) => {
  const [schema, rest] = name.split('.') as [string, string];
  const open = rest.indexOf('(');
  return open === -1
    ? `${ident(schema)}.${ident(rest)}`
    : `${ident(schema)}.${ident(rest.slice(0, open))}${rest.slice(open)}`;
};

/**
 * The same roles' rights in the directory database (DIRECTORY_ACCESS), from any starting point.
 * Run as an admin, connected to the directory, after accessStatements has made the roles.
 */
export function directoryAccessStatements(
  database: string,
  passwords: Partial<Record<ServiceName, string>>,
): string[] {
  const out: string[] = [];
  for (const service of SERVICES) {
    if (!passwords[service]) continue;
    const r = ident(roleOf(service));
    out.push(
      `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(database)} TO ${r}`,
      `REVOKE ALL ON ALL TABLES IN SCHEMA "registry", "ids", "lookup", "reference" FROM ${r}`,
      `REVOKE ALL ON ALL SEQUENCES IN SCHEMA "registry", "ids", "lookup", "reference" FROM ${r}`,
      `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "registry", "ids", "lookup" FROM ${r}`,
      `REVOKE ALL ON SCHEMA "ids" FROM ${r}`,
      `GRANT USAGE ON SCHEMA ${[...DIRECTORY_ACCESS.schemas, 'reference'].map(ident).join(', ')} TO ${r}`,
      `GRANT SELECT ON ${DIRECTORY_ACCESS.reads.map(qualified).join(', ')} TO ${r}`,
      `GRANT EXECUTE ON FUNCTION ${DIRECTORY_ACCESS.executes.map(qualified).join(', ')} TO ${r}`,
      // Everyone reads the reference data; a few edit some of it (DIRECTORY_REFERENCE_ACCESS).
      `GRANT SELECT ON ${REFERENCE_TABLES.map(qualified).join(', ')} TO ${r}`,
      ...grants(DIRECTORY_REFERENCE_ACCESS[service] ?? { owns: [] }, r),
    );
  }
  return out;
}

/** A table name as SQL: "users" → "users", "reference.plans" → "reference"."plans". */
const table = (name: string) => (name.includes('.') ? qualified(name) : ident(name));
/** The schema a table name is in. */
const schemaOf = (name: string) => (name.includes('.') ? name.split('.')[0]! : 'public');

/** The GRANTs one Access entry means, for one role (tables may be schema-qualified). */
function grants(a: Access, r: string): string[] {
  const out: string[] = [];
  for (const t of a.owns) out.push(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${table(t)} TO ${r}`);
  for (const [t, which] of Object.entries(a.reads ?? {})) {
    out.push(
      which === '*'
        ? `GRANT SELECT ON ${table(t)} TO ${r}`
        : `GRANT SELECT ${cols(which)} ON ${table(t)} TO ${r}`,
    );
  }
  for (const t of a.inserts ?? []) out.push(`GRANT INSERT ON ${table(t)} TO ${r}`);
  for (const [t, which] of Object.entries(a.updates ?? {})) {
    out.push(
      which === '*'
        ? `GRANT UPDATE ON ${table(t)} TO ${r}`
        : `GRANT UPDATE ${cols(which)} ON ${table(t)} TO ${r}`,
    );
  }
  for (const t of a.deletes ?? []) out.push(`GRANT DELETE ON ${table(t)} TO ${r}`);
  for (const f of a.executes ?? []) out.push(`GRANT EXECUTE ON FUNCTION ${f} TO ${r}`);
  return out;
}

/** Every table an Access entry names. */
const tablesOf = (a: Access) => [
  ...a.owns,
  ...Object.keys(a.reads ?? {}),
  ...(a.inserts ?? []),
  ...Object.keys(a.updates ?? {}),
  ...(a.deletes ?? []),
];

/**
 * Cluster-wide, once: each cross-business service's second role (CROSS_BUSINESS, DB-020). No login
 * and no rights of its own here; a member of buku_all_businesses that inherits it (the policies
 * apply to it), and one its service's login role may SET ROLE to but doesn't inherit. Run as an
 * admin after accessStatements has made the login roles and prepare-databases buku_all_businesses.
 */
export function crossBusinessRoleStatements(passwords: Partial<Record<ServiceName, string>>): string[] {
  const out: string[] = [];
  for (const service of SERVICES) {
    if (!passwords[service] || !CROSS_BUSINESS[service]) continue;
    const role = allBusinessesRoleOf(service);
    const all = ident(role);
    out.push(
      `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${literal(role)}) THEN CREATE ROLE ${all} NOLOGIN; END IF; END $$`,
      `ALTER ROLE ${all} WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
      `GRANT "buku_all_businesses" TO ${all} WITH INHERIT TRUE, SET FALSE`,
      `GRANT ${all} TO ${ident(roleOf(service))} WITH INHERIT FALSE, SET TRUE`,
    );
  }
  return out;
}

/**
 * Each service's rights in one v2 database (a user or business shard, or the catalog), exactly as
 * its map says, from any starting point: everything it had there taken away, then the map
 * granted. On business shards the cross-business roles get the same rights.
 *
 * @param schemas every schema the database has tables in (all are stripped first)
 */
export function databaseAccessStatements(
  database: string,
  map: Readonly<Record<ServiceName, Access>>,
  passwords: Partial<Record<ServiceName, string>>,
  options: { schemas: readonly string[]; crossBusiness?: boolean },
): string[] {
  const out: string[] = [];
  const all = options.schemas.map(ident).join(', ');
  for (const service of SERVICES) {
    if (!passwords[service]) continue;
    const roles = [roleOf(service)];
    if (options.crossBusiness && CROSS_BUSINESS[service]) roles.push(allBusinessesRoleOf(service));
    const a = map[service];
    const used = [...new Set(tablesOf(a).map(schemaOf))];
    for (const role of roles) {
      const r = ident(role);
      out.push(
        // No business here at all: not even a connection.
        used.length
          ? `GRANT CONNECT, TEMPORARY ON DATABASE ${ident(database)} TO ${r}`
          : `REVOKE ALL ON DATABASE ${ident(database)} FROM ${r}`,
        `REVOKE ALL ON ALL TABLES IN SCHEMA ${all} FROM ${r}`,
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${all} FROM ${r}`,
        `DO $$ DECLARE c record; BEGIN
           FOR c IN SELECT table_schema, table_name, column_name, privilege_type
                    FROM information_schema.column_privileges WHERE grantee = ${literal(role)} LOOP
             EXECUTE format('REVOKE %s (%I) ON %I.%I FROM ${r}', c.privilege_type, c.column_name, c.table_schema, c.table_name);
           END LOOP;
         END $$`,
        `REVOKE ALL ON SCHEMA ${all} FROM ${r}`,
        ...(used.length ? [`GRANT USAGE ON SCHEMA ${used.map(ident).join(', ')} TO ${r}`] : []),
        ...grants(a, r),
      );
    }
  }
  return out;
}
