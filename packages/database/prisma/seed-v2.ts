/**
 * Development data for database v2 (docs/DATABASE.md §15, D2e): the same world as the v1 seed
 * (prisma/seed.ts: 4 cities, 20 businesses, 71 people, 200 appointments, reviews, queues), written
 * the way the services will write it (D3):
 *
 *  • IDs from a leased generator (DB-002); every person and business placed by the registry
 *    (registry.place, DB-011) on the shard that holds its ID;
 *  • emails, phones, slugs and public IDs claimed as global handles (DB-018), contact details
 *    encrypted as bytes with 16-byte blind indexes (DB-008);
 *  • a booking claims the customer's time on their shard first (DB-014), then writes the
 *    appointment on the business's shard (its index refuses double booking, DB-024), then the
 *    customer's own list;
 *  • business-shard writes scoped to one business (row-level security, DB-020); the catalog filled
 *    as search will fill it (DB-041).
 *
 * Signs in as buku_app (the tools' role), so everything passes the same rights and policies as
 * real traffic. Idempotent (skips when the admin's email is already claimed); refuses production.
 * Run after provisioning: `pnpm db:seed:v2` (the db-shards container does it on `pnpm dev`).
 */
import { hostname } from 'node:os';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import {
  createBlindIndexer,
  createFieldCipher,
  generateConfirmationCode,
  hashPassword,
  normalizeEmail,
  normalizePhone,
  parseKeyring,
  publicId,
} from '@buku/common';
import {
  createBusinessShardClient,
  createCatalogClient,
  createDirectoryClient,
  createUserShardClient,
  forBusiness,
  LeasedIdGenerator,
  ShardClients,
  ShardRouter,
  shardUrl,
  type BusinessShardClient,
  type UserShardClient,
} from '../src/index.js';
import {
  BUSINESS_NAMES,
  CITIES,
  createRandom,
  FIRST,
  LAST,
  pktToUtc,
  SERVICE_MENUS,
  slugify,
} from './seed-data.js';

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a production database.');
  process.exit(1);
}
const rootEnv = resolve(import.meta.dirname, '../../../.env');
if (!process.env.DATABASE_DIRECTORY_URL && existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });
const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required (run pnpm bootstrap)`);
  return value;
};

const DEMO_PASSWORD = 'buku-dev-password-2026';
const appPassword = required('BUKU_APP_PASSWORD');
const local = (database: string) =>
  `postgresql://buku_app:${encodeURIComponent(appPassword)}@localhost:${process.env.POSTGRES_HOST_PORT ?? '5432'}/${database}`;
const directoryUrl = process.env.DATABASE_DIRECTORY_URL ?? local('buku_directory');
const catalogUrl = process.env.DATABASE_CATALOG_URL ?? local('buku_catalog');
const app = { user: 'buku_app', password: appPassword };

const cipher = createFieldCipher(
  parseKeyring(required('PII_ENCRYPTION_KEYS'), process.env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? 'k1'),
);
const indexer = createBlindIndexer(Buffer.from(required('PII_BLIND_INDEX_KEY'), 'base64'));
const { rand, pick, int } = createRandom(20261017);
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;

const directory = createDirectoryClient({ url: directoryUrl, applicationName: 'seed-v2' });
const catalog = createCatalogClient({ url: catalogUrl, applicationName: 'seed-v2' });
const router = new ShardRouter(directory);
const users = new ShardClients<UserShardClient>(router, 'user', (s) =>
  createUserShardClient({ url: shardUrl(s, app), applicationName: 'seed-v2' }),
);
const shops = new ShardClients<BusinessShardClient>(router, 'business', (s) =>
  createBusinessShardClient({ url: shardUrl(s, app), applicationName: 'seed-v2' }),
);
const ids = new LeasedIdGenerator(directory, { instance: `seed-v2:${hostname()}:${process.pid}`, region: 0 });

/** Claim a global handle (DB-018); on a fresh world it is always free. */
async function claim(kind: string, key: Buffer, owner: bigint) {
  const rows = await directory.$queryRaw<{ claimed: boolean }[]>`
    SELECT claimed FROM lookup.claim(${kind}, ${key}, ${owner}::bigint)`;
  if (!rows[0]?.claimed) throw new Error(`the ${kind} handle is taken`);
}

interface Person {
  id: bigint;
  name: string;
}

/** A person: placed, their handles claimed, their row and preferences on their shard. */
async function person(
  name: string,
  role: string,
  email: string | null,
  phone: string | null,
  passwordHash: string | null,
) {
  const id = ids.next();
  const shard = await router.place('user', id);
  const pid = publicId();
  await claim('user.public_id', Buffer.from(pid, 'ascii'), id);
  const now = new Date();
  const contact: Record<string, unknown> = {};
  if (email) {
    const e = normalizeEmail(email);
    const hash = indexer.digest16('users.email', e);
    await claim('user.email', hash, id);
    Object.assign(contact, {
      emailHash: hash,
      emailEnc: cipher.encryptBytes(e, 'users.email'),
      emailVerifiedAt: now,
    });
  }
  if (phone) {
    const p = normalizePhone(phone);
    const hash = indexer.digest16('users.phone', p);
    await claim('user.phone', hash, id);
    Object.assign(contact, {
      phoneHash: hash,
      phoneEnc: cipher.encryptBytes(p, 'users.phone'),
      phoneVerifiedAt: now,
    });
  }
  const db = users.forShard(shard);
  await db.user.create({
    data: {
      id,
      publicId: pid,
      name,
      role,
      passwordHash,
      termsVersion: '1.0',
      termsAcceptedAt: now,
      ...contact,
    },
  });
  await db.notificationPreference.create({ data: { userId: id } });
  return { id, name } satisfies Person;
}

async function main(): Promise<void> {
  const adminHash = indexer.digest16('users.email', normalizeEmail('admin@buku.dev'));
  const seeded = await directory.$queryRaw<
    { owner: bigint | null }[]
  >`SELECT lookup.find('user.email', ${adminHash}) AS owner`;
  if (seeded[0]?.owner) {
    console.log('seed-v2: skipped, data already present');
    return;
  }
  await router.refresh();
  await ids.start();
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // ── Kinds of business, from the reference data ──
  const kinds = new Map(
    (
      await directory.category.findMany({
        where: { depth: 1, pending: false },
        select: { id: true, name: true },
      })
    ).map((c) => [c.name, c.id] as const),
  );
  const missing = BUSINESS_NAMES.map(([kind]) => kind).filter((k) => !kinds.has(k));
  if (missing.length)
    throw new Error(`kinds of business missing (run the directory migrations): ${missing.join(', ')}`);

  // ── People ──
  const admin = await person('BUKU Admin', 'super_admin', 'admin@buku.dev', null, passwordHash);
  const owners: Person[] = [];
  for (let i = 0; i < 20; i++)
    owners.push(await person(personName(), 'business_owner', `owner${i + 1}@buku.dev`, null, passwordHash));
  const customers: Person[] = [];
  for (let i = 0; i < 50; i++) {
    const withEmail = i % 3 !== 0;
    customers.push(
      await person(
        personName(),
        'user',
        withEmail ? `customer${i + 1}@buku.dev` : null,
        `+92300${String(1000000 + i).padStart(7, '0')}`,
        withEmail ? passwordHash : null,
      ),
    );
  }

  // ── Businesses: placed, handles claimed, everything on their shard in one scoped transaction ──
  interface Shop {
    id: bigint;
    name: string;
    queue: boolean;
    services: { id: bigint; name: string; duration: number; buffer: number; priceMinor: bigint }[];
    staff: bigint[];
    holiday: { id: bigint; date: Date };
  }
  const businesses: Shop[] = [];
  for (const [i, [kind, name]] of BUSINESS_NAMES.entries()) {
    const city = CITIES[i % CITIES.length]!;
    const owner = owners[i]!;
    const id = ids.next();
    const shard = await router.place('business', id);
    const slug = `${slugify(name)}-${slugify(city.city)}`;
    const pid = publicId();
    await claim('business.slug', Buffer.from(slug, 'utf8'), id);
    await claim('business.public_id', Buffer.from(pid, 'ascii'), id);
    const verified = i < 17;
    const queue = i < 5;
    const menu = SERVICE_MENUS[kind]!;
    const services = menu.map(([serviceName, duration, price], s) => ({
      id: ids.next(),
      name: serviceName,
      duration,
      buffer: duration >= 60 ? 15 : 5,
      priceMinor: BigInt(price) * 100n, // PKR has 2 decimals (reference.currencies)
      group: s < 2 ? 0 : 1,
      sortOrder: s,
    }));
    const groups = [ids.next(), ids.next()] as const;
    const staffRows = Array.from({ length: 5 }, (_, s) => ({
      id: ids.next(),
      userId: s === 0 ? owner.id : null,
      displayName: s === 0 ? owner.name : personName(),
      specializations: [menu[s % menu.length]![0]],
    }));
    const holiday = { id: ids.next(), date: new Date(today.getTime() + 7 * 86_400_000) };
    const lat = +(city.lat + (rand() - 0.5) * 0.08).toFixed(6);
    const lng = +(city.lng + (rand() - 0.5) * 0.08).toFixed(6);
    await shops.forShard(shard).$transaction(async (tx) => {
      await forBusiness(tx, id);
      await tx.business.create({
        data: {
          id,
          ownerUserId: owner.id,
          categoryId: kinds.get(kind)!,
          publicId: pid,
          slug,
          name,
          description: `${name} is a trusted ${kind.toLowerCase()} in ${city.city}. Book online or join the live queue with BUKU.`,
          phone: `${city.phone}${String(3000000 + i * 137).slice(0, 7)}`,
          email: `hello@${slugify(name)}.pk`,
          address: `${int(1, 250)} Main Boulevard, Block ${pick(['A', 'B', 'C', 'D'])}`,
          city: city.city,
          state: city.state,
          country: 'PK',
          postalCode: String(int(44000, 75999)),
          lat,
          lng,
          timezone: 'Asia/Karachi',
          currency: 'PKR',
          status: verified ? 'verified' : 'pending',
          verifiedAt: verified ? now : null,
          businessTermsVersion: '1.0',
          businessTermsAcceptedAt: now,
        },
      });
      // Mon–Sat 09:00–18:00, Sunday closed.
      await tx.businessHours.createMany({
        data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          id: ids.next(),
          businessId: id,
          dayOfWeek: d,
          openTime: '09:00',
          closeTime: '18:00',
          isClosed: d === 0,
        })),
      });
      await tx.availabilityRule.createMany({
        data: [1, 2, 3, 4, 5, 6].map((d) => ({
          id: ids.next(),
          businessId: id,
          dayOfWeek: d,
          startTime: '09:00',
          endTime: '18:00',
        })),
      });
      // Every other business approves bookings by hand.
      await tx.bookingSettings.create({
        data: { businessId: id, confirmationMode: i % 2 === 0 ? 'automatic' : 'manual' },
      });
      if (queue) await tx.queueSettings.create({ data: { businessId: id } });
      await tx.serviceGroup.createMany({
        data: [
          { id: groups[0], businessId: id, name: 'Popular', sortOrder: 0 },
          { id: groups[1], businessId: id, name: 'More services', sortOrder: 1 },
        ],
      });
      await tx.service.createMany({
        data: services.map((s) => ({
          id: s.id,
          businessId: id,
          groupId: groups[s.group],
          priceMinor: s.priceMinor,
          durationMinutes: s.duration,
          bufferMinutes: s.buffer,
          sortOrder: s.sortOrder,
          currency: 'PKR',
          name: s.name,
        })),
      });
      await tx.staff.createMany({ data: staffRows.map((st) => ({ ...st, businessId: id })) });
      await tx.staffService.createMany({
        data: staffRows.flatMap((st) =>
          services.map((sv) => ({ staffId: st.id, serviceId: sv.id, businessId: id })),
        ),
      });
      // Staff schedules (the fifth works mornings only); a public holiday next week.
      await tx.availabilityRule.createMany({
        data: staffRows.flatMap((st, s) =>
          [1, 2, 3, 4, 5, 6].map((d) => ({
            id: ids.next(),
            businessId: id,
            staffId: st.id,
            dayOfWeek: d,
            startTime: '09:00',
            endTime: s === 4 ? '13:00' : '18:00',
          })),
        ),
      });
      await tx.availabilityException.create({
        data: {
          id: holiday.id,
          businessId: id,
          exceptionDate: holiday.date,
          type: 'holiday',
          reason: 'Public holiday',
        },
      });
    });
    // The owner's view of their businesses, on their own shard (DB-014).
    await (
      await users.forId(owner.id)
    ).userBusinessRole.create({
      data: {
        userId: owner.id,
        businessId: id,
        version: 1n,
        role: 'owner',
        status: 'active',
        businessName: name,
      },
    });
    businesses.push({ id, name, queue, services, staff: staffRows.map((s) => s.id), holiday });
  }

  // ── Appointments: the customer's time first, then the business's book, then their list ──
  interface Booked {
    id: bigint;
    startAt: Date;
    endAt: Date;
    blockedUntil: Date;
    staffId: bigint;
    userId: bigint;
    businessId: bigint;
    code: string;
    status: string;
  }
  const appointments: Booked[] = [];
  const codes = new Set<string>();
  const completed: Booked[] = [];
  for (let n = 0; appointments.length < 200 && n < 10_000; n++) {
    const biz = pick(businesses);
    const staffId = pick(biz.staff);
    const service = pick(biz.services);
    const day = new Date(today.getTime() + int(-30, 14) * 86_400_000);
    if (day.getUTCDay() === 0) continue; // closed on Sundays
    const startMinute = 9 * 60 + int(0, 16) * 30;
    if (startMinute + service.duration + service.buffer > 18 * 60) continue;
    const startAt = pktToUtc(day, Math.floor(startMinute / 60), startMinute % 60);
    const endAt = new Date(startAt.getTime() + service.duration * 60_000);
    const blockedUntil = new Date(endAt.getTime() + service.buffer * 60_000);
    const customer = pick(customers);
    // The employee is busy until the clean-up is done; a person can't be in two places at once.
    const clash = appointments.some(
      (a) =>
        (a.staffId === staffId && startAt < a.blockedUntil && blockedUntil > a.startAt) ||
        (a.userId === customer.id && startAt < a.endAt && endAt > a.startAt),
    );
    if (clash) continue;
    let code = generateConfirmationCode();
    while (codes.has(code)) code = generateConfirmationCode();
    codes.add(code);
    const roll = rand();
    const status =
      endAt < now
        ? roll < 0.8
          ? 'completed'
          : roll < 0.9
            ? 'cancelled'
            : 'no_show'
        : roll < 0.75
          ? 'confirmed'
          : 'pending';
    const id = ids.next();
    const pid = publicId();
    const live = status === 'pending' || status === 'confirmed';
    const userDb = await users.forId(customer.id);
    if (live) {
      // The claim's ID is its appointment's (D3d): a lapsed one is settled from the appointment.
      await userDb.userTimeReservation.create({
        data: { id, userId: customer.id, businessId: biz.id, appointmentId: id, startAt, endAt },
      });
    }
    await (
      await shops.forId(biz.id)
    ).$transaction(async (tx) => {
      await forBusiness(tx, biz.id);
      await tx.appointment.create({
        data: {
          id,
          startAt,
          endAt,
          blockedUntil,
          businessId: biz.id,
          userId: customer.id,
          serviceId: service.id,
          staffId,
          priceMinor: service.priceMinor,
          currency: 'PKR',
          publicId: pid,
          code,
          status,
          // The name the customer booked under: what the business's list shows and searches (D3d).
          customerName: customer.name,
          paymentStatus: status === 'completed' ? 'paid' : 'unpaid',
          ...(status === 'cancelled' && {
            cancelledAt: new Date(startAt.getTime() - 86_400_000),
            cancelledBy: 'user',
            cancelReason: 'Plans changed',
          }),
        },
      });
      const events = [
        {
          fromStatus: null as string | null,
          toStatus: 'pending',
          actorType: 'user',
          actorId: customer.id as bigint | null,
        },
      ];
      if (status !== 'pending') {
        events.push({
          fromStatus: 'pending',
          toStatus: status === 'cancelled' ? 'cancelled' : 'confirmed',
          actorType: status === 'cancelled' ? 'user' : 'business',
          actorId: null,
        });
      }
      if (status === 'completed' || status === 'no_show') {
        events.push({ fromStatus: 'confirmed', toStatus: status, actorType: 'business', actorId: null });
      }
      await tx.appointmentEvent.createMany({
        data: events.map((e) => ({
          id: ids.next(),
          businessId: biz.id,
          appointmentId: id,
          appointmentStartAt: startAt,
          ...e,
        })),
      });
    });
    await userDb.userAppointment.create({
      data: {
        userId: customer.id,
        appointmentId: id,
        businessId: biz.id,
        version: 1n,
        startAt,
        endAt,
        appointmentPublicId: pid,
        status,
        businessName: biz.name,
        serviceName: service.name,
      },
    });
    // How the visit ended, for the customer's reliability, on their own shard (D-078, D3d).
    if (status === 'completed' || status === 'no_show') {
      await userDb.userVisitOutcome.create({
        data: {
          userId: customer.id,
          refId: id,
          businessId: biz.id,
          happenedAt: startAt,
          kind: status === 'completed' ? 'visit' : 'no_show',
          source: 'appointment',
        },
      });
    }
    const booked = {
      id,
      startAt,
      endAt,
      blockedUntil,
      staffId,
      userId: customer.id,
      businessId: biz.id,
      code,
      status,
    };
    appointments.push(booked);
    if (status === 'completed') completed.push(booked);
  }

  // ── Reviews of completed visits (the trigger keeps each business's rating) ──
  const comments = [
    'Excellent service, on time and friendly.',
    'Very professional. Will book again.',
    'Good, but a short wait.',
    'Loved it!',
    'Clean place and great staff.',
    null,
  ];
  for (const c of completed.slice(0, 30)) {
    await (
      await shops.forId(c.businessId)
    ).$transaction(async (tx) => {
      await forBusiness(tx, c.businessId);
      await tx.review.create({
        data: {
          id: ids.next(),
          appointmentId: c.id,
          appointmentStartAt: c.startAt,
          businessId: c.businessId,
          userId: c.userId,
          overallRating: pick([3, 4, 4, 5, 5, 5]),
          waitTimeRating: pick([3, 4, 5]),
          staffRating: pick([4, 5]),
          cleanlinessRating: pick([4, 5]),
          valueRating: pick([3, 4, 5]),
          comment: pick(comments),
          createdAt: new Date(c.endAt.getTime() + 3 * 3_600_000),
        },
      });
    });
  }

  // ── Queues: the last 9 days and today, on the five businesses that run one ──
  const queueBusinesses = businesses.filter((b) => b.queue);
  const waitingToday = new Map<bigint, number>();
  for (let d = -9; d <= 0; d++) {
    const biz = queueBusinesses[(d + 9) % queueBusinesses.length]!;
    const sessionDate = new Date(today.getTime() + d * 86_400_000);
    const isToday = d === 0;
    const entries = int(8, 20);
    const served = isToday ? Math.floor(entries / 2) : entries - 2;
    const sessionId = ids.next();
    const active: { userId: bigint; ticketId: bigint; createdAt: Date }[] = [];
    await (
      await shops.forId(biz.id)
    ).$transaction(async (tx) => {
      await forBusiness(tx, biz.id);
      await tx.queueSession.create({
        data: {
          id: sessionId,
          businessId: biz.id,
          sessionDate,
          status: isToday ? 'open' : 'closed',
          currentNumber: entries,
          lastCalledNumber: served,
          totalServed: served,
          avgServiceSeconds: int(240, 600),
          openedAt: pktToUtc(sessionDate, 9, 0),
          closedAt: isToday ? null : pktToUtc(sessionDate, 18, 0),
        },
      });
      const used = new Set<bigint>();
      const tickets = Array.from({ length: entries }, (_, t) => {
        const ticket = t + 1;
        const joinedAt = new Date(pktToUtc(sessionDate, 9, 0).getTime() + t * 10 * 60_000);
        const status =
          ticket <= served ? 'completed' : isToday ? 'waiting' : ticket === entries ? 'no_show' : 'left';
        let userId: bigint | null = pick(customers).id;
        if (used.has(userId) || rand() < 0.2) userId = null; // walk-ins
        if (userId) used.add(userId);
        const id = ids.next();
        if (userId && status === 'waiting') active.push({ userId, ticketId: id, createdAt: sessionDate });
        return {
          id,
          sessionDate,
          sessionId,
          businessId: biz.id,
          userId,
          ticketNumber: ticket,
          status,
          priorityLane: rand() < 0.05,
          joinedAt,
          ...(status === 'completed' && {
            calledAt: new Date(joinedAt.getTime() + 15 * 60_000),
            servedAt: new Date(joinedAt.getTime() + 16 * 60_000),
            completedAt: new Date(joinedAt.getTime() + 25 * 60_000),
            actualServiceSeconds: 540,
          }),
        };
      });
      await tx.queueTicket.createMany({ data: tickets });
    });
    // One queue at a time per person (DB-014): today's waiting customers, on their shards.
    for (const a of active) {
      await (
        await users.forId(a.userId)
      ).userActiveTicket.create({
        data: {
          userId: a.userId,
          ticketId: a.ticketId,
          ticketCreatedAt: a.createdAt,
          businessId: biz.id,
          sessionId,
        },
      });
    }
    if (isToday) waitingToday.set(biz.id, entries - served);
  }

  // ── Favourites and notifications on people's shards; an audit entry ──
  const favs = new Set<string>();
  for (let i = 0; i < 60; i++) {
    const userId = pick(customers).id;
    const businessId = pick(businesses).id;
    if (favs.has(`${userId}:${businessId}`)) continue;
    favs.add(`${userId}:${businessId}`);
    await (await users.forId(userId)).favourite.create({ data: { userId, businessId } });
  }
  for (const [i, a] of appointments.slice(0, 40).entries()) {
    await (
      await users.forId(a.userId)
    ).notification.create({
      data: {
        id: ids.next(),
        createdAt: new Date(now.getTime() - i * 2 * 86_400_000),
        userId: a.userId,
        appointmentId: a.id,
        type: 'booking_confirmation',
        channel: 'in_app',
        title: 'Booking confirmed',
        body: `Your booking ${a.code} is confirmed.`,
        data: { screen: 'appointment', appointmentId: a.id.toString() },
        status: i % 3 === 0 ? 'read' : 'delivered',
      },
    });
  }
  await (
    await users.forId(admin.id)
  ).auditLog.create({
    data: {
      id: ids.next(),
      userId: admin.id,
      action: 'seed.completed',
      resourceType: 'system',
      newValues: { appointments: appointments.length },
    },
  });

  // ── The catalog, as search will keep it from events (DB-041) ──
  for (const b of businesses) {
    const row = await (
      await shops.forId(b.id)
    ).$transaction(async (tx) => {
      await forBusiness(tx, b.id);
      return tx.business.findUniqueOrThrow({ where: { id: b.id } });
    });
    await catalog.catalogBusiness.create({
      data: {
        businessId: b.id,
        categoryId: row.categoryId,
        version: ids.next(),
        minPriceMinor: b.services.reduce(
          (m, s) => (s.priceMinor < m ? s.priceMinor : m),
          b.services[0]!.priceMinor,
        ),
        createdAt: row.createdAt,
        lat: row.lat,
        lng: row.lng,
        avgRating: row.avgRating,
        reviewCount: row.reviewCount,
        verified: row.verifiedAt !== null,
        offersQueue: b.queue,
        publicId: row.publicId,
        slug: row.slug,
        name: row.name,
        status: row.status,
        country: row.country,
        currency: row.currency,
        timezone: row.timezone,
        city: row.city,
        address: row.address,
        description: row.description,
      },
    });
    await catalog.catalogService.createMany({
      data: b.services.map((s) => ({
        serviceId: s.id,
        businessId: b.id,
        version: 1n,
        priceMinor: s.priceMinor,
        currency: 'PKR',
        name: s.name,
      })),
    });
    await catalog.catalogHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        businessId: b.id,
        dayOfWeek: d,
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: d === 0,
      })),
    });
    await catalog.catalogClosure.create({
      data: { id: b.holiday.id, businessId: b.id, closureDate: b.holiday.date, type: 'holiday' },
    });
    if (waitingToday.has(b.id)) {
      await catalog.catalogQueue.create({
        data: {
          businessId: b.id,
          version: 1n,
          sessionDate: today,
          waiting: waitingToday.get(b.id)!,
          isOpen: true,
        },
      });
    }
  }

  // ── What landed where ──
  const spread = new Map<string, number>();
  for (const p of [admin, ...owners, ...customers]) {
    const s = await router.locate('user', p.id);
    spread.set(s.databaseName, (spread.get(s.databaseName) ?? 0) + 1);
  }
  // The world holds together: the registry counted every placement, every live appointment is
  // the customer's claimed time, every person is found again by their public ID.
  const placed = await directory.shard.groupBy({ by: ['entity'], _sum: { rowCount: true } });
  const count = (entity: string) => placed.find((p) => p.entity === entity)?._sum.rowCount ?? 0n;
  const live = appointments.filter((a) => a.status === 'pending' || a.status === 'confirmed').length;
  let claims = 0;
  for (const db of new Set(await Promise.all(customers.map((c) => users.forId(c.id))))) {
    claims += await db.userTimeReservation.count({ where: { appointmentId: { not: null } } });
  }
  const problems = [
    count('user') >= BigInt(1 + owners.length + customers.length) ? null : 'people placed',
    count('business') >= BigInt(businesses.length) ? null : 'businesses placed',
    claims === live ? null : `time claims (${claims}) for live appointments (${live})`,
  ].filter(Boolean);
  if (problems.length) throw new Error(`seed-v2: inconsistent: ${problems.join(', ')}`);

  console.log(
    `seed-v2: ${1 + owners.length + customers.length} people (${[...spread].map(([db, n]) => `${db}: ${n}`).join(', ')}), ` +
      `${businesses.length} businesses, ${appointments.length} appointments, ${Math.min(30, completed.length)} reviews, ` +
      `10 queue sessions; the catalog filled`,
  );
  console.log(
    `seed-v2: demo logins (dev only): admin@buku.dev, owner1@buku.dev, customer2@buku.dev, password "${DEMO_PASSWORD}"`,
  );
}

try {
  await main();
} finally {
  await ids.stop().catch(() => undefined);
  router.stop();
  await Promise.all([users.close(), shops.close(), catalog.$disconnect()]);
  await directory.$disconnect();
}
