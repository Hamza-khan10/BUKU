import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EarlyAccessInput, fieldProblems } from '../src/features/early-access/schema';
import {
  earlyAccessSettings,
  hashAddress,
  passedBotCheck,
  saveSignup,
  saveToTestStore,
  type Db,
} from '../src/features/early-access/server';

const business = {
  kind: 'business',
  email: '  Hina@Example.COM ',
  name: 'Hina Qureshi',
  businessName: 'Happy Tails Clinic',
  businessType: 'Veterinary clinic',
  branches: '2-5',
  city: 'Lahore',
  country: 'pk',
  whatsapp: '+92 300 123-4567',
  planInterest: 'network',
  consent: true,
  utmSource: 'instagram',
};

/**
 * D1 is SQLite: the real migrations, in order, on Node's own SQLite, behind the few D1 calls the
 * site uses. `upTo` stops after a given migration (to test the next one on data already there).
 */
const MIGRATIONS = readdirSync(new URL('../migrations/', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort();
const migrate = (sqlite: DatabaseSync, files: string[]) => {
  for (const f of files) sqlite.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8'));
};

function d1(upTo?: string): { db: Db; sqlite: DatabaseSync } {
  const sqlite = new DatabaseSync(':memory:');
  migrate(sqlite, upTo ? MIGRATIONS.slice(0, MIGRATIONS.indexOf(upTo) + 1) : MIGRATIONS);
  const db: Db = {
    prepare: (sql) => ({
      bind: (...values) => {
        const statement = sqlite.prepare(sql);
        const args = values as (string | number | null)[];
        return {
          first: <T>() => Promise.resolve((statement.get(...args) as T | undefined) ?? null),
          run: () => Promise.resolve({ meta: { changes: Number(statement.run(...args).changes) } }),
        };
      },
    }),
  };
  return { db, sqlite };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Early access: what’s accepted', () => {
  it('takes a business’s details, cleaned: email lowercase, phone and country in their stored form', () => {
    const parsed = EarlyAccessInput.parse(business);
    expect(parsed).toMatchObject({
      email: 'hina@example.com',
      whatsapp: '+923001234567',
      country: 'PK',
      branches: '2-5',
      planInterest: 'network',
    });
  });

  it('takes someone who books with only an email, a city and their yes', () => {
    expect(
      EarlyAccessInput.safeParse({
        kind: 'customer',
        email: 'a@b.pk',
        city: 'Karachi',
        country: 'PK',
        consent: true,
      }).success,
    ).toBe(true);
  });

  it('refuses what could corrupt the list, and says why in plain words', () => {
    const bad = EarlyAccessInput.safeParse({
      ...business,
      name: 'Hina 😀',
      businessName: 'X',
      email: 'not an email',
      whatsapp: '0300-1234567',
      consent: false,
      branches: '3',
      utmSource: '<script>',
      extra: 'field',
    });
    expect(bad.success).toBe(false);
    const problems = fieldProblems(bad.error!);
    expect(Object.keys(problems)).toEqual(
      expect.arrayContaining([
        'name',
        'businessName',
        'email',
        'whatsapp',
        'consent',
        'branches',
        'utmSource',
      ]),
    );
    expect(problems.businessName).toBe('At least 2 characters, please.');
    expect(problems.consent).toContain('Tick this');
    expect(problems.branches).toBe('Choose one of these.');
    // Hidden characters (a zero-width space) aren't let in either.
    expect(EarlyAccessInput.safeParse({ ...business, city: 'Lah\u200Bore' }).success).toBe(false);
  });

  it('asks branches split where Enterprise starts (D-145); the old "6 to 20" isn’t offered any more', () => {
    for (const branches of ['1', '2-5', '6-9', '10-20', '21+'])
      expect(EarlyAccessInput.safeParse({ ...business, branches }).success, branches).toBe(true);
    expect(EarlyAccessInput.safeParse({ ...business, branches: '6-20' }).success).toBe(false);
  });
});

describe('Early access: on the server', () => {
  it('is available with every setting, in memory only when asked and never on the live site', () => {
    expect(earlyAccessSettings()).toBeNull();
    vi.stubEnv('EARLY_ACCESS_TEST_STORE', 'true');
    expect(earlyAccessSettings()).toBe('test');
    vi.stubEnv('BUKU_SITE_ENV', 'production');
    expect(earlyAccessSettings()).toBeNull(); // never the in-memory store on the live Worker
    vi.stubEnv('TURNSTILE_SITE_KEY', 's');
    vi.stubEnv('TURNSTILE_SECRET_KEY', 't');
    vi.stubEnv('EARLY_ACCESS_HASH_SECRET', 'short');
    expect(earlyAccessSettings()).toBeNull(); // too short a key to scramble addresses with
    vi.stubEnv('EARLY_ACCESS_HASH_SECRET', 'y'.repeat(32));
    expect(earlyAccessSettings()).toEqual({
      turnstileSiteKey: 's',
      turnstileSecret: 't',
      hashSecret: 'y'.repeat(32),
    });
  });

  it('scrambles an address with a key: the same address matches itself, nothing else, and can’t be read back', () => {
    const a = hashAddress('203.0.113.7', 'k'.repeat(32));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashAddress('203.0.113.7', 'k'.repeat(32))).toBe(a);
    expect(hashAddress('203.0.113.8', 'k'.repeat(32))).not.toBe(a);
    expect(hashAddress('203.0.113.7', 'j'.repeat(32))).not.toBe(a);
    expect(a).not.toContain('203');
  });

  it('asks Cloudflare once per token, and believes only a clear yes for this form', async () => {
    const answer = (body: unknown, ok = true) =>
      vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body) } as unknown as Response));
    const yes = answer({ success: true, action: 'early_access' });
    expect(await passedBotCheck('secret', 'token', '203.0.113.7', yes)).toBe(true);
    const sent = yes.mock.calls[0] as unknown as [string, RequestInit];
    expect(sent[0]).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect((sent[1].body as URLSearchParams).toString()).toContain('remoteip=203.0.113.7');
    expect(await passedBotCheck('secret', undefined, undefined, yes)).toBe(false);
    expect(await passedBotCheck('secret', 't', undefined, answer({ success: false }))).toBe(false);
    expect(await passedBotCheck('secret', 't', undefined, answer({ success: true, action: 'login' }))).toBe(
      false,
    );
    expect(await passedBotCheck('secret', 't', undefined, answer({}, false))).toBe(false);
    const down = vi.fn(() => Promise.reject(new Error('offline')));
    expect(await passedBotCheck('secret', 't', undefined, down)).toBe(false);
  });

  it('keeps a signup in D1: one per email and kind, the same answer twice, five an hour from one address', async () => {
    const { db, sqlite } = d1();
    const input = EarlyAccessInput.parse(business);
    const now = new Date('2026-11-16T10:00:00.000Z');
    expect(await saveSignup(db, input, 'a'.repeat(64), now)).toBe('joined');
    expect(await saveSignup(db, input, 'a'.repeat(64), now)).toBe('already');
    expect(await saveSignup(db, { ...input, kind: 'customer' }, null, now)).toBe('joined');
    const row = sqlite.prepare('SELECT * FROM waitlist WHERE kind = ?').get('business') as Record<
      string,
      unknown
    >;
    expect(row).toMatchObject({
      email: 'hina@example.com',
      business_name: 'Happy Tails Clinic',
      whatsapp: '+923001234567',
      country: 'PK',
      plan_interest: 'network',
      utm_source: 'instagram',
      ip_hash: 'a'.repeat(64),
      created_at: '2026-11-16T10:00:00.000Z',
    });

    const address = 'b'.repeat(64);
    for (let i = 0; i < 5; i++)
      expect(await saveSignup(db, { ...input, email: `p${i}@example.com` }, address, now)).toBe('joined');
    expect(await saveSignup(db, { ...input, email: 'p6@example.com' }, address, now)).toBe('slow_down');
    // An hour later, that place may sign up again.
    expect(
      await saveSignup(
        db,
        { ...input, email: 'p7@example.com' },
        address,
        new Date('2026-11-16T11:00:01.000Z'),
      ),
    ).toBe('joined');
  });

  it('the table refuses what the website would, even if a check there ever slipped', () => {
    const { sqlite } = d1();
    const insert = (values: Record<string, unknown>) => () =>
      sqlite
        .prepare(
          `INSERT INTO waitlist (email, kind, name, business_name, business_type, branches, city, country, whatsapp, plan_interest, ip_hash)
           VALUES (:email, :kind, :name, :business_name, :business_type, :branches, :city, :country, :whatsapp, :plan_interest, :ip_hash)`,
        )
        .run({
          email: 'ok@example.com',
          kind: 'customer',
          name: null,
          business_name: null,
          business_type: null,
          branches: null,
          city: 'Lahore',
          country: 'PK',
          whatsapp: null,
          plan_interest: null,
          ip_hash: null,
          ...values,
        } as Record<string, string | null>);
    expect(insert({})).not.toThrow();
    for (const bad of [
      { email: 'Upper@Example.com' },
      { email: 'no-at-sign' },
      { kind: 'admin' },
      { country: 'Pakistan' },
      { country: 'pk' },
      { whatsapp: '0300-1234567' },
      { kind: 'business' }, // a business without its details
      { branches: '3' },
      { branches: '6-19' },
      { ip_hash: 'not-a-hash' },
    ])
      expect(insert({ email: `x${Math.random()}@example.com`, ...bad }), JSON.stringify(bad)).toThrow();
  });

  it('0002 keeps every earlier signup as it was given, and takes the new branch answers (D-145)', () => {
    const { sqlite } = d1('0001_waitlist.sql');
    const add = (email: string, branches: string) =>
      sqlite
        .prepare(
          `INSERT INTO waitlist (email, kind, name, business_name, business_type, branches, city, country, plan_interest)
           VALUES (?, 'business', 'Ali', 'Ali Cuts', 'Barbershop', ?, 'Lahore', 'PK', 'network')`,
        )
        .run(email, branches);
    add('one@example.com', '6-20');
    add('two@example.com', '21+');
    sqlite.prepare(`DELETE FROM waitlist WHERE email = 'one@example.com'`).run();
    add('three@example.com', '6-20');
    expect(() => add('early@example.com', '10-20')).toThrow(); // what the old list refused
    const before = sqlite.prepare('SELECT * FROM waitlist ORDER BY id').all();

    migrate(sqlite, ['0002_waitlist_branches.sql']);
    expect(sqlite.prepare('SELECT * FROM waitlist ORDER BY id').all()).toEqual(before);
    add('four@example.com', '10-20');
    add('five@example.com', '6-9');
    // Ids carry on after the highest ever given (1 was deleted, 3 is the last), never reused.
    expect(sqlite.prepare(`SELECT id FROM waitlist WHERE email = 'four@example.com'`).get()).toEqual({
      id: 4,
    });
    expect(() => add('six@example.com', '6-19')).toThrow();
    expect(() => add('two@example.com', '1')).toThrow(); // one per email and kind, still
    const left = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE tbl_name LIKE 'waitlist%' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all();
    expect(left).toEqual([
      { name: 'waitlist' },
      { name: 'waitlist_created' },
      { name: 'waitlist_ip_recent' },
    ]);
  });

  it('the tests’ store follows the same rules: one per email and kind, five an hour from one address', () => {
    const input = EarlyAccessInput.parse({ ...business, email: `t${Date.now()}@example.com` });
    const at = 1_000_000_000_000;
    expect(saveToTestStore(input, null, at)).toBe('joined');
    expect(saveToTestStore(input, null, at)).toBe('already');
    expect(saveToTestStore({ ...input, kind: 'customer' }, null, at)).toBe('joined');
    const address = 'b'.repeat(64);
    for (let i = 0; i < 5; i++)
      expect(saveToTestStore({ ...input, email: `r${i}.${at}@example.com` }, address, at)).toBe('joined');
    expect(saveToTestStore({ ...input, email: `r6.${at}@example.com` }, address, at)).toBe('slow_down');
    expect(saveToTestStore({ ...input, email: `r7.${at}@example.com` }, address, at + 3_600_001)).toBe(
      'joined',
    );
  });
});
