import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyRetention, createDatabaseClient, recordAudit, type Database } from '../src/index.js';
import { testEnv } from './int-env.js';

/**
 * SOC 2 controls in the database (D-080): an audit log nobody can rewrite,
 * and a retention schedule the app can run but not shorten.
 */

let db: Database;
let migrator: Database;
const DAY = 86_400_000;

beforeAll(() => {
  db = createDatabaseClient({
    url: testEnv.appUrl,
    applicationName: 'retention-int-test',
    maxConnections: 3,
  });
  migrator = createDatabaseClient({
    url: testEnv.migratorUrl,
    applicationName: 'retention-int-test-migrator',
    maxConnections: 2,
  });
});

afterAll(async () => {
  await db.$disconnect();
  await migrator.$disconnect();
});

describe('Audit log: append-only', () => {
  it('the app writes entries but can never change or remove them — not even through a monthly partition', async () => {
    const id = randomUUID();
    await recordAudit(db, { action: 'test.entry', resourceType: 'test', resourceId: id });
    const where = { resourceId: id };
    expect(await db.auditLog.count({ where })).toBe(1);

    await expect(db.auditLog.updateMany({ where, data: { action: 'test.rewritten' } })).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.auditLog.deleteMany({ where })).rejects.toThrow(/permission denied/);
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    await expect(
      db.$executeRawUnsafe(`DELETE FROM partitions.audit_logs_${month} WHERE resource_id = '${id}'`),
    ).rejects.toThrow(/permission denied/);
  });

  it('even the schema owner is refused by the trigger', async () => {
    const id = randomUUID();
    await recordAudit(db, { action: 'test.entry', resourceType: 'test', resourceId: id });
    await expect(
      migrator.auditLog.updateMany({ where: { resourceId: id }, data: { action: 'test.rewritten' } }),
    ).rejects.toThrow(/can't be changed or deleted/);
    await expect(migrator.auditLog.deleteMany({ where: { resourceId: id } })).rejects.toThrow(
      /can't be changed or deleted/,
    );
  });

  it('months created later get the same protection', async () => {
    await db.$executeRaw`SELECT ensure_monthly_partitions(30, 0)`;
    const [row] = await db.$queryRaw<{ update: boolean; delete: boolean }[]>`
      SELECT has_table_privilege('partitions.audit_logs_' || to_char(now() + interval '29 months', 'YYYY_MM'), 'UPDATE') AS update,
             has_table_privilege('partitions.audit_logs_' || to_char(now() + interval '29 months', 'YYYY_MM'), 'DELETE') AS delete`;
    expect(row).toEqual({ update: false, delete: false });
  });
});

describe('Retention schedule', () => {
  it('drops months past their period (audit 24, notifications 13), never recent ones, and removes old rows; the run is audited', async () => {
    // Old months, as if the platform had been running for years.
    for (const [table, month] of [
      ['audit_logs', '2020_01'],
      ['notifications', '2020_01'],
      [
        'notifications',
        String(new Date().getUTCFullYear() - 1) + '_' + String(new Date().getUTCMonth() + 1).padStart(2, '0'),
      ],
    ] as const) {
      const from = `${month.replace('_', '-')}-01`;
      await migrator.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS partitions.${table}_${month} PARTITION OF public.${table}
         FOR VALUES FROM ('${from}') TO ('${from}'::date + interval '1 month')`,
      );
    }
    const old = new Date(Date.now() - 200 * DAY);
    const recent = new Date(Date.now() - 10 * DAY);
    const [oldEvent, newEvent] = [`retention-old-${randomUUID()}`, `retention-new-${randomUUID()}`];
    await db.processedEvent.createMany({
      data: [
        { consumer: 'retention-test', eventId: oldEvent, processedAt: old },
        { consumer: 'retention-test', eventId: newEvent, processedAt: recent },
      ],
    });

    const r = await applyRetention(db);
    expect(r.ran).toBe(true);
    expect(r.droppedPartitions).toEqual(
      expect.arrayContaining(['audit_logs_2020_01', 'notifications_2020_01']),
    );
    // 12 months old: still inside the 13-month notification period.
    const lastYear = `notifications_${new Date().getUTCFullYear() - 1}_${String(new Date().getUTCMonth() + 1).padStart(2, '0')}`;
    expect(r.droppedPartitions).not.toContain(lastYear);
    const current = `audit_logs_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;
    expect(r.droppedPartitions).not.toContain(current);

    expect(await db.processedEvent.count({ where: { eventId: oldEvent } })).toBe(0);
    expect(await db.processedEvent.count({ where: { eventId: newEvent } })).toBe(1);
    const audit = await db.auditLog.findFirst({
      where: { action: 'retention.applied' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.newValues).toMatchObject({
      ran: true,
      droppedPartitions: expect.arrayContaining(['audit_logs_2020_01']),
    });
  });

  it('the app can run the schedule but not shorten it, nor drop a month itself', async () => {
    await expect(db.$executeRawUnsafe('DROP TABLE partitions.notifications_default')).rejects.toThrow(
      /must be owner/,
    );
    await expect(db.$queryRawUnsafe('SELECT drop_expired_partitions(1)')).rejects.toThrow(/does not exist/);
  });
});
