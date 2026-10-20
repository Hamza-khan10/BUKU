import { createEvent, TOPICS } from '@buku/kafka';
import { describe, expect, it } from 'vitest';
import { refreshSearchStats, sweepCatalog } from '../src/catalog/catalog-stats.js';
import { searchEventHandler } from '../src/events/handlers.js';
import { useSearchHarness, word } from './harness.js';

/**
 * Keeping the catalog (DB-041) from the business shard (D3h): what a refresh copies, that an older
 * read never replaces a newer one, the queue's cheap path, the events, the ranking figures and the
 * sweep. Today is fixed at Wednesday 7 October 2026 (harness.ts).
 */

const h = useSearchHarness();
const catalog = () => h.plane.catalog!;
const TODAY = new Date('2026-10-07T00:00:00Z');
const ctx = { topic: 'test', partition: 0, offset: '0', key: null, attempt: 1 };

describe('A refresh', () => {
  it('copies what discovery shows: the menu (lowest active price in its currency), hours, closures from yesterday on, cover and logo', async () => {
    const p = await h.place({
      name: `${word()} Copied`,
      services: [
        { name: 'Cut', price: 50_000 },
        { name: 'Old cut', price: 10_000, active: false },
      ],
      hours: [{ day: 3, open: '09:00', close: '17:00' }],
    });
    await h.world.inBusiness(p.id, async (tx) => {
      await tx.service.create({
        data: {
          id: h.world.id(),
          businessId: p.id,
          name: 'Priced in dollars',
          durationMinutes: 30,
          priceMinor: 100n,
          currency: 'USD',
        },
      });
      const closure = (daysFromToday: number, type: string) =>
        tx.availabilityException.create({
          data: {
            id: h.world.id(),
            businessId: p.id,
            exceptionDate: new Date(TODAY.getTime() + daysFromToday * 86_400_000),
            type,
            ...(type === 'extra_hours' && { startTime: '18:00', endTime: '20:00' }),
          },
        });
      await closure(-3, 'holiday'); // over: not copied
      await closure(0, 'holiday');
      await closure(5, 'extra_hours'); // more hours, never fewer: not a closure
      // A photo still being uploaded never becomes the cover.
      await tx.businessPhoto.create({
        data: {
          id: h.world.id(),
          businessId: p.id,
          storageKey: `businesses/${p.publicId}/pending.webp`,
          contentType: 'image/webp',
          sizeBytes: 1000,
          isPrimary: true,
        },
      });
      await tx.businessPhoto.create({
        data: {
          id: h.world.id(),
          businessId: p.id,
          storageKey: `businesses/${p.publicId}/cover.webp`,
          contentType: 'image/webp',
          sizeBytes: 1000,
          uploadedAt: new Date(),
        },
      });
      await tx.business.update({
        where: { id: p.id },
        data: { logoStorageKey: `businesses/${p.publicId}/logo.webp` },
      });
    });
    expect(await h.sync.refresh(p.id)).toBe('updated');

    const row = await catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } });
    expect(row).toMatchObject({
      publicId: p.publicId,
      slug: p.slug,
      minPriceMinor: 50_000n,
      currency: 'EUR',
      verified: false,
      offersQueue: false,
      coverStorageKey: `businesses/${p.publicId}/cover.webp`,
      logoStorageKey: `businesses/${p.publicId}/logo.webp`,
    });
    const services = await catalog().catalogService.findMany({ where: { businessId: p.id } });
    expect(services.map((s) => s.name).sort()).toEqual(['Cut', 'Priced in dollars']);
    expect(await catalog().catalogHours.findMany({ where: { businessId: p.id } })).toHaveLength(1);
    const closures = await catalog().catalogClosure.findMany({ where: { businessId: p.id } });
    expect(closures.map((c) => [c.closureDate, c.type])).toEqual([[TODAY, 'holiday']]);
  });

  it('an older read never replaces a newer one; refreshes at the same time agree', async () => {
    const p = await h.place({ name: `${word()} Versioned` });
    // A row written from a later read than any refresh started now.
    await catalog().catalogBusiness.update({
      where: { businessId: p.id },
      data: { version: 2n ** 62n, name: 'Newer' },
    });
    expect(await h.sync.refresh(p.id)).toBe('stale');
    expect((await catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } })).name).toBe(
      'Newer',
    );

    await catalog().catalogBusiness.update({ where: { businessId: p.id }, data: { version: 1n } });
    const results = await Promise.all(Array.from({ length: 5 }, () => h.sync.refresh(p.id)));
    expect(results).toContain('updated');
    expect(results.every((r) => r === 'updated' || r === 'stale')).toBe(true);
    const row = await catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } });
    expect(row.name).toMatch(/ Versioned$/);
    expect(await catalog().catalogService.count({ where: { businessId: p.id } })).toBe(1);
  });

  it('a deleted business leaves the catalog with its rows; one placed nowhere is simply gone', async () => {
    const p = await h.place({
      name: `${word()} Closing Down`,
      hours: [{ day: 1, open: '10:00', close: '12:00' }],
    });
    await h.world.inBusiness(p.id, (tx) =>
      tx.business.update({ where: { id: p.id }, data: { deletedAt: new Date() } }),
    );
    expect(await h.sync.refresh(p.id)).toBe('gone');
    expect(await catalog().catalogBusiness.findUnique({ where: { businessId: p.id } })).toBeNull();
    expect(await catalog().catalogService.count({ where: { businessId: p.id } })).toBe(0);
    expect(await catalog().catalogHours.count({ where: { businessId: p.id } })).toBe(0);

    expect(await h.sync.refresh(h.world.id())).toBe('gone');
  });
});

describe("Today's queue", () => {
  it('opened, joined, called and closed — only its row; a business not listed yet gets its whole row', async () => {
    const p = await h.place({ name: `${word()} Walk-ins`, services: [] });
    const sessionId = h.world.id();
    const ticket = (n: number) =>
      h.world.inBusiness(p.id, (tx) =>
        tx.queueTicket.create({
          data: {
            id: h.world.id(),
            sessionId,
            sessionDate: TODAY,
            businessId: p.id,
            ticketNumber: n,
            walkInName: `Walk-in ${n}`,
          },
        }),
      );
    const queue = () => catalog().catalogQueue.findUnique({ where: { businessId: p.id } });

    await h.world.inBusiness(p.id, (tx) =>
      tx.queueSession.create({
        data: { id: sessionId, businessId: p.id, sessionDate: TODAY, status: 'open' },
      }),
    );
    const first = await ticket(1);
    await ticket(2);
    expect(await h.sync.refreshQueue(p.id)).toBe('updated');
    expect(await queue()).toMatchObject({ sessionDate: TODAY, isOpen: true, waiting: 2 });
    expect(
      (await catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } })).offersQueue,
    ).toBe(true);

    await h.world.inBusiness(p.id, (tx) =>
      tx.queueTicket.update({
        where: { id_sessionDate: { id: first.id, sessionDate: TODAY } },
        data: { status: 'called', calledAt: new Date() },
      }),
    );
    await h.sync.refreshQueue(p.id);
    expect(await queue()).toMatchObject({ isOpen: true, waiting: 1 });

    await h.world.inBusiness(p.id, (tx) =>
      tx.queueSession.update({ where: { id: sessionId }, data: { status: 'closed', closedAt: new Date() } }),
    );
    await h.sync.refreshQueue(p.id);
    expect(await queue()).toMatchObject({ isOpen: false });

    const later = await h.place({
      name: `${word()} Not Listed Yet`,
      queue: 'open',
      waiting: 1,
      unlisted: true,
    });
    expect(await h.sync.refreshQueue(later.id)).toBe('updated');
    expect(await catalog().catalogBusiness.findUnique({ where: { businessId: later.id } })).not.toBeNull();
    expect(await catalog().catalogQueue.findUnique({ where: { businessId: later.id } })).toMatchObject({
      waiting: 1,
    });
  });
});

describe('Events', () => {
  const handle = () => (event: ReturnType<typeof createEvent>) =>
    searchEventHandler({ sync: h.sync })(event, ctx);
  const about = (type: Parameters<typeof createEvent>[0]['type'], businessId: string) =>
    createEvent({ type, source: 'test', subject: businessId, data: { businessId } });

  it('each one names a business whose row is refreshed; others are ignored; a malformed one is refused', async () => {
    const p = await h.place({ name: `${word()} Announced`, unlisted: true });
    await handle()(about(TOPICS.BUSINESSES_CREATED, p.id.toString()));
    expect(await catalog().catalogBusiness.findUnique({ where: { businessId: p.id } })).not.toBeNull();

    await h.world.inBusiness(p.id, (tx) => tx.queueSettings.create({ data: { businessId: p.id } }));
    await handle()(about(TOPICS.QUEUE_SETTINGS_UPDATED, p.id.toString()));
    expect(
      (await catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } })).offersQueue,
    ).toBe(true);

    await expect(handle()(about(TOPICS.USERS_DELETED, 'anything'))).resolves.toBeUndefined();
    await expect(handle()(about(TOPICS.LISTINGS_CHANGED, 'not-an-id'))).rejects.toThrow();
  });
});

describe('Ranking figures and the sweep', () => {
  it("are computed on each shard and copied onto the catalog's rows; a refresh leaves them alone", async () => {
    const p = await h.place({ name: `${word()} Busy Week` });
    for (let i = 1; i <= 3; i++) await h.appointment(p, { status: 'confirmed', daysAgo: -i });
    expect(await refreshSearchStats(h.plane)).toBeGreaterThan(0);
    const figures = () => catalog().catalogBusiness.findUniqueOrThrow({ where: { businessId: p.id } });
    expect((await figures()).bookings7d).toBe(3);
    await h.sync.refresh(p.id);
    expect((await figures()).bookings7d).toBe(3);
  });

  it('the sweep lists a business no event brought, and drops one deleted since', async () => {
    const missed = await h.place({ name: `${word()} Missed`, unlisted: true });
    const deleted = await h.place({ name: `${word()} Deleted Since` });
    await h.world.inBusiness(deleted.id, (tx) =>
      tx.business.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } }),
    );
    const totals = await sweepCatalog(h.plane, h.sync);
    expect(totals.failed).toBe(0);
    expect(totals.refreshed).toBeGreaterThanOrEqual(2);
    expect(await catalog().catalogBusiness.findUnique({ where: { businessId: missed.id } })).not.toBeNull();
    expect(await catalog().catalogBusiness.findUnique({ where: { businessId: deleted.id } })).toBeNull();
  });
});
