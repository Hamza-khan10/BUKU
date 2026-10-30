import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliUrl, tlsOptions } from '../src/tls.js';

/** How clients read libpq's TLS settings (DB-020; the connections themselves: tls.int.test.ts). */

const authority = join(mkdtempSync(join(tmpdir(), 'buku-tls-')), 'ca.crt');
writeFileSync(authority, '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n');

describe('tlsOptions', () => {
  it('verify-full: the authority from PGSSLROOTCERT, every certificate checked', () => {
    expect(tlsOptions({ PGSSLMODE: 'verify-full', PGSSLROOTCERT: authority })).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n',
      rejectUnauthorized: true,
    });
  });

  it('disable turns TLS off; nothing set leaves the driver alone', () => {
    expect(tlsOptions({ PGSSLMODE: 'disable' })).toBe(false);
    expect(tlsOptions({})).toBeUndefined();
  });

  it("refuses modes that don't check the server, and verify-full without an authority", () => {
    for (const mode of ['prefer', 'require', 'verify-ca', 'allow', 'no-verify']) {
      expect(() => tlsOptions({ PGSSLMODE: mode, PGSSLROOTCERT: authority })).toThrow(/verify-full/);
    }
    expect(() => tlsOptions({ PGSSLMODE: 'verify-full' })).toThrow(/PGSSLROOTCERT/);
  });
});

describe('cliUrl (Prisma CLI)', () => {
  const url = 'postgresql://buku_migrator:p%40ss%2Fword@localhost:5432/buku_directory';

  it('requires TLS and checks the chain and the name against the authority', () => {
    const tls = new URL(cliUrl(url, { PGSSLMODE: 'verify-full', PGSSLROOTCERT: authority }));
    expect(Object.fromEntries(tls.searchParams)).toEqual({
      sslmode: 'require',
      sslaccept: 'strict',
      sslcert: authority,
    });
    expect(tls.password).toBe('p%40ss%2Fword');
    expect(tls.hostname).toBe('localhost');
  });

  it('leaves the URL alone without PGSSLMODE, and says so with disable', () => {
    expect(cliUrl(url, {})).toBe(url);
    expect(new URL(cliUrl(url, { PGSSLMODE: 'disable' })).searchParams.get('sslmode')).toBe('disable');
  });
});
