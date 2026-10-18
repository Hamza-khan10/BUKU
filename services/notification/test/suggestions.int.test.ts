import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requestContext } from '../src/http/context.js';
import { useNotificationHarness, type Person, type Shop } from './harness.js';

/**
 * Suggestions from how people use BUKU, on database v2 (D3f): people's visits come from their
 * reliability ledger, their bookings from their own list. The clock is fixed in 2028 (10:00 UTC =
 * 15:00 in Lahore) so nothing else in the test world counts as recent; free times come from a
 * fake booking-service.
 */

const { h, x } = useNotificationHarness('notification-suggestions-int-test');
let admin: Person;
const DAY = 86_400_000;
const NOW = new Date('2028-03-15T10:00:00Z');
const at = (days: number, hourUtc = 5.5) =>
  new Date(Date.UTC(2028, 2, 15) + days * DAY + hourUtc * 3_600_000);
const ctx = requestContext({ ip: '127.0.0.1', get: () => undefined } as never);

beforeAll(async () => {
  admin = await x.person('Admin', 'super_admin');
});

afterAll(async () => {
  await h.settings.update(
    { suggestionsEnabled: true, suggestionMinDays: 7, suggestionMaxPer30Days: 3, suggestionMaxIgnored: 3 },
    admin.id,
    ctx,
  );
});

const optIn = (p: Person, prefs?: { suggestions?: boolean; marketingEmails?: boolean }) =>
  x.optIn(p, prefs, NOW);

/** A visit at the shop: booked two days before (unless `bookedAt`), with the customer's side kept. */
const visit = (
  f: Shop,
  customer: Person,
  startAt: Date,
  status: 'completed' | 'confirmed' | 'pending' = 'completed',
  bookedAt = new Date(startAt.getTime() - 2 * DAY),
) => x.appointment(f, { customer, startAt, status, bookedAt });

/** A shop where Staff A does the Haircut. */
async function shop() {
  const f = await x.shop();
  await x.inShop(f, (tx) =>
    tx.staffService.create({
      data: { staffId: f.staffA.id, serviceId: f.service.id, businessId: f.business.id },
    }),
  );
  return f;
}

/** A customer who comes every 28 days (last visit `lastDaysAgo` ago), opted in, with the app. */
async function regular(lastDaysAgo = 24, bookedAt?: Date) {
  const f = await shop();
  for (const n of [56, 28, 0]) await visit(f, f.customer, at(-lastDaysAgo - n), 'completed', bookedAt);
  await optIn(f.customer);
  const phone = await x.device(f.customer, undefined, NOW);
  return { f, phone };
}

const titles = async (p: Person) => (await x.inbox(p)).map((n) => n.title);

describe('Regulars whose usual visit is due', () => {
  it('get “time for your usual…” with a real free time with their usual person — once per visit', async () => {
    const { f, phone } = await regular();
    const staffA = f.staffA.id.toString();
    h.openings.down = false;
    h.openings.slots = [
      { startAt: at(2, 4), time: '09:00', staffIds: [staffA] },
      { startAt: at(2, 5.5), time: '10:30', staffIds: [staffA] },
      { startAt: at(3, 5.5), time: '10:30', staffIds: [staffA] },
    ];
    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 60_000));

    const inbox = await x.inbox(f.customer);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      title: 'Time for your usual Haircut?',
      data: {
        screen: 'book',
        businessId: f.business.publicId,
        serviceId: f.service.id.toString(),
        staffId: staffA,
        startAt: at(2, 5.5).toISOString(),
      },
    });
    expect(inbox[0]!.body).toBe(
      `It’s been about 3 weeks since your last visit to ${f.business.name}. Staff A has an opening on Fri 17 Mar at 10:30 — book it in a tap.`,
    );
    expect(h.push.to(phone)).toHaveLength(1);
    expect(h.openings.asked.at(-1)).toMatchObject({ businessId: f.business.publicId, staffId: staffA });
  });

  it('not yet due, already booked there, not opted in, or switched off → nothing', async () => {
    const early = await regular(10);
    const booked = await regular();
    await visit(booked.f, booked.f.customer, at(5), 'confirmed');
    const notOptedIn = await regular();
    await (
      await x.shardOf(notOptedIn.f.customer)
    ).notificationPreference.update({
      where: { userId: notOptedIn.f.customer.id },
      data: { suggestions: false, suggestionsConsentAt: null },
    });
    await h.suggestions.run(NOW);
    for (const r of [early, booked, notOptedIn]) expect(await x.inbox(r.f.customer)).toEqual([]);
    expect(h.push.to(notOptedIn.phone)).toEqual([]);

    const off = await regular();
    await h.settings.update({ suggestionsEnabled: false }, admin.id, ctx);
    await h.suggestions.run(NOW);
    await h.settings.update({ suggestionsEnabled: true }, admin.id, ctx);
    expect(await x.inbox(off.f.customer)).toEqual([]);
  });

  it('booking-service unavailable: the suggestion still goes, without a time', async () => {
    const { f } = await regular();
    h.openings.down = true;
    await h.suggestions.run(NOW);
    h.openings.down = false;
    expect((await x.inbox(f.customer))[0]!.body).toMatch(/Book your next one in a tap\.$/);
  });

  it('a check-in counts as a visit (not every business marks visits completed)', async () => {
    const f = await shop();
    for (const n of [56, 28, 0]) {
      const startAt = at(-24 - n);
      await x.appointment(f, { startAt, status: 'confirmed', checkedInAt: startAt, bookedAt: at(-26 - n) });
    }
    await optIn(f.customer);
    await x.device(f.customer, undefined, NOW);
    h.openings.slots = [];
    await h.suggestions.run(NOW);
    expect(await titles(f.customer)).toEqual(['Time for your usual Haircut?']);
  });

  it('their usual service is no longer offered → no suggestion about it', async () => {
    const { f } = await regular();
    await x.inShop(f, (tx) => tx.service.update({ where: { id: f.service.id }, data: { isActive: false } }));
    await h.suggestions.run(NOW);
    expect(await x.inbox(f.customer)).toEqual([]);
  });

  it('email-only consent and no app: an email (with an unsubscribe for exactly that), no inbox item', async () => {
    const f = await shop();
    for (const n of [56, 28, 0]) await visit(f, f.customer, at(-24 - n));
    await optIn(f.customer, { marketingEmails: true });
    const address = await x.verifiedEmail(f.customer);
    h.openings.slots = [];
    await h.suggestions.run(NOW);
    const [mail] = h.email.to(address);
    expect(mail!.subject).toBe('Time for your usual Haircut?');
    expect(mail!.headers?.['List-Unsubscribe']).toContain('p=marketingEmails');
    expect(await x.inbox(f.customer)).toEqual([]);
  });
});

describe('Caps', () => {
  it('not within a week of the last suggestion; never after 3 ignored ones', async () => {
    const recent = await regular();
    const mark = async (p: Person, kind: string, days: number) =>
      (await x.shardOf(p)).notificationMark.create({
        data: { key: `test:${randomUUID()}`, kind, userId: p.id, createdAt: at(days) },
      });
    await mark(recent.f.customer, 'suggest_comeback', -3);
    // Their last booking was made before those three suggestions.
    const ignoring = await regular(24, at(-90));
    for (const days of [-60, -45, -30]) await mark(ignoring.f.customer, 'suggest_usual', days);
    await h.suggestions.run(NOW);
    expect(await x.inbox(recent.f.customer)).toEqual([]);
    expect(await x.inbox(ignoring.f.customer)).toEqual([]);
  });
});

describe('People who stopped coming', () => {
  it('their most-visited place is taking bookings — once per quiet spell; not if they have something booked', async () => {
    const f = await shop();
    await visit(f, f.customer, at(-60), 'completed', at(-61));
    await optIn(f.customer);
    await x.device(f.customer, undefined, NOW);

    const busy = await shop();
    await visit(busy, busy.customer, at(-60), 'completed', at(-61));
    const elsewhere = await shop();
    await visit(elsewhere, busy.customer, at(20), 'confirmed', at(-61));
    await optIn(busy.customer);

    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 8 * DAY));

    const inbox = await x.inbox(f.customer);
    expect(inbox.map((n) => n.title)).toEqual([`${f.business.name} is taking bookings`]);
    expect(inbox[0]!.data).toEqual({
      screen: 'book',
      businessId: f.business.publicId,
      serviceId: f.service.id.toString(),
    });
    expect(await x.inbox(busy.customer)).toEqual([]);
  });

  it('their place closed down → no suggestion about it', async () => {
    const f = await shop();
    await visit(f, f.customer, at(-70), 'completed', at(-71));
    await x.inShop(f, (tx) =>
      tx.business.update({ where: { id: f.business.id }, data: { status: 'suspended' } }),
    );
    await optIn(f.customer);
    await h.suggestions.run(NOW);
    expect(await x.inbox(f.customer)).toEqual([]);
  });
});

describe('New accounts that never booked', () => {
  it('day 2 and day 10, then nothing; not for employee accounts or people who booked', async () => {
    const mk = async (extra: { managedByBusinessId?: bigint; username?: string } = {}) => {
      const p = await x.person('New person', 'user', { createdAt: at(-3), ...extra });
      await optIn(p);
      return p;
    };
    const fresh = await mk();
    const f = await shop();
    const employee = await mk({
      managedByBusinessId: f.business.id,
      username: `desk${randomUUID().slice(0, 6)}`,
    });
    const booked = await mk();
    await visit(f, booked, at(5), 'confirmed');

    await h.suggestions.run(NOW);
    await h.suggestions.run(new Date(NOW.getTime() + 3 * DAY)); // too soon for step 2
    await h.suggestions.run(new Date(NOW.getTime() + 8 * DAY)); // day 11
    await h.suggestions.run(new Date(NOW.getTime() + 20 * DAY));

    expect(await titles(fresh)).toEqual(['Book your first visit', 'Skip the waiting room']);
    expect(await x.inbox(employee)).toEqual([]);
    expect(await x.inbox(booked)).toEqual([]);
  });
});
