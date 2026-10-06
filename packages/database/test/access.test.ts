import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ACCESS, NOT_WRITTEN_AT_RUN_TIME, roleOf, SERVICES } from '../src/access.js';
import { accessStatements } from '../src/access-sql.js';

/** Tables and their columns, as the Prisma schema names them in the database. */
function schemaTables(): Map<string, Set<string>> {
  const schema = readFileSync(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!));
  const tables = new Map<string, Set<string>>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = m[2]!;
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1]!;
    const columns = new Set<string>();
    for (const line of body.split('\n')) {
      const f = /^\s+(\w+)\s+(\w+)(\[\])?\??(.*)$/.exec(line);
      // A field whose type is another model is a relation, not a column.
      if (!f || models.has(f[2]!)) continue;
      columns.add(/@map\("([^"]+)"\)/.exec(f[4]!)?.[1] ?? f[1]!);
    }
    tables.set(table, columns);
  }
  return tables;
}

const tables = schemaTables();

describe('what each service may do in the database (D-092)', () => {
  it('every table has an owner, or is written by no service at run time', () => {
    const owned = new Set(SERVICES.flatMap((s) => ACCESS[s].owns));
    const quiet = NOT_WRITTEN_AT_RUN_TIME as readonly string[];
    expect([...tables.keys()].filter((t) => !owned.has(t) && !quiet.includes(t))).toEqual([]);
  });

  it('names only tables and columns that exist', () => {
    const problems: string[] = [];
    for (const s of SERVICES) {
      const a = ACCESS[s];
      const named = [
        ...a.owns,
        ...Object.keys(a.reads ?? {}),
        ...(a.inserts ?? []),
        ...Object.keys(a.updates ?? {}),
        ...(a.deletes ?? []),
      ];
      for (const t of named) if (!tables.has(t)) problems.push(`${s}: no table ${t}`);
      for (const [t, which] of [...Object.entries(a.reads ?? {}), ...Object.entries(a.updates ?? {})]) {
        if (which === '*' || !tables.has(t)) continue;
        for (const c of which) if (!tables.get(t)!.has(c)) problems.push(`${s}: no column ${t}.${c}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('no other service can read credentials, contact hashes or sign-in lock state', () => {
    const secret = [
      'password_hash',
      'email_hash',
      'phone_hash',
      'phone_encrypted',
      'unverified_phone_encrypted',
      'failed_login_count',
      'locked_until',
      'avatar_storage_key',
    ];
    for (const s of SERVICES.filter((x) => x !== 'auth')) {
      const users = ACCESS[s].reads?.users;
      expect(users, `${s} reads all of users`).not.toBe('*');
      for (const c of secret) expect(users ?? [], `${s} reads users.${c}`).not.toContain(c);
      for (const t of ['user_mfa', 'refresh_tokens', 'oauth_accounts']) {
        expect(Object.keys(ACCESS[s].reads ?? {}), `${s} reads ${t}`).not.toContain(t);
        expect(ACCESS[s].owns, `${s} owns ${t}`).not.toContain(t);
      }
    }
  });

  it('the audit log is only ever appended to', () => {
    for (const s of SERVICES) {
      expect(ACCESS[s].owns).not.toContain('audit_logs');
      expect(Object.keys(ACCESS[s].updates ?? {})).not.toContain('audit_logs');
      expect(ACCESS[s].deletes ?? []).not.toContain('audit_logs');
    }
  });

  it('each role starts from nothing, then gets exactly its map; no password, no role', () => {
    const sql = accessStatements('buku', { booking: 'p'.repeat(32) });
    const role = `"${roleOf('booking')}"`;
    // Every statement is about this one role.
    expect(sql.every((s) => s.includes(roleOf('booking')))).toBe(true);
    const firstRevoke = sql.findIndex((s) =>
      s.startsWith(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role}`),
    );
    const firstGrant = sql.findIndex((s) => s.startsWith('GRANT SELECT, INSERT, UPDATE, DELETE'));
    expect(firstRevoke).toBeGreaterThan(-1);
    expect(firstRevoke).toBeLessThan(firstGrant);
    expect(sql.some((s) => /^GRANT SELECT \([^)]*"name"[^)]*\) ON "users"/.test(s))).toBe(true);
    expect(sql.some((s) => s.includes('password_hash'))).toBe(false);
    expect(sql.some((s) => /NOBYPASSRLS/.test(s))).toBe(true);
    // A service with no password set gets no role.
    expect(sql.some((s) => s.includes('buku_svc_auth'))).toBe(false);
  });
});
