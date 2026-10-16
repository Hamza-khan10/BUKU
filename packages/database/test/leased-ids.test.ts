import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdLeaseLostError, LeasedIdGenerator, type DirectoryClient } from '../src/directory.js';

/**
 * The lease's safety rule (DB-002), on a clock the test controls: an instance stops making IDs by
 * itself once its lease could have run out, even when it can't reach the directory to hear so.
 * (The database side of leases is in directory.int.test.ts.)
 */

type Answer = Record<string, unknown>[] | Error;

/** A directory that answers lease, renew and release calls from a script. */
function fakeDirectory(renewals: Answer[]) {
  const calls: string[] = [];
  const answer = (sql: TemplateStringsArray): Record<string, unknown>[] => {
    const text = sql.join('?');
    if (text.includes('release_generator')) {
      calls.push('release');
      return [{}];
    }
    if (text.includes('lease_generator')) {
      calls.push('lease');
      return [{ generator_id: 42 }];
    }
    if (text.includes('renew_generator')) {
      calls.push('renew');
      const next = renewals.shift() ?? [{ expires: new Date() }];
      if (next instanceof Error) throw next;
      return next;
    }
    throw new Error(`unexpected query: ${text}`);
  };
  const client = {
    $queryRaw: vi.fn((sql: TemplateStringsArray) => Promise.resolve().then(() => answer(sql))),
  };
  return { client: client as unknown as DirectoryClient, calls };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['performance', 'setInterval', 'clearInterval', 'Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('LeasedIdGenerator', () => {
  it('stops by itself before the lease could expire when renewals keep failing', async () => {
    const down = new Error('connection refused');
    const { client } = fakeDirectory([down, down, down, down]);
    const ids = new LeasedIdGenerator(client, {
      instance: 'i-1',
      region: 0,
      ttlSeconds: 30,
      marginSeconds: 5,
    });
    await ids.start();
    expect(ids.generator).toBe(42);
    expect(() => ids.next()).not.toThrow();

    // Renewals at 10 s and 20 s fail; IDs keep coming until 25 s (30 s lease, 5 s margin)...
    await vi.advanceTimersByTimeAsync(24_000);
    expect(() => ids.next()).not.toThrow();
    // ...and stop after it, without hearing anything from the directory.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(() => ids.next()).toThrow(IdLeaseLostError);
    await ids.stop();
  });

  it('renewals that get through keep it going; a renewal that is refused stops it at once', async () => {
    const { client, calls } = fakeDirectory([
      [{ expires: new Date() }],
      [{ expires: new Date() }],
      [{ expires: null }],
    ]);
    const ids = new LeasedIdGenerator(client, { instance: 'i-2', region: 0, ttlSeconds: 30 });
    await ids.start();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.filter((c) => c === 'renew')).toHaveLength(2);
    // Well past the first lease, still going: each renewal extended it.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(() => ids.next()).not.toThrow();
    // The third renewal is told the lease is gone (another instance has it).
    await vi.advanceTimersByTimeAsync(1_000);
    expect(() => ids.next()).toThrow(IdLeaseLostError);
    await ids.stop();
    expect(calls.at(-1)).toBe('release');
  });

  it('makes no IDs before it holds a lease', () => {
    const { client } = fakeDirectory([]);
    expect(() => new LeasedIdGenerator(client, { instance: 'i-3', region: 0 }).next()).toThrow(
      IdLeaseLostError,
    );
  });
});
