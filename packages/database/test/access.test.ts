import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  BUSINESS_SHARD_ACCESS,
  BUSINESS_SHARD_NOT_WRITTEN,
  CATALOG_ACCESS,
  CROSS_BUSINESS,
  DIRECTORY_ACCESS,
  DIRECTORY_REFERENCE_ACCESS,
  REFERENCE_TABLES,
  roleOf,
  SERVICES,
  USER_SHARD_ACCESS,
  USER_SHARD_NOT_WRITTEN,
  type Access,
} from '../src/access.js';
import {
  crossBusinessRoleStatements,
  databaseAccessStatements,
  directoryAccessStatements,
  roleStatements,
} from '../src/access-sql.js';

describe('each service’s own role (D-092)', () => {
  it('signs in with its own password and nothing more; no password, no role', () => {
    const sql = roleStatements({ booking: 'p'.repeat(32) });
    const role = roleOf('booking');
    // Every statement is about this one role.
    expect(sql.every((s) => s.includes(role))).toBe(true);
    const limits = sql.find((s) => s.startsWith(`ALTER ROLE "${role}" WITH LOGIN`))!;
    for (const flag of [
      'NOSUPERUSER',
      'NOCREATEDB',
      'NOCREATEROLE',
      'NOINHERIT',
      'NOREPLICATION',
      'NOBYPASSRLS',
    ])
      expect(limits).toContain(flag);
    // No rights to any table here: each database grants its own (below), starting from nothing.
    expect(sql.some((s) => /^(GRANT|REVOKE)/.test(s))).toBe(false);
    // A service with no password set gets no role.
    expect(sql.some((s) => s.includes('buku_svc_auth'))).toBe(false);
  });
});

describe('what each service may do in the directory database', () => {
  const migration = ['20261016120000_registry', '20261017090000_lookups', '20261031180000_emergency_switches']
    .map((m) =>
      readFileSync(new URL(`../prisma/directory/migrations/${m}/migration.sql`, import.meta.url), 'utf8'),
    )
    .join('\n');

  it('names only tables and functions the directory has', () => {
    for (const t of DIRECTORY_ACCESS.reads) {
      const [schema, table] = t.split('.');
      expect(migration, t).toContain(`CREATE TABLE "${schema}"."${table}"`);
    }
    for (const f of DIRECTORY_ACCESS.executes) {
      const [schema, name] = f.slice(0, f.indexOf('(')).split('.');
      expect(migration, f).toContain(`CREATE FUNCTION "${schema}"."${name}"(`);
    }
  });

  it('reads the registry and calls its functions, never writes it; no password, no rights', () => {
    const sql = directoryAccessStatements('buku_directory', { auth: 'p'.repeat(32) });
    expect(sql.every((s) => s.includes('"buku_svc_auth"'))).toBe(true);
    const revoke = sql.findIndex((s) => s.startsWith('REVOKE ALL ON ALL TABLES'));
    const grant = sql.findIndex((s) => s.startsWith('GRANT SELECT'));
    expect(revoke).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
    // The one write: auth's admin endpoints flip an emergency switch (D-129), never add or remove one.
    expect(sql.filter((s) => /GRANT (INSERT|UPDATE|DELETE|ALL)/.test(s))).toEqual([
      'GRANT UPDATE ("off", "reason", "changed_by", "changed_at") ON "ops"."switches" TO "buku_svc_auth"',
    ]);
    expect(
      directoryAccessStatements('buku_directory', { booking: 'p'.repeat(32) }).some((s) =>
        /GRANT (INSERT|UPDATE|DELETE|ALL)/.test(s),
      ),
    ).toBe(false);
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION "registry"."route"(text, bigint), "registry"."region_of"(bigint), ' +
        '"registry"."lease_generator"(text, smallint, integer), "registry"."renew_generator"(smallint, text, integer), ' +
        '"registry"."release_generator"(smallint, text), "registry"."place"(text, bigint), ' +
        '"lookup"."claim"(text, bytea, bigint, boolean), "lookup"."release"(text, bytea, bigint), ' +
        '"lookup"."release_all"(text, bigint), "lookup"."find"(text, bytea) TO "buku_svc_auth"',
    );
    expect(directoryAccessStatements('buku_directory', {})).toEqual([]);
  });
});

// ═════════════════════════════ DATABASE v2 (D2d) ═════════════════════════════

/** A v2 schema's tables, schema-qualified unless in `public`, with their columns. */
function v2Tables(file: string, extra: Record<string, string[]> = {}): Map<string, Set<string>> {
  const schema = readFileSync(new URL(`../prisma/${file}/schema.prisma`, import.meta.url), 'utf8');
  const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]!));
  const tables = new Map<string, Set<string>>();
  for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const body = m[2]!;
    const name = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? m[1]!;
    const where = /@@schema\("([^"]+)"\)/.exec(body)?.[1] ?? 'public';
    const columns = new Set<string>();
    for (const line of body.split('\n')) {
      const f = /^\s+(\w+)\s+(\w+)(\[\])?\??(.*)$/.exec(line);
      if (!f || models.has(f[2]!)) continue;
      columns.add(/@map\("([^"]+)"\)/.exec(f[4]!)?.[1] ?? f[1]!);
    }
    tables.set(where === 'public' ? name : `${where}.${name}`, columns);
  }
  for (const [t, cols] of Object.entries(extra)) tables.set(t, new Set(cols));
  return tables;
}

const FAMILIES = {
  user: {
    map: USER_SHARD_ACCESS,
    tables: v2Tables('user'),
    notWritten: USER_SHARD_NOT_WRITTEN as readonly string[],
  },
  business: {
    map: BUSINESS_SHARD_ACCESS,
    // The AI receptionist's knowledge is in the migration's SQL (pgvector), not the Prisma schema.
    tables: v2Tables('business', {
      'ai.business_knowledge_chunks': ['id', 'business_id', 'source', 'content'],
    }),
    notWritten: BUSINESS_SHARD_NOT_WRITTEN as readonly string[],
  },
  catalog: {
    map: CATALOG_ACCESS,
    tables: v2Tables('catalog'),
    notWritten: [...REFERENCE_TABLES] as readonly string[],
  },
};
const writes = (a: Access) => [
  ...a.owns,
  ...(a.inserts ?? []),
  ...Object.keys(a.updates ?? {}),
  ...(a.deletes ?? []),
];

describe('what each service may do in database v2 (D2d)', () => {
  for (const [family, f] of Object.entries(FAMILIES)) {
    it(`${family}: every table is written by someone, or deliberately by no one`, () => {
      const written = new Set(SERVICES.flatMap((s) => writes(f.map[s])));
      const orphans = [...f.tables.keys()].filter((t) => !written.has(t) && !f.notWritten.includes(t));
      expect(orphans).toEqual([]);
    });

    it(`${family}: names only tables and columns that exist`, () => {
      for (const s of SERVICES) {
        const a = f.map[s];
        for (const t of [...writes(a), ...Object.keys(a.reads ?? {})])
          expect(f.tables.has(t), `${s}: ${t}`).toBe(true);
        for (const [t, which] of [...Object.entries(a.reads ?? {}), ...Object.entries(a.updates ?? {})]) {
          if (which === '*') continue;
          for (const c of which) expect(f.tables.get(t)?.has(c), `${s}: ${t}.${c}`).toBe(true);
        }
      }
    });
  }

  it('nobody writes a reference copy, the appointment index or open shifts; audit logs only grow', () => {
    const untouchable = [...REFERENCE_TABLES, 'appointment_index', 'staff_open_shifts'];
    for (const [family, f] of Object.entries(FAMILIES)) {
      for (const s of SERVICES) {
        for (const t of writes(f.map[s])) expect(untouchable, `${family} ${s}: ${t}`).not.toContain(t);
        const a = f.map[s];
        expect(
          [...a.owns, ...Object.keys(a.updates ?? {}), ...(a.deletes ?? [])],
          `${family} ${s}`,
        ).not.toContain('audit_logs');
      }
    }
  });

  it('no other service reads credentials or hashes on a user shard', () => {
    const secret = [
      'password_hash',
      'email_hash',
      'phone_hash',
      'unverified_phone_hash',
      'locked_until',
      'failed_login_count',
    ];
    for (const s of SERVICES) {
      if (s === 'auth') continue;
      const users = USER_SHARD_ACCESS[s].reads?.users;
      expect(users === '*', s).toBe(false);
      for (const c of users ?? []) expect(secret, `${s} reads users.${c}`).not.toContain(c);
      expect(USER_SHARD_ACCESS[s].reads?.refresh_tokens, s).toBeUndefined();
      expect(USER_SHARD_ACCESS[s].reads?.user_mfa, s).toBeUndefined();
    }
  });

  it('only services that work on business shards have a cross-business role', () => {
    for (const s of Object.keys(CROSS_BUSINESS) as (keyof typeof CROSS_BUSINESS)[]) {
      const a = BUSINESS_SHARD_ACCESS[s];
      expect(writes(a).length + Object.keys(a.reads ?? {}).length, s).toBeGreaterThan(0);
    }
    expect(CROSS_BUSINESS.analytics).toBeUndefined();
  });

  it('a cross-business role is switched to, never inherited, and only opens the policies', () => {
    const sql = crossBusinessRoleStatements({ notification: 'p'.repeat(32), analytics: 'p'.repeat(32) });
    expect(sql).toContain(
      'GRANT "buku_all_businesses" TO "buku_svc_notification_all" WITH INHERIT TRUE, SET FALSE',
    );
    expect(sql).toContain(
      'GRANT "buku_svc_notification_all" TO "buku_svc_notification" WITH INHERIT FALSE, SET TRUE',
    );
    expect(sql.some((s) => s.includes('analytics'))).toBe(false);
    // The same rights as the service on business shards; nothing on user shards.
    const shard = databaseAccessStatements(
      'buku_business_pk_1',
      BUSINESS_SHARD_ACCESS,
      { notification: 'p'.repeat(32) },
      {
        schemas: ['public', 'reference', 'ai'],
        crossBusiness: true,
      },
    );
    expect(shard).toContain('GRANT SELECT ON "appointments" TO "buku_svc_notification_all"');
    const user = databaseAccessStatements(
      'buku_user_pk_1',
      USER_SHARD_ACCESS,
      { notification: 'p'.repeat(32) },
      {
        schemas: ['public'],
      },
    );
    expect(user.some((s) => s.includes('_all'))).toBe(false);
  });

  it('a service with nothing in a database can’t even connect to it', () => {
    const sql = databaseAccessStatements(
      'buku_user_pk_1',
      USER_SHARD_ACCESS,
      { analytics: 'p'.repeat(32) },
      {
        schemas: ['public'],
      },
    );
    expect(sql).toContain('REVOKE ALL ON DATABASE "buku_user_pk_1" FROM "buku_svc_analytics"');
    expect(sql.some((s) => s.startsWith('GRANT'))).toBe(false);
  });

  it('reference data is edited only by the services that own it, on the directory', () => {
    const billing = directoryAccessStatements('buku_directory', { billing: 'p'.repeat(32) });
    expect(billing).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "reference"."plans" TO "buku_svc_billing"',
    );
    const booking = directoryAccessStatements('buku_directory', { booking: 'p'.repeat(32) });
    expect(booking.some((s) => /GRANT (INSERT|UPDATE|DELETE)/.test(s))).toBe(false);
    expect(DIRECTORY_REFERENCE_ACCESS.business?.inserts).toEqual(['reference.categories']);
  });
});
