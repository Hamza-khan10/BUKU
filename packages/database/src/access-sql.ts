import { ACCESS, roleOf, SERVICES, type ServiceName } from './access.js';

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
