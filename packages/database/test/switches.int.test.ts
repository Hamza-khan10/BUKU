import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { directoryAccessStatements } from '../src/access-sql.js';
import { applyStatements } from '../src/apply-access.js';
import { createDirectoryClient, SWITCH_KEYS, Switches, type DirectoryClient } from '../src/index.js';
import { testEnv } from './int-env.js';
import { asService, ensureServiceRoles, passwords } from './service-roles.js';

/**
 * Emergency switches in the directory (D-129): all there from the start and on; off only with a
 * reason; only the auth service (its admin endpoints) may flip one, and nobody may add or remove
 * one; every service reads them and sees a change at its next read.
 */

let owner: DirectoryClient;

beforeAll(async () => {
  owner = createDirectoryClient({ url: testEnv.directoryMigratorUrl, applicationName: 'switches-int-test' });
  await ensureServiceRoles();
  await applyStatements(
    testEnv.adminUrl('buku_directory_test'),
    directoryAccessStatements('buku_directory_test', passwords),
  );
});

afterAll(async () => {
  await owner.switch.updateMany({ data: { off: false, reason: null } });
  await owner.$disconnect();
});

describe('emergency switches (D-129)', () => {
  it('every switch the code knows is there, and on', async () => {
    const found = await owner.switch.findMany();
    expect(found.map((s) => s.key).sort()).toEqual([...SWITCH_KEYS].sort());
    expect(found.every((s) => !s.off)).toBe(true);
  });

  it('off says why; a switch the code doesn’t know can’t be added', async () => {
    await expect(
      owner.$executeRaw`UPDATE ops.switches SET off = true WHERE key = 'bookings'`,
    ).rejects.toThrow(/switches_off_has_reason/);
    await expect(owner.$executeRaw`INSERT INTO ops.switches (key) VALUES ('everything')`).rejects.toThrow(
      /switches_key_known/,
    );
  });

  it('only the auth service may flip one; no service may add or remove one; every service reads them', async () => {
    const auth = asService('auth', 'buku_directory_test');
    const booking = asService('booking', 'buku_directory_test');
    try {
      await auth.$executeRaw`UPDATE ops.switches SET off = true, reason = 'test: under attack', changed_at = now()
        WHERE key = 'bookings'`;
      await expect(
        booking.$executeRaw`UPDATE ops.switches SET off = false WHERE key = 'bookings'`,
      ).rejects.toThrow(/permission denied/);
      await expect(auth.$executeRaw`DELETE FROM ops.switches WHERE key = 'bookings'`).rejects.toThrow(
        /permission denied/,
      );
      await expect(auth.$executeRaw`INSERT INTO ops.switches (key) VALUES ('queue')`).rejects.toThrow(
        /permission denied/,
      );
      expect(await booking.$queryRaw`SELECT key FROM ops.switches WHERE off`).toEqual([{ key: 'bookings' }]);
    } finally {
      await owner.switch.update({ where: { key: 'bookings' }, data: { off: false, reason: null } });
      await auth.$disconnect();
      await booking.$disconnect();
    }
  });

  it('a service sees a switch turned off at its next read, and back on', async () => {
    const reader = createDirectoryClient({
      url: testEnv.directoryAppUrl,
      applicationName: 'switches-int-reader',
    });
    const switches = new Switches(reader, { pollMs: 60_000 });
    try {
      await switches.start();
      expect(switches.isOff('payments')).toBe(false);
      await owner.switch.update({
        where: { key: 'payments' },
        data: { off: true, reason: 'test: card testing' },
      });
      await switches.refresh();
      expect(switches.isOff('payments')).toBe(true);
      expect(() => switches.check('payments')).toThrow(
        expect.objectContaining({ code: 'SERVICE_PAUSED' }) as Error,
      );
      await owner.switch.update({ where: { key: 'payments' }, data: { off: false } });
      await switches.refresh();
      expect(switches.isOff('payments')).toBe(false);
    } finally {
      switches.stop();
      await owner.switch.update({ where: { key: 'payments' }, data: { off: false, reason: null } });
      await reader.$disconnect();
    }
  });
});
