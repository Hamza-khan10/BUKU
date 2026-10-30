import { rootCertificates, type ConnectionOptions } from 'node:tls';
import { PrismaPg } from '@prisma/adapter-pg';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '../src/generated/directory/client.js';
import { createDatabaseClient, tlsOptions } from '../src/index.js';
import { testEnv } from './int-env.js';

/**
 * TLS on every connection (docs/DATABASE.md DB-020): the server admits network connections only
 * over TLS 1.3, and our clients check its certificate against the development authority.
 */

/** A client of the test directory with TLS settings of the test's choosing, not the environment's. */
async function connectWith(ssl: false | ConnectionOptions) {
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: testEnv.directoryAppUrl,
      max: 1,
      connectionTimeoutMillis: 5_000,
      ssl,
    }),
  });
  try {
    await db.$queryRaw`SELECT 1`;
  } finally {
    await db.$disconnect();
  }
}

describe('TLS to Postgres', () => {
  it('our clients connect over TLS 1.3, checking the certificate', async () => {
    expect(tlsOptions()).toMatchObject({ rejectUnauthorized: true });
    const db = createDatabaseClient({ url: testEnv.directoryAppUrl, applicationName: 'tls-int-test' });
    try {
      const [session] = await db.$queryRaw<{ ssl: boolean; version: string }[]>`
        SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()`;
      expect(session).toEqual({ ssl: true, version: 'TLSv1.3' });
    } finally {
      await db.$disconnect();
    }
  });

  it('refuses a connection without TLS', async () => {
    await expect(connectWith(false)).rejects.toThrow(/no encryption/);
  });

  it('refuses TLS older than 1.3', async () => {
    const options = tlsOptions();
    if (!options) throw new Error('PGSSLMODE is not set: run pnpm bootstrap');
    await expect(connectWith({ ...options, maxVersion: 'TLSv1.2' })).rejects.toThrow(/protocol|version/i);
  });

  it("a client refuses a server whose certificate its authority didn't sign", async () => {
    // Every public authority Node trusts, but not ours: the server's certificate checks out with none.
    await expect(connectWith({ ca: [...rootCertificates], rejectUnauthorized: true })).rejects.toThrow(
      /self[- ]signed|unable to (get local issuer|verify)/i,
    );
  });
});
