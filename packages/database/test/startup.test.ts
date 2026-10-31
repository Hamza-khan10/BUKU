import { describe, expect, it } from 'vitest';
import { isDatabaseNotReady, whenDatabaseReady } from '../src/index.js';

/**
 * Starting while the database isn't ready yet (after a machine restart Postgres can still be
 * recovering): services wait for it instead of giving up, but never wait on a real mistake.
 */

/** The shape Prisma's driver adapter gives a Postgres error. */
const pgError = (code: string, message: string) =>
  Object.assign(new Error(`Raw query failed. Code: \`${code}\``), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode: code, originalMessage: message } } },
  });

describe('isDatabaseNotReady', () => {
  it('a server starting up, shutting down or a broken link is "not ready"', () => {
    expect(isDatabaseNotReady(pgError('57P03', 'the database system is starting up'))).toBe(true);
    expect(isDatabaseNotReady(pgError('57P01', 'terminating connection due to administrator command'))).toBe(
      true,
    );
    expect(isDatabaseNotReady(pgError('08006', 'connection failure'))).toBe(true);
    expect(isDatabaseNotReady(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe(true);
    // The server's name doesn't resolve yet, or nothing answers: Prisma's adapter says so by kind.
    const unreachable = Object.assign(
      new Error("Raw query failed. Code: `N/A`. Message: `Can't reach database server at postgres`"),
      {
        code: 'P2010',
        meta: { driverAdapterError: { cause: { kind: 'DatabaseNotReachable', host: 'postgres' } } },
      },
    );
    expect(isDatabaseNotReady(unreachable)).toBe(true);
    expect(
      isDatabaseNotReady(
        new Error('query failed', { cause: new Error('Connection terminated unexpectedly') }),
      ),
    ).toBe(true);
  });

  it('anything else is a real error', () => {
    expect(isDatabaseNotReady(pgError('23505', 'duplicate key value'))).toBe(false);
    expect(isDatabaseNotReady(pgError('42P01', 'relation "x" does not exist'))).toBe(false);
    expect(isDatabaseNotReady(pgError('28P01', 'password authentication failed'))).toBe(false);
    expect(isDatabaseNotReady(new Error('no ID generator was leased'))).toBe(false);
    expect(
      isDatabaseNotReady(
        Object.assign(new Error('Raw query failed'), {
          meta: { driverAdapterError: { cause: { kind: 'AuthenticationFailed' } } },
        }),
      ),
    ).toBe(false);
    expect(isDatabaseNotReady(undefined)).toBe(false);
  });
});

describe('whenDatabaseReady', () => {
  const noSleep = () => Promise.resolve();

  it('waits while the database is starting, longer each time, then goes on', async () => {
    let tries = 0;
    const waits: number[] = [];
    const result = await whenDatabaseReady(
      () => {
        tries += 1;
        if (tries < 4) return Promise.reject(pgError('57P03', 'the database system is starting up'));
        return Promise.resolve('ready');
      },
      { onWait: (_err, ms) => waits.push(ms), sleep: noSleep },
    );
    expect(result).toBe('ready');
    expect(waits).toEqual([500, 1000, 2000]);
  });

  it('never waits on a real error', async () => {
    let tries = 0;
    await expect(
      whenDatabaseReady(
        () => {
          tries += 1;
          return Promise.reject(pgError('28P01', 'password authentication failed'));
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow('Raw query failed');
    expect(tries).toBe(1);
  });

  it('gives up once its time is over, with the last error', async () => {
    await expect(
      whenDatabaseReady(() => Promise.reject(pgError('57P03', 'the database system is starting up')), {
        forMs: 0,
        sleep: noSleep,
      }),
    ).rejects.toThrow('Raw query failed');
  });
});
