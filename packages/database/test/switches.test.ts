import { describe, expect, it } from 'vitest';
import type { DirectoryClient } from '../src/directory.js';
import { SWITCH_KEYS, Switches } from '../src/switches.js';

/**
 * The emergency switches as a service reads them (D-129): what's off is refused, and a database
 * that can't be read never turns anything off by itself. (The rules and rights: switches.int.test.ts.)
 */

/** A directory whose switches table answers with these rows — or fails. */
function directory(answer: { current: { key: string; off: boolean }[] | Error }) {
  return {
    $queryRaw: () =>
      answer.current instanceof Error ? Promise.reject(answer.current) : Promise.resolve(answer.current),
  } as unknown as DirectoryClient;
}

const rows = (...off: string[]) => SWITCH_KEYS.map((key) => ({ key, off: off.includes(key) }));

describe('Switches', () => {
  it('refuses what is off with SERVICE_PAUSED (503), lets the rest through', async () => {
    const switches = new Switches(directory({ current: rows('bookings') }));
    await switches.refresh();
    expect(switches.isOff('bookings')).toBe(true);
    expect(switches.isOff('queue')).toBe(false);
    expect(() => switches.check('bookings')).toThrow(
      expect.objectContaining({ code: 'SERVICE_PAUSED', httpStatus: 503 }) as Error,
    );
    expect(() => switches.check('queue')).not.toThrow();

    const next: unknown[] = [];
    switches.guard('bookings')({}, {}, (err) => next.push(err));
    switches.guard('queue')({}, {}, (err) => next.push(err));
    expect(next[0]).toMatchObject({ code: 'SERVICE_PAUSED' });
    expect(next[1]).toBeUndefined();
  });

  it('a switch turned back on lets requests through at the next read', async () => {
    const answer = { current: rows('signups') };
    const switches = new Switches(directory(answer));
    await switches.refresh();
    expect(switches.isOff('signups')).toBe(true);
    answer.current = rows();
    await switches.refresh();
    expect(switches.isOff('signups')).toBe(false);
  });

  it('ignores a key it doesn’t know', async () => {
    const switches = new Switches(directory({ current: [{ key: 'everything', off: true }] }));
    await switches.refresh();
    expect(SWITCH_KEYS.some((k) => switches.isOff(k))).toBe(false);
  });

  it('never turns anything off because the database can’t be read: the last state stands', async () => {
    const answer: { current: { key: string; off: boolean }[] | Error } = { current: new Error('down') };
    const switches = new Switches(directory(answer), { pollMs: 60_000 });
    await switches.start(); // can't read at start: everything on, no error
    expect(SWITCH_KEYS.some((k) => switches.isOff(k))).toBe(false);
    answer.current = rows('payments');
    await switches.refresh();
    answer.current = new Error('down again');
    await expect(switches.refresh()).rejects.toThrow('down again');
    expect(switches.isOff('payments')).toBe(true);
    switches.stop();
  });
});
