/**
 * Development seed data. Deterministic (fixed PRNG seed), idempotent (skips
 * if data exists) and REFUSES to run in production.
 *
 *   20 businesses in 4 Pakistani cities · 1 admin · 20 owners · 50 customers · 5 staff per business ·
 *   ~200 appointments that respect every DB constraint · 30 reviews ·
 *   10 queue sessions · favourites, notifications, audit entries.
 *
 * Contact details are encrypted + blind-indexed exactly as auth-service will
 * do it, so the seed exercises the real PII path.
 */
import {
  createBlindIndexer,
  createFieldCipher,
  generateConfirmationCode,
  hashPassword,
  normalizeEmail,
  normalizePhone,
  parseKeyring,
  uuidv7,
} from '@buku/common';
import { createDatabaseClient, type Prisma } from '../src/index.js';
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

const DEMO_PASSWORD = 'buku-dev-password-2026';
const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL is required');
if (!process.env.PII_ENCRYPTION_KEYS || !process.env.PII_BLIND_INDEX_KEY) {
  throw new Error('PII_ENCRYPTION_KEYS and PII_BLIND_INDEX_KEY are required (run `pnpm bootstrap`)');
}

const db = createDatabaseClient({ url, applicationName: 'seed', maxConnections: 4 });
const cipher = createFieldCipher(
  parseKeyring(process.env.PII_ENCRYPTION_KEYS, process.env.PII_ENCRYPTION_ACTIVE_KEY_ID ?? 'k1'),
);
const indexer = createBlindIndexer(Buffer.from(process.env.PII_BLIND_INDEX_KEY, 'base64'));

const { rand, pick, int } = createRandom(20260929);
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;

function contact(email: string | null, phone: string | null) {
  return {
    ...(email && {
      emailEncrypted: cipher.encrypt(normalizeEmail(email), 'users.email'),
      emailHash: indexer.hash('users.email', normalizeEmail(email)),
      emailVerifiedAt: new Date(),
    }),
    ...(phone && {
      phoneEncrypted: cipher.encrypt(normalizePhone(phone), 'users.phone'),
      phoneHash: indexer.hash('users.phone', normalizePhone(phone)),
      phoneVerifiedAt: new Date(),
    }),
  };
}

async function main(): Promise<void> {
  if ((await db.business.count()) > 0) {
    console.log('Seed skipped: data already present (use `pnpm dev:wipe` for a fresh database).');
    return;
  }
  console.log('Seeding development data...');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // ── Categories (from the migrations) ──
  const leafCategoryIds = new Map(
    (
      await db.category.findMany({ where: { depth: 1, pending: false }, select: { id: true, name: true } })
    ).map((c) => [c.name, c.id] as const),
  );
  const unknown = BUSINESS_NAMES.map(([leaf]) => leaf).filter((leaf) => !leafCategoryIds.has(leaf));
  if (unknown.length > 0) {
    throw new Error(`Categories missing (run the migrations first): ${unknown.join(', ')}`);
  }

  // ── Users ──
  const users: Prisma.UserCreateManyInput[] = [];
  const adminId = uuidv7();
  users.push({
    id: adminId,
    name: 'BUKU Admin',
    role: 'super_admin',
    passwordHash,
    termsVersion: '1.0',
    termsAcceptedAt: now,
    ...contact('admin@buku.dev', null),
  });
  const ownerIds = Array.from({ length: 20 }, (_, i) => {
    const id = uuidv7();
    users.push({
      id,
      name: personName(),
      role: 'business_owner',
      passwordHash,
      termsVersion: '1.0',
      termsAcceptedAt: now,
      ...contact(`owner${i + 1}@buku.dev`, null),
    });
    return id;
  });
  const customerIds = Array.from({ length: 50 }, (_, i) => {
    const id = uuidv7();
    const withEmail = i % 3 !== 0;
    users.push({
      id,
      name: personName(),
      role: 'user',
      passwordHash: withEmail ? passwordHash : null,
      termsVersion: '1.0',
      termsAcceptedAt: now,
      ...contact(
        withEmail ? `customer${i + 1}@buku.dev` : null,
        `+92300${String(1000000 + i).padStart(7, '0')}`,
      ),
    });
    return id;
  });
  await db.user.createMany({ data: users });
  await db.notificationPreference.createMany({ data: users.map((u) => ({ userId: u.id! })) });

  // ── Businesses, hours, services, staff, schedules ──
  interface SeededBusiness {
    id: string;
    services: { id: string; duration: number; buffer: number; price: number }[];
    staffIds: string[];
  }
  const businesses: SeededBusiness[] = [];

  for (const [i, [leaf, name]] of BUSINESS_NAMES.entries()) {
    const city = CITIES[i % CITIES.length]!;
    const businessId = uuidv7();
    await db.business.create({
      data: {
        id: businessId,
        ownerId: ownerIds[i]!,
        categoryId: leafCategoryIds.get(leaf)!,
        name,
        slug: `${slugify(name)}-${slugify(city.city)}`,
        description: `${name} is a trusted ${leaf.toLowerCase()} in ${city.city}. Book online or join the live queue with BUKU.`,
        phone: `${city.phone}${String(3000000 + i * 137).slice(0, 7)}`,
        email: `hello@${slugify(name)}.pk`,
        address: `${int(1, 250)} Main Boulevard, Block ${pick(['A', 'B', 'C', 'D'])}`,
        city: city.city,
        state: city.state,
        country: 'PK',
        businessTermsVersion: '1.0',
        businessTermsAcceptedAt: now,
        postalCode: String(int(44000, 75999)),
        lat: +(city.lat + (rand() - 0.5) * 0.08).toFixed(6),
        lng: +(city.lng + (rand() - 0.5) * 0.08).toFixed(6),
        timezone: 'Asia/Karachi',
        currency: 'PKR',
        status: i < 17 ? 'verified' : 'pending',
        verified: i < 17,
        verifiedAt: i < 17 ? now : null,
      },
    });

    // Mon–Sat 09:00–18:00, Sunday closed.
    await db.businessHours.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        businessId,
        dayOfWeek: d,
        openTime: '09:00',
        closeTime: '18:00',
        isClosed: d === 0,
      })),
    });
    await db.availabilityRule.createMany({
      data: [1, 2, 3, 4, 5, 6].map((d) => ({
        businessId,
        dayOfWeek: d,
        startTime: '09:00',
        endTime: '18:00',
      })),
    });

    // Every other business approves bookings by hand.
    await db.bookingSettings.create({
      data: { businessId, confirmationMode: i % 2 === 0 ? 'automatic' : 'manual' },
    });

    const menu = SERVICE_MENUS[leaf]!;
    const [popular, more] = [uuidv7(), uuidv7()];
    await db.serviceCategory.createMany({
      data: [
        { id: popular, businessId, name: 'Popular', sortOrder: 0 },
        { id: more, businessId, name: 'More services', sortOrder: 1 },
      ],
    });
    const services = menu.map(([serviceName, duration, price], s) => ({
      id: uuidv7(),
      businessId,
      name: serviceName,
      durationMinutes: duration,
      bufferMinutes: duration >= 60 ? 15 : 5,
      price,
      currency: 'PKR',
      categoryId: s < 2 ? popular : more,
      sortOrder: s,
    }));
    await db.service.createMany({ data: services });

    const staffRows = Array.from({ length: 5 }, (_, s) => ({
      id: uuidv7(),
      businessId,
      userId: s === 0 ? ownerIds[i]! : null,
      displayName: s === 0 ? users.find((u) => u.id === ownerIds[i])!.name : personName(),
      specializations: [menu[s % menu.length]![0]],
    }));
    await db.staff.createMany({ data: staffRows });
    await db.staffService.createMany({
      data: staffRows.flatMap((st) => services.map((sv) => ({ staffId: st.id, serviceId: sv.id }))),
    });
    // Staff-specific schedules (staff #4 works mornings only).
    await db.availabilityRule.createMany({
      data: staffRows.flatMap((st, s) =>
        [1, 2, 3, 4, 5, 6].map((d) => ({
          businessId,
          staffId: st.id,
          dayOfWeek: d,
          startTime: '09:00',
          endTime: s === 4 ? '13:00' : '18:00',
        })),
      ),
    });
    // A public holiday next week for everyone.
    await db.availabilityException.create({
      data: {
        businessId,
        exceptionDate: new Date(today.getTime() + 7 * 86_400_000),
        type: 'holiday',
        reason: 'Public holiday',
      },
    });

    businesses.push({
      id: businessId,
      services: services.map((s) => ({
        id: s.id,
        duration: s.durationMinutes,
        buffer: s.bufferMinutes,
        price: s.price,
      })),
      staffIds: staffRows.map((s) => s.id),
    });
  }

  // ── Appointments: sequential, non-overlapping per staff member ──
  const appointments: Prisma.AppointmentCreateManyInput[] = [];
  const history: Prisma.AppointmentStatusHistoryCreateManyInput[] = [];
  const codes = new Set<string>();
  const completed: { id: string; userId: string; businessId: string; endAt: Date }[] = [];

  for (let n = 0; appointments.length < 200 && n < 10_000; n++) {
    const biz = pick(businesses);
    const staffId = pick(biz.staffIds);
    const service = pick(biz.services);
    const dayOffset = int(-30, 14);
    const day = new Date(today.getTime() + dayOffset * 86_400_000);
    if (day.getUTCDay() === 0) continue; // closed on Sundays
    const startMinute = 9 * 60 + int(0, 16) * 30;
    if (startMinute + service.duration > 18 * 60) continue;
    const startAt = pktToUtc(day, Math.floor(startMinute / 60), startMinute % 60);
    const endAt = new Date(startAt.getTime() + service.duration * 60_000);

    // Skip anything that would overlap an existing booking of the same staff
    // member OR the same customer (a person can't be in two places at once).
    const userId = pick(customerIds);
    const clash = appointments.some(
      (a) =>
        (a.staffId === staffId || a.userId === userId) &&
        startAt < (a.endAt as Date) &&
        endAt > (a.startAt as Date),
    );
    if (clash) continue;

    let code = generateConfirmationCode();
    while (codes.has(code)) code = generateConfirmationCode();
    codes.add(code);

    const isPast = endAt < now;
    const roll = rand();
    const status = isPast
      ? roll < 0.8
        ? 'completed'
        : roll < 0.9
          ? 'cancelled'
          : 'no_show'
      : roll < 0.75
        ? 'confirmed'
        : 'pending';
    const id = uuidv7(startAt.getTime() - 3 * 86_400_000);
    appointments.push({
      id,
      businessId: biz.id,
      serviceId: service.id,
      staffId,
      userId,
      status,
      startAt,
      endAt,
      blockedUntil: endAt,
      price: service.price,
      currency: 'PKR',
      confirmationCode: code,
      paymentStatus: status === 'completed' ? 'paid' : 'unpaid',
      ...(status === 'cancelled' && {
        cancelledAt: new Date(startAt.getTime() - 86_400_000),
        cancelledBy: 'user' as const,
        cancelReason: 'Plans changed',
      }),
    });
    history.push({
      appointmentId: id,
      fromStatus: null,
      toStatus: 'pending',
      actorType: 'user',
      actorId: userId,
    });
    if (status !== 'pending') {
      history.push({
        appointmentId: id,
        fromStatus: 'pending',
        toStatus: status === 'cancelled' ? 'cancelled' : 'confirmed',
        actorType: status === 'cancelled' ? 'user' : 'business',
      });
    }
    if (status === 'completed' || status === 'no_show') {
      history.push({ appointmentId: id, fromStatus: 'confirmed', toStatus: status, actorType: 'business' });
    }
    if (status === 'completed') completed.push({ id, userId, businessId: biz.id, endAt });
  }
  await db.appointment.createMany({ data: appointments });
  await db.appointmentStatusHistory.createMany({ data: history });

  // ── Reviews (only for completed appointments; trigger updates ratings) ──
  const comments = [
    'Excellent service, on time and friendly.',
    'Very professional. Will book again.',
    'Good, but a short wait.',
    'Loved it!',
    'Clean place and great staff.',
    null,
  ];
  await db.review.createMany({
    data: completed.slice(0, 30).map((c) => ({
      appointmentId: c.id,
      userId: c.userId,
      businessId: c.businessId,
      overallRating: pick([3, 4, 4, 5, 5, 5]),
      waitTimeRating: pick([3, 4, 5]),
      staffRating: pick([4, 5]),
      cleanlinessRating: pick([4, 5]),
      valueRating: pick([3, 4, 5]),
      comment: pick(comments),
      createdAt: new Date(c.endAt.getTime() + 3 * 3_600_000),
    })),
  });

  // ── Queue sessions (last 9 days + today) ──
  const queueBusinesses = businesses.slice(0, 5);
  for (let d = -9; d <= 0; d++) {
    const biz = queueBusinesses[(d + 9) % queueBusinesses.length]!;
    const sessionDate = new Date(today.getTime() + d * 86_400_000);
    const isToday = d === 0;
    const entries = int(8, 20);
    const served = isToday ? Math.floor(entries / 2) : entries - 2;
    const sessionId = uuidv7();
    await db.queueSession.create({
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
    const used = new Set<string>();
    await db.queueEntry.createMany({
      data: Array.from({ length: entries }, (_, t) => {
        const ticket = t + 1;
        const joinedAt = new Date(pktToUtc(sessionDate, 9, 0).getTime() + t * 10 * 60_000);
        const status =
          ticket <= served ? 'completed' : isToday ? 'waiting' : ticket === entries ? 'no_show' : 'left';
        let userId: string | null = pick(customerIds);
        if (used.has(userId) || rand() < 0.2) userId = null; // walk-ins
        if (userId) used.add(userId);
        return {
          sessionId,
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
        } satisfies Prisma.QueueEntryCreateManyInput;
      }),
    });
  }

  // ── Favourites, notifications (partitioned), audit log (partitioned) ──
  const favs = new Set<string>();
  const favourites: Prisma.FavouriteCreateManyInput[] = [];
  for (let i = 0; i < 60; i++) {
    const userId = pick(customerIds);
    const businessId = pick(businesses).id;
    if (favs.has(userId + businessId)) continue;
    favs.add(userId + businessId);
    favourites.push({ userId, businessId });
  }
  await db.favourite.createMany({ data: favourites });

  await db.notification.createMany({
    data: appointments.slice(0, 40).map((a, i) => ({
      userId: a.userId,
      appointmentId: a.id!,
      type: 'booking_confirmation',
      channel: 'in_app' as const,
      title: 'Booking confirmed',
      body: `Your booking ${a.confirmationCode} is confirmed.`,
      data: { screen: 'appointment', appointmentId: a.id },
      status: i % 3 === 0 ? ('read' as const) : ('delivered' as const),
      createdAt: new Date(now.getTime() - i * 2 * 86_400_000),
    })),
  });
  await db.auditLog.create({
    data: {
      userId: adminId,
      action: 'seed.completed',
      resourceType: 'system',
      newValues: { appointments: appointments.length },
    },
  });

  console.log(
    `✔ Seeded ${users.length} users, ${businesses.length} businesses, ${appointments.length} appointments, ${Math.min(30, completed.length)} reviews, 10 queue sessions.`,
  );
  console.log(
    `  Demo logins (dev only): admin@buku.dev, owner1@buku.dev, customer2@buku.dev — password "${DEMO_PASSWORD}"`,
  );
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
