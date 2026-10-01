/**
 * Development seed data. Deterministic (fixed PRNG seed), idempotent (skips
 * if data exists) and REFUSES to run in production.
 *
 *   8 top-level categories (+ sub-categories) · 20 businesses in 4 Pakistani
 *   cities · 1 admin · 20 owners · 50 customers · 5 staff per business ·
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

// ── Deterministic randomness (mulberry32) ──────────────────────────────────
let prngState = 20260929;
function rand(): number {
  prngState = (prngState + 0x6d2b79f5) | 0;
  let t = prngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

// All seeded businesses are in Pakistan (Asia/Karachi, UTC+5, no DST), so a
// fixed offset converts local wall-clock times to UTC correctly here.
const PKT_OFFSET_MINUTES = 5 * 60;
function pktToUtc(day: Date, hh: number, mm: number): Date {
  return new Date(
    Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hh, mm) - PKT_OFFSET_MINUTES * 60_000,
  );
}

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

// ── Reference data ─────────────────────────────────────────────────────────
const CATEGORY_TREE = [
  {
    name: 'Beauty & Hair',
    slug: 'beauty-hair',
    icon: '💇',
    children: ['Barbershop', 'Hair Salon', 'Nail Salon'],
  },
  {
    name: 'Health & Medical',
    slug: 'health-medical',
    icon: '🩺',
    children: ['Dental Clinic', 'General Physician', 'Physiotherapy'],
  },
  { name: 'Wellness & Spa', slug: 'wellness-spa', icon: '💆', children: ['Spa', 'Massage', 'Yoga Studio'] },
  { name: 'Fitness', slug: 'fitness', icon: '🏋️', children: ['Gym', 'Personal Training'] },
  { name: 'Automotive', slug: 'automotive', icon: '🚗', children: ['Car Wash', 'Auto Repair'] },
  { name: 'Pets', slug: 'pets', icon: '🐾', children: ['Pet Grooming', 'Veterinary'] },
  {
    name: 'Government & Public',
    slug: 'government-public',
    icon: '🏛️',
    children: ['Passport Office', 'Utility Services'],
  },
  {
    name: 'Home & Professional',
    slug: 'home-professional',
    icon: '🧰',
    children: ['Tailor', 'Legal Consultation'],
  },
] as const;

const CITIES = [
  { city: 'Lahore', state: 'Punjab', lat: 31.5204, lng: 74.3587, phone: '+9242' },
  { city: 'Karachi', state: 'Sindh', lat: 24.8607, lng: 67.0011, phone: '+9221' },
  { city: 'Islamabad', state: 'Islamabad Capital Territory', lat: 33.6844, lng: 73.0479, phone: '+9251' },
  { city: 'Rawalpindi', state: 'Punjab', lat: 33.5651, lng: 73.0169, phone: '+9251' },
] as const;

const SERVICE_MENUS: Record<string, [string, number, number][]> = {
  Barbershop: [
    ['Haircut', 30, 800],
    ['Beard Trim', 15, 400],
    ['Haircut + Beard', 45, 1100],
    ['Hot Towel Shave', 30, 700],
  ],
  'Hair Salon': [
    ['Cut & Blow-dry', 60, 3500],
    ['Hair Colour', 120, 9000],
    ['Keratin Treatment', 150, 15000],
  ],
  'Nail Salon': [
    ['Manicure', 45, 2000],
    ['Pedicure', 60, 2500],
    ['Gel Nails', 75, 4000],
  ],
  'Dental Clinic': [
    ['Check-up', 30, 3000],
    ['Scaling & Polishing', 45, 6000],
    ['Filling', 60, 8000],
  ],
  'General Physician': [
    ['Consultation', 20, 2500],
    ['Follow-up Visit', 15, 1500],
  ],
  Physiotherapy: [
    ['Assessment', 45, 4000],
    ['Therapy Session', 60, 3500],
  ],
  Spa: [
    ['Signature Facial', 60, 6000],
    ['Body Scrub', 45, 5000],
  ],
  Massage: [
    ['Swedish Massage', 60, 5500],
    ['Deep Tissue Massage', 90, 8000],
  ],
  'Yoga Studio': [
    ['Private Yoga Class', 60, 4000],
    ['Breathwork Session', 45, 2500],
  ],
  Gym: [
    ['Induction Session', 45, 1500],
    ['Body Composition Scan', 20, 1000],
  ],
  'Personal Training': [
    ['PT Session', 60, 4000],
    ['Fitness Assessment', 45, 3000],
  ],
  'Car Wash': [
    ['Exterior Wash', 30, 1200],
    ['Full Detail', 120, 8000],
    ['Interior Clean', 60, 3500],
  ],
  'Auto Repair': [
    ['Oil Change', 45, 4500],
    ['Brake Inspection', 60, 2500],
  ],
  'Pet Grooming': [
    ['Bath & Brush', 60, 3000],
    ['Full Groom', 90, 5000],
  ],
  Veterinary: [
    ['Wellness Exam', 30, 3500],
    ['Vaccination', 15, 2500],
  ],
  'Passport Office': [
    ['New Passport Application', 20, 0],
    ['Renewal', 15, 0],
  ],
  'Utility Services': [
    ['New Connection Request', 20, 0],
    ['Billing Query', 15, 0],
  ],
  Tailor: [
    ['Measurement & Fitting', 30, 1000],
    ['Alteration Drop-off', 15, 500],
  ],
  'Legal Consultation': [
    ['Initial Consultation', 60, 10000],
    ['Document Review', 45, 7500],
  ],
};

const BUSINESS_NAMES: [string, string][] = [
  ['Barbershop', 'Fade Masters'],
  ['Barbershop', 'The Gentlemen’s Chair'],
  ['Hair Salon', 'Studio Noor'],
  ['Nail Salon', 'Polished Nail Lounge'],
  ['Dental Clinic', 'Smile Care Dental'],
  ['Dental Clinic', 'Bright Dental Studio'],
  ['General Physician', 'City Family Clinic'],
  ['Physiotherapy', 'Motion Physio Centre'],
  ['Spa', 'Serenity Day Spa'],
  ['Massage', 'Kneaded Relief'],
  ['Yoga Studio', 'Prana Yoga House'],
  ['Gym', 'Iron Republic Gym'],
  ['Personal Training', 'Peak Performance PT'],
  ['Car Wash', 'Sparkle Auto Spa'],
  ['Auto Repair', 'Precision Motors'],
  ['Pet Grooming', 'Pawfect Grooming'],
  ['Veterinary', 'Happy Tails Vet'],
  ['Passport Office', 'Citizen Passport Centre'],
  ['Tailor', 'Stitch & Style Tailors'],
  ['Legal Consultation', 'Justice Partners Law'],
];

const FIRST = [
  'Ayesha',
  'Ali',
  'Fatima',
  'Hamza',
  'Zainab',
  'Usman',
  'Maryam',
  'Bilal',
  'Sana',
  'Omar',
  'Hira',
  'Ahmed',
  'Mahnoor',
  'Saad',
  'Iqra',
  'Danish',
  'Noor',
  'Faisal',
  'Amna',
  'Hassan',
];
const LAST = [
  'Khan',
  'Ahmed',
  'Malik',
  'Hussain',
  'Qureshi',
  'Siddiqui',
  'Chaudhry',
  'Butt',
  'Sheikh',
  'Raza',
  'Iqbal',
  'Mirza',
];
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;
const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

async function main(): Promise<void> {
  if ((await db.category.count()) > 0) {
    console.log('Seed skipped: data already present (use `pnpm dev:wipe` for a fresh database).');
    return;
  }
  console.log('Seeding development data...');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  // ── Categories ──
  const leafCategoryIds = new Map<string, string>();
  let sort = 0;
  for (const top of CATEGORY_TREE) {
    const parentId = uuidv7();
    await db.category.create({
      data: { id: parentId, name: top.name, slug: top.slug, icon: top.icon, depth: 0, sortOrder: sort++ },
    });
    for (const [i, child] of top.children.entries()) {
      const id = uuidv7();
      leafCategoryIds.set(child, id);
      await db.category.create({
        data: { id, name: child, slug: slugify(child), parentId, depth: 1, sortOrder: i },
      });
    }
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
    const isGovernment = leaf === 'Passport Office';
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
        settings: { queueEnabled: isGovernment || i % 4 === 0 },
        subscriptionTier: i % 5 === 0 ? 'professional' : 'free',
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
