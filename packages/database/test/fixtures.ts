import { generateConfirmationCode, uuidv7 } from '@buku/common';
import type { Database } from '../src/index.js';

/** Minimal, valid object graph for integration tests. Every call creates fresh rows. */
export async function createBusinessFixture(db: Database) {
  const suffix = uuidv7().slice(-12);
  const owner = await db.user.create({
    data: { name: 'Owner', role: 'business_owner', emailHash: sha(`owner-${suffix}`) },
  });
  const customer = await db.user.create({
    data: { name: 'Customer', role: 'user', phoneHash: sha(`customer-${suffix}`) },
  });
  const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const business = await db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Test Barber ${suffix}`,
      slug: `test-barber-${suffix}`,
      city: 'Lahore',
      country: 'Pakistan',
      lat: 31.5204,
      lng: 74.3587,
      timezone: 'Asia/Karachi',
      currency: 'PKR',
    },
  });
  const service = await db.service.create({
    data: { businessId: business.id, name: 'Haircut', durationMinutes: 30, price: 800, currency: 'PKR' },
  });
  const [staffA, staffB] = await Promise.all([
    db.staff.create({ data: { businessId: business.id, displayName: 'Staff A' } }),
    db.staff.create({ data: { businessId: business.id, displayName: 'Staff B' } }),
  ]);
  return { owner, customer, category, business, service, staffA: staffA, staffB: staffB };
}

export type BusinessFixture = Awaited<ReturnType<typeof createBusinessFixture>>;

export function appointmentData(
  f: BusinessFixture,
  startAt: Date,
  minutes = 30,
  overrides: { staffId?: string | null; status?: 'pending' | 'confirmed' | 'cancelled' } = {},
) {
  return {
    businessId: f.business.id,
    serviceId: f.service.id,
    userId: f.customer.id,
    staffId: overrides.staffId === undefined ? f.staffA.id : overrides.staffId,
    status: overrides.status ?? 'confirmed',
    startAt,
    endAt: new Date(startAt.getTime() + minutes * 60_000),
    price: 800,
    currency: 'PKR',
    confirmationCode: generateConfirmationCode(),
    ...(overrides.status === 'cancelled' && { cancelledAt: new Date(), cancelledBy: 'user' as const }),
  };
}

function sha(seed: string): string {
  // Any 64-hex value satisfies the blind-index CHECK constraint in tests.
  return Buffer.from(seed.padEnd(32, '0').slice(0, 32)).toString('hex');
}
