import { logger } from '@buku/common';
import { ShardNotFoundError, type BusinessTx, type CatalogClient, type DataPlane } from '@buku/database';

/**
 * The catalog (DB-041), kept from the business shards (D3h). The catalog is a read model: one row
 * per business with what discovery shows — its profile, kind, place, rating, menu (names and the
 * lowest price), opening hours, closures, cover and logo, and today's queue — across every
 * business shard, so search, "near me" and category pages are one query.
 *
 * A refresh reads the business as it is now on its shard and replaces its catalog rows. It runs
 * for every event that says something it shows changed (businesses.*, listings.changed, the
 * queue's events) and from the sweep that walks every business now and then (the repair, should
 * an event have been missed). Running it again, late or twice at once changes nothing: each write
 * carries a version taken before its read (a time-ordered ID), and an older one never replaces a
 * newer one. Ranking figures are the stats job's (catalog-stats.ts); a refresh leaves them alone.
 */

const DAY = 86_400_000;

export type Refreshed = 'updated' | 'stale' | 'gone';

export class CatalogSync {
  private readonly log = logger.child({ module: 'catalog-sync' });

  constructor(
    private readonly plane: DataPlane,
    /** Which day "today" is, for queues and closures (tests fix it). */
    private readonly now: () => Date = () => new Date(),
  ) {}

  private get catalog(): CatalogClient {
    if (!this.plane.catalog) throw new Error('search-service runs with the catalog (useCatalog)');
    return this.plane.catalog;
  }

  /** Bring one business's catalog rows up to date from its shard. */
  async refresh(businessId: bigint): Promise<Refreshed> {
    // Taken before the read: a read made later always carries a later version.
    const version = this.plane.id();
    const listing = await this.atShard(businessId, (tx) => readListing(tx, businessId, this.now()));
    return this.catalog.$transaction(async (tx) => {
      // One writer per business at a time; the version decides who is newer.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${businessId})`;
      const current = await tx.catalogBusiness.findUnique({
        where: { businessId },
        select: { version: true },
      });
      if (current && current.version >= version) return 'stale';
      if (!listing) {
        // Deleted (or never placed): no longer discoverable. Its rows go with it.
        if (current) await tx.catalogBusiness.delete({ where: { businessId } });
        return 'gone';
      }
      const { business, services, hours, closures, queue } = listing;
      await tx.catalogBusiness.upsert({
        where: { businessId },
        create: { businessId, version, ...business },
        update: { version, ...business },
      });
      await tx.catalogService.deleteMany({ where: { businessId } });
      if (services.length)
        await tx.catalogService.createMany({
          data: services.map((s) => ({ ...s, businessId, version })),
        });
      await tx.catalogHours.deleteMany({ where: { businessId } });
      if (hours.length) await tx.catalogHours.createMany({ data: hours.map((h) => ({ ...h, businessId })) });
      await tx.catalogClosure.deleteMany({ where: { businessId } });
      if (closures.length)
        await tx.catalogClosure.createMany({ data: closures.map((c) => ({ ...c, businessId })) });
      await writeQueue(tx, businessId, version, queue);
      return 'updated';
    });
  }

  /** Only today's queue (a ticket taken or called): the cheap path, many times a day. */
  async refreshQueue(businessId: bigint): Promise<Refreshed> {
    const version = this.plane.id();
    const state = await this.atShard(businessId, async (tx) => {
      const b = await tx.business.findFirst({
        where: { id: businessId, deletedAt: null },
        select: { timezone: true },
      });
      return b ? readQueue(tx, businessId, b.timezone, this.now()) : null;
    });
    if (!state) return this.refresh(businessId);
    const done = await this.catalog.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${businessId})`;
      const listed = await tx.catalogBusiness.findUnique({
        where: { businessId },
        select: { offersQueue: true },
      });
      if (!listed) return null; // not in the catalog yet: the whole row first
      if (listed.offersQueue !== state.offersQueue)
        await tx.catalogBusiness.update({ where: { businessId }, data: { offersQueue: state.offersQueue } });
      return writeQueue(tx, businessId, version, state);
    });
    return done ?? this.refresh(businessId);
  }

  /** Work on the business's shard; a business placed nowhere reads as gone. */
  private async atShard<T>(
    businessId: bigint,
    work: (tx: BusinessTx) => Promise<T | null>,
  ): Promise<T | null> {
    try {
      return await this.plane.inBusiness(businessId, work);
    } catch (err) {
      if (err instanceof ShardNotFoundError) {
        this.log.warn({ businessId: businessId.toString() }, 'a business placed nowhere was announced');
        return null;
      }
      throw err;
    }
  }
}

interface QueueState {
  offersQueue: boolean;
  today: { sessionDate: Date; isOpen: boolean; waiting: number } | null;
}

/** The business as discovery shows it, read in its own transaction; null once it's deleted. */
async function readListing(tx: BusinessTx, businessId: bigint, now: Date) {
  const b = await tx.business.findFirst({ where: { id: businessId } });
  if (!b || b.deletedAt) return null;
  const services = await tx.service.findMany({
    where: { businessId, isActive: true },
    select: { id: true, name: true, priceMinor: true, currency: true },
  });
  const hours = await tx.businessHours.findMany({
    where: { businessId },
    select: { dayOfWeek: true, isClosed: true, openTime: true, closeTime: true },
  });
  // Business-wide closures from yesterday on (any timezone's today is covered); staff time off
  // and extra hours don't change when the business is open.
  const closures = await tx.availabilityException.findMany({
    where: {
      businessId,
      staffId: null,
      resourceId: null,
      type: { in: ['holiday', 'modified'] },
      exceptionDate: { gte: new Date(now.getTime() - DAY) },
    },
    select: { id: true, exceptionDate: true, type: true, startTime: true, endTime: true },
  });
  const cover = await tx.businessPhoto.findFirst({
    where: { businessId, uploadedAt: { not: null } },
    orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    select: { storageKey: true },
  });
  const queue = await readQueue(tx, businessId, b.timezone, now);
  const prices = services.filter((s) => s.currency === b.currency).map((s) => s.priceMinor);
  return {
    business: {
      categoryId: b.categoryId,
      minPriceMinor: prices.length ? prices.reduce((m, p) => (p < m ? p : m)) : null,
      createdAt: b.createdAt,
      lat: b.lat,
      lng: b.lng,
      avgRating: b.avgRating,
      reviewCount: b.reviewCount,
      verified: b.status === 'verified',
      offersQueue: queue.offersQueue,
      publicId: b.publicId,
      slug: b.slug,
      name: b.name,
      status: b.status,
      country: b.country,
      currency: b.currency,
      timezone: b.timezone,
      city: b.city,
      address: b.address,
      description: b.description,
      logoStorageKey: b.logoStorageKey,
      coverStorageKey: cover?.storageKey ?? null,
    },
    services: services.map((s) => ({
      serviceId: s.id,
      name: s.name,
      priceMinor: s.priceMinor,
      currency: s.currency,
    })),
    hours,
    closures: closures.map((c) => ({
      id: c.id,
      closureDate: c.exceptionDate,
      type: c.type,
      startTime: c.startTime,
      endTime: c.endTime,
    })),
    queue,
  };
}

/** Whether it runs a queue, and today's (open or paused, and how many are waiting). */
async function readQueue(
  tx: BusinessTx,
  businessId: bigint,
  timezone: string,
  now: Date,
): Promise<QueueState> {
  const sessionDate = new Date(`${localDate(timezone, now)}T00:00:00Z`);
  const settings = await tx.queueSettings.count({ where: { businessId } });
  const session = await tx.queueSession.findUnique({
    where: { businessId_sessionDate: { businessId, sessionDate } },
    select: { id: true, status: true },
  });
  const offersQueue =
    settings > 0 || session !== null || (await tx.queueSession.count({ where: { businessId } })) > 0;
  if (!session) return { offersQueue, today: null };
  const waiting = await tx.queueTicket.count({
    where: { sessionId: session.id, sessionDate, status: 'waiting' },
  });
  return { offersQueue, today: { sessionDate, isOpen: session.status === 'open', waiting } };
}

/** Today's queue row: replaced only by a newer version; no session today means no row. */
async function writeQueue(
  tx: Parameters<Parameters<CatalogClient['$transaction']>[0]>[0],
  businessId: bigint,
  version: bigint,
  queue: QueueState,
): Promise<Refreshed> {
  const current = await tx.catalogQueue.findUnique({ where: { businessId }, select: { version: true } });
  if (current && current.version >= version) return 'stale';
  if (!queue.today) {
    if (current) await tx.catalogQueue.delete({ where: { businessId } });
    return 'updated';
  }
  await tx.catalogQueue.upsert({
    where: { businessId },
    create: { businessId, version, ...queue.today },
    update: { version, ...queue.today },
  });
  return 'updated';
}

/** Today's date (YYYY-MM-DD) where the business is. */
function localDate(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
