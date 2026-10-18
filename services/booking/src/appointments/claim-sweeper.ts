import { logger } from '@buku/common';
import type { DataPlane } from '@buku/database';
import type { PersonSync } from './person-sync.js';

/**
 * Tidies what bookings leave on people's shards (DB-014, D3d), every minute:
 *  • a claim held for longer than its 2 minutes without its appointment is settled from the
 *    business's shard (a claim's ID is its appointment's): booked if the appointment exists after
 *    all, given back if not;
 *  • claims whose time has passed go;
 *  • reliability rows older than 13 months go (only the last 12 count, D-078).
 * Each step can run twice, from any number of replicas.
 */
const RETAIN_OUTCOMES_MS = 396 * 86_400_000;
const BATCH = 500;

export class ClaimSweeper {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly plane: DataPlane,
    private readonly persons: PersonSync,
    private readonly intervalMs = 60_000,
  ) {}

  async sweep(now = new Date()): Promise<{ settled: number; ended: number; forgotten: number }> {
    const totals = { settled: 0, ended: 0, forgotten: 0 };
    await this.plane.acrossUsers(async (db) => {
      const lapsed = await db.userTimeReservation.findMany({
        where: { expiresAt: { lt: now } },
        select: { id: true, userId: true, businessId: true },
        take: BATCH,
      });
      for (const claim of lapsed) {
        await this.persons.sync(claim.businessId, claim.id, claim.userId);
        totals.settled++;
      }
      totals.ended += (await db.userTimeReservation.deleteMany({ where: { endAt: { lt: now } } })).count;
      totals.forgotten += (
        await db.userVisitOutcome.deleteMany({
          where: { happenedAt: { lt: new Date(now.getTime() - RETAIN_OUTCOMES_MS) } },
        })
      ).count;
    });
    return totals;
  }

  start(): void {
    const tick = () => {
      this.sweep().catch((err: unknown) => logger.error({ err }, 'claim sweep failed'));
    };
    this.timer = setInterval(tick, this.intervalMs);
    this.timer.unref();
  }

  stop(): Promise<void> {
    clearInterval(this.timer);
    return Promise.resolve();
  }
}
