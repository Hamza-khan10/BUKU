import { randomUUID } from 'node:crypto';
import { generateConfirmationCode, getDummyPasswordHash } from '@buku/common';
import type { Database } from '@buku/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusinessFixture, type BusinessFixture } from '../../../packages/database/test/fixtures.js';
import { requestContext } from '../src/http/context.js';
import { createHarness, helpers, type Harness } from './harness.js';

/**
 * Suggestions from how people use BUKU, against the real database. The clock
 * is fixed in 2028 (10:00 UTC = 15:00 in Lahore) so nothing else in the test
 * database counts as recent; free times come from a fake booking-service.
 */

let h: Harness;
let db: Database;
let x: ReturnType<typeof helpers>;
let admin: string;
const DAY = 86_400_000;
const NOW = new Date('2028-03-15T10:00:00Z');
const at = (days: number, hourUtc = 5.5) =>
  new Date(Date.UTC(2028, 2, 15) + days * DAY + hourUtc * 3_600_000);
const ctx = requestContext({ ip: '127.0.0.1', get: () => undefined } as never);

beforeAll(async () => {
  h = await createHarness('notification-suggestions-int-test');
  db = h.db;
  x = helpers(h);
  admin = (
    await db.user.create({
      data: { name: 'Admin', role: 'super_admin', emailHash: randomUUID().replace(/-/g, '').padEnd(64, '0') },
    })
  ).id;
});

afterAll(async () => {
  await h.settings.update(
    { suggestionsEnabled: true, suggestionMinDays: 7, suggestionMaxPer30Days: 3, suggestionMaxIgnored: 3 },
    admin,
    ctx,
  );
  await db.$disconnect();
  await h.redis.quit();
});

/** Opt in (as the app's settings screen would). */
const optIn = (
  userId: string,
  prefs: { suggestions?: boolean; marketingEmails?: boolean } = { suggestions: true },
) =>
  db.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      ...prefs,
      ...(prefs.suggestions && { suggestionsConsentAt: NOW }),
      ...(prefs.marketingEmails && { marketingConsentAt: NOW }),
    },
    update: {},
  });

async function visit(
  f: BusinessFixture,
  userId: string,
  startAt: Date,
  status: 'completed' | 'confirmed' | 'pending' = 'completed',
) {
  return db.appointment.create({
    data: {
      businessId: f.business.id,
      serviceId: f.service.id,
      staffId: f.staffA.id,
      userId,
      status,
      startAt,
      endAt: new Date(startAt.getTime() + 30 * 60_000),
      blockedUntil: new Date(startAt.getTime() + 30 * 60_000),
      price: 800,
      currency: 'PKR',
      confirmationCode: generateConfirmationCode(),
      createdAt: new Date(startAt.getTime() - 2 * DAY),
    },
  });
}

/** A customer who comes every 28 days (last visit `lastDaysAgo` ago), opted in, with the app. */
async function regular(lastDaysAgo = 24) {
  const f = await createBusinessFixture(db);
  await db.staffService.create({ data: { staffId: f.staffA.id, serviceId: f.service.id } });
  for (const n of [56, 28, 0]) await visit(f, f.customer.id, at(-lastDaysAgo - n));
  await optIn(f.customer.id);
  const phone = await x.device(f.customer.id, undefined, NOW);
  return { f, phone };
}

const titles = async (userId: string) => (await x.inbox(userId)).map((n) => n.title);

describe('Regulars whose usual visit is due', () => {
  it('get “time for your usual…” with a real free time with their usual person — once per visit', async () => {
    const { f, phone } = await regular();
    h.openings.down = false;
    h.openings.slots = [
      { startAt: at(2, 4), time: '09:00', staffIds: [f.staffA.id] },
      { startAt: at(2, 5.5), time: '10:30', staffIds: [f.staffA.id] },
      { startAt: at(3, 5.5), time: '10:30', staffIds: [f.staffA.id] },
    ];
    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 60_000));

    const inbox = await x.inbox(f.customer.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      title: 'Time for your usual Haircut?',
      data: {
        screen: 'book',
        businessId: f.business.id,
        serviceId: f.service.id,
        staffId: f.staffA.id,
        startAt: at(2, 5.5).toISOString(),
      },
    });
    expect(inbox[0]!.body).toBe(
      `It’s been about 3 weeks since your last visit to ${f.business.name}. Staff A has an opening on Fri 17 Mar at 10:30 — book it in a tap.`,
    );
    expect(h.push.to(phone)).toHaveLength(1);
    expect(h.openings.asked.at(-1)).toMatchObject({ businessId: f.business.id, staffId: f.staffA.id });
  });

  it('not yet due, already booked there, not opted in, or switched off → nothing', async () => {
    const early = await regular(10);
    const booked = await regular();
    await visit(booked.f, booked.f.customer.id, at(5), 'confirmed');
    const notOptedIn = await regular();
    await db.notificationPreference.update({
      where: { userId: notOptedIn.f.customer.id },
      data: { suggestions: false, suggestionsConsentAt: null },
    });
    await h.suggestions.run(NOW);
    for (const r of [early, booked, notOptedIn]) expect(await x.inbox(r.f.customer.id)).toEqual([]);
    expect(h.push.to(notOptedIn.phone)).toEqual([]);

    const off = await regular();
    await h.settings.update({ suggestionsEnabled: false }, admin, ctx);
    await h.suggestions.run(NOW);
    await h.settings.update({ suggestionsEnabled: true }, admin, ctx);
    expect(await x.inbox(off.f.customer.id)).toEqual([]);
  });

  it('booking-service unavailable: the suggestion still goes, without a time', async () => {
    const { f } = await regular();
    h.openings.down = true;
    await h.suggestions.run(NOW);
    h.openings.down = false;
    expect((await x.inbox(f.customer.id))[0]!.body).toMatch(/Book your next one in a tap\.$/);
  });

  it('a check-in counts as a visit (not every business marks visits completed)', async () => {
    const f = await createBusinessFixture(db);
    for (const n of [56, 28, 0]) {
      const a = await visit(f, f.customer.id, at(-24 - n), 'confirmed');
      await db.appointment.update({ where: { id: a.id }, data: { checkedInAt: a.startAt } });
    }
    await optIn(f.customer.id);
    await x.device(f.customer.id, undefined, NOW);
    h.openings.slots = [];
    await h.suggestions.run(NOW);
    expect(await titles(f.customer.id)).toEqual(['Time for your usual Haircut?']);
  });

  it('email-only consent and no app: an email (with an unsubscribe for exactly that), no inbox item', async () => {
    const f = await createBusinessFixture(db);
    for (const n of [56, 28, 0]) await visit(f, f.customer.id, at(-24 - n));
    await optIn(f.customer.id, { marketingEmails: true });
    const address = await x.verifiedEmail(f.customer.id);
    h.openings.slots = [];
    await h.suggestions.run(NOW);
    const [mail] = h.email.to(address);
    expect(mail!.subject).toBe('Time for your usual Haircut?');
    expect(mail!.headers?.['List-Unsubscribe']).toContain('p=marketingEmails');
    expect(await x.inbox(f.customer.id)).toEqual([]);
  });
});

describe('Caps', () => {
  it('not within a week of the last suggestion; never after 3 ignored ones', async () => {
    const recent = await regular();
    await db.notificationMark.create({
      data: {
        key: `test:${randomUUID()}`,
        kind: 'suggest_comeback',
        userId: recent.f.customer.id,
        createdAt: at(-3),
      },
    });
    const ignoring = await regular();
    for (const days of [-60, -45, -30])
      await db.notificationMark.create({
        data: {
          key: `test:${randomUUID()}`,
          kind: 'suggest_usual',
          userId: ignoring.f.customer.id,
          createdAt: at(days),
        },
      });
    // Their last booking was made before those three suggestions.
    await db.appointment.updateMany({
      where: { userId: ignoring.f.customer.id },
      data: { createdAt: at(-90) },
    });
    await h.suggestions.run(NOW);
    expect(await x.inbox(recent.f.customer.id)).toEqual([]);
    expect(await x.inbox(ignoring.f.customer.id)).toEqual([]);
  });
});

describe('People who stopped coming', () => {
  it('their most-visited place is taking bookings — once per quiet spell; not if they have something booked', async () => {
    const f = await createBusinessFixture(db);
    const a = await visit(f, f.customer.id, at(-60));
    await db.appointment.update({ where: { id: a.id }, data: { createdAt: at(-61) } });
    await optIn(f.customer.id);
    await x.device(f.customer.id, undefined, NOW);

    const busy = await createBusinessFixture(db);
    const b = await visit(busy, busy.customer.id, at(-60));
    await db.appointment.update({ where: { id: b.id }, data: { createdAt: at(-61) } });
    const elsewhere = await createBusinessFixture(db);
    const upcoming = await visit(elsewhere, busy.customer.id, at(20), 'confirmed');
    await db.appointment.update({ where: { id: upcoming.id }, data: { createdAt: at(-61) } });
    await optIn(busy.customer.id);

    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 8 * DAY));

    const inbox = await x.inbox(f.customer.id);
    expect(inbox.map((n) => n.title)).toEqual([`${f.business.name} is taking bookings`]);
    expect(inbox[0]!.data).toEqual({ screen: 'book', businessId: f.business.id, serviceId: f.service.id });
    expect(await x.inbox(busy.customer.id)).toEqual([]);
  });

  it('their place closed down → no suggestion about it', async () => {
    const f = await createBusinessFixture(db);
    const a = await visit(f, f.customer.id, at(-70));
    await db.appointment.update({ where: { id: a.id }, data: { createdAt: at(-71) } });
    await db.business.update({ where: { id: f.business.id }, data: { status: 'suspended' } });
    await optIn(f.customer.id);
    await h.suggestions.run(NOW);
    expect(await x.inbox(f.customer.id)).toEqual([]);
  });
});

describe('New accounts that never booked', () => {
  it('day 2 and day 10, then nothing; not for employee accounts or people who booked', async () => {
    const mk = async (
      data: { managedByBusinessId?: string; username?: string; passwordHash?: string } = {},
    ) => {
      const u = await db.user.create({
        data: {
          name: 'New person',
          emailHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          createdAt: at(-3),
          ...data,
        },
      });
      await optIn(u.id);
      return u;
    };
    const fresh = await mk();
    const f = await createBusinessFixture(db);
    const employee = await mk({
      managedByBusinessId: f.business.id,
      username: `desk${randomUUID().slice(0, 6)}`,
      passwordHash: await getDummyPasswordHash(),
    });
    const booked = await mk();
    await visit(f, booked.id, at(5), 'confirmed');

    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 3 * DAY)); // too soon for step 2
    await h.suggestions.run(new Date(NOW.getTime() + 8 * DAY)); // day 11
    await h.suggestions.run(new Date(NOW.getTime() + 20 * DAY));

    expect(await titles(fresh.id)).toEqual(['Book your first visit', 'Skip the waiting room']);
    expect(await x.inbox(employee.id)).toEqual([]);
    expect(await x.inbox(booked.id)).toEqual([]);
  });
});
