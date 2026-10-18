import { createHmac, randomUUID } from 'node:crypto';
import { normalizePhone } from '@buku/common';
import { TOPICS } from '@buku/kafka';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withBilling } from '../../../packages/database/test/services-world.js';
import { requestContext } from '../src/http/context.js';
import { WHATSAPP_PHONE_CONTEXT } from '../src/notifier.js';
import { useNotificationHarness, type Person, type Shop, type Visit } from './harness.js';

/**
 * Email, WhatsApp and timed messages, on database v2 (D3f) and the real Valkey.
 * Timed jobs run with a fixed clock in 2027 (10:00 UTC = 15:00 in Lahore, not
 * night anywhere we test), so nothing else in the test world is in range.
 */

const { h, x } = useNotificationHarness('notification-channels-int-test');
let admin: Person;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date('2027-01-12T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const ctx = requestContext({ ip: '127.0.0.1', get: () => undefined } as never);

beforeAll(async () => {
  admin = await x.person('Admin', 'super_admin');
});

afterAll(async () => {
  await h.settings.update(
    {
      emailEnabled: true,
      whatsappEnabled: false,
      whatsappPaidTypes: [],
      whatsappMonthlyBudgetCents: 0,
      reminder24h: true,
      reminder2h: true,
      quietStartHour: 21,
      quietEndHour: 9,
    },
    admin.id,
    ctx,
  );
});

/** 10:30 in Lahore, `days` from today. */
const daysAhead = (days: number) => {
  const d = new Date(Date.now() + days * 24 * HOUR);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5, 30));
};
/** A business with a customer and an appointment (default: two days ahead, 10:30 Lahore time). */
async function booking(
  opts: { status?: 'pending' | 'confirmed'; startAt?: Date; bookedAt?: Date } = {},
): Promise<{ f: Shop; a: Visit }> {
  const f = await x.shop();
  return { f, a: await x.appointment(f, opts) };
}
const of = (b: { f: Shop; a: { id: bigint } }) => ({ appointmentId: b.a.id, businessId: b.f.business.id });
const inboxTitles = async (p: Person) => (await x.inbox(p)).map((n) => n.title);
const contactOf = async (p: Person) =>
  (await x.shardOf(p)).whatsappContact.findUnique({ where: { userId: p.id } });
const hashOf = (digits: string) => h.indexer.digest16(WHATSAPP_PHONE_CONTEXT, normalizePhone(`+${digits}`));

describe('Appointment reminders', () => {
  it('day before: inbox, push and email — exactly once, even when two instances run at the same moment', async () => {
    const { f, a } = await booking({ startAt: later(20 * HOUR), bookedAt: later(-3 * 24 * HOUR) });
    const phone = await x.device(f.customer);
    const address = await x.verifiedEmail(f.customer);

    await Promise.all([h.scheduler.appointmentReminders(NOW), h.scheduler.appointmentReminders(NOW)]);
    await h.scheduler.appointmentReminders(later(MIN));

    const inbox = await x.inbox(f.customer);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ type: 'reminder_24h', appointmentId: a.id });
    expect(inbox[0]!.title).toMatch(/^Reminder: Haircut on /);
    expect(h.push.to(phone)).toHaveLength(1);
    const [mail] = h.email.to(address);
    expect(mail!.text).toContain(a.code);
    expect(mail!.headers?.['List-Unsubscribe']).toContain('p=emailReminders');
    expect(h.email.to(address)).toHaveLength(1);

    // Two hours before: the "soon" reminder (push only: they have the app).
    await h.scheduler.appointmentReminders(later(19 * HOUR));
    expect(await inboxTitles(f.customer)).toEqual([inbox[0]!.title, 'Soon: Haircut at 11:00']);
    expect(h.email.to(address)).toHaveLength(1);
  });

  it('not for cancelled or checked-in visits, not at night, and a request nobody answered nudges the approvers', async () => {
    const cancelled = await booking({ startAt: later(20 * HOUR), bookedAt: later(-3 * 24 * HOUR) });
    await x.update(cancelled.f, cancelled.a, { status: 'cancelled', cancelledAt: NOW, cancelledBy: 'user' });
    const arrived = await booking({ startAt: later(90 * MIN), bookedAt: later(-3 * 24 * HOUR) });
    await x.update(arrived.f, arrived.a, { checkedInAt: NOW });
    const night = await booking({ startAt: later(30 * HOUR), bookedAt: later(-3 * 24 * HOUR) });
    const asking = await booking({
      status: 'pending',
      startAt: later(20 * HOUR),
      bookedAt: later(-3 * HOUR),
    });
    // createdAt is when the request came in: as booking-service writes it.
    await x.update(asking.f, asking.a, { createdAt: later(-3 * HOUR) });
    for (const b of [cancelled, arrived, night])
      await x.update(b.f, b.a, { createdAt: later(-3 * 24 * HOUR) });
    const manager = await x.member(asking.f, 'manager');

    await h.scheduler.appointmentReminders(NOW);
    // 03:00 in Lahore, 18 h before `night`: inside the day-before range, but it's night.
    await h.scheduler.appointmentReminders(later(12 * HOUR));

    expect(await x.inbox(cancelled.f.customer)).toEqual([]);
    expect(await x.inbox(arrived.f.customer)).toEqual([]);
    expect(await x.inbox(night.f.customer)).toEqual([]);
    expect(await x.inbox(asking.f.customer)).toEqual([]);
    for (const u of [asking.f.owner, manager])
      expect(await inboxTitles(u)).toEqual(['A booking request is waiting']);
  });

  it('switched off by the admin → none', async () => {
    const { f, a } = await booking({ startAt: later(20 * HOUR + 7 * MIN) });
    await x.update(f, a, { createdAt: later(-3 * 24 * HOUR) });
    await h.settings.update({ reminder24h: false }, admin.id, ctx);
    await h.scheduler.appointmentReminders(NOW);
    await h.settings.update({ reminder24h: true }, admin.id, ctx);
    expect(await x.inbox(f.customer)).toEqual([]);
  });
});

describe('"Book again" reminders', () => {
  const bookLater = {
    status: 'cancelled' as const,
    cancelledAt: later(-45 * 24 * HOUR),
    cancelledBy: 'user' as const,
    cancelReasonCode: 'schedule_conflict' as const,
  };
  it('sent when they cancelled with "remind me later"; not if they booked there again, nor long overdue', async () => {
    const asked = await booking({ startAt: later(-30 * 24 * HOUR) });
    await x.update(asked.f, asked.a, { ...bookLater, rebookReminderAt: later(-HOUR) });
    const alreadyBooked = await booking({ startAt: later(-30 * 24 * HOUR) });
    await x.update(alreadyBooked.f, alreadyBooked.a, { ...bookLater, rebookReminderAt: later(-HOUR) });
    await x.appointment(alreadyBooked.f, {
      status: 'confirmed',
      startAt: later(3 * 24 * HOUR),
      staffId: null,
    });
    const tooOld = await booking({ startAt: later(-40 * 24 * HOUR) });
    await x.update(tooOld.f, tooOld.a, { ...bookLater, rebookReminderAt: later(-4 * 24 * HOUR) });

    await h.scheduler.rebookReminders(NOW);
    await h.scheduler.rebookReminders(later(5 * MIN));

    const [n] = await x.inbox(asked.f.customer);
    expect(n).toMatchObject({
      title: 'Time to book Haircut again?',
      data: {
        screen: 'book',
        businessId: asked.f.business.publicId,
        serviceId: asked.f.service.id.toString(),
      },
    });
    expect(await x.inbox(asked.f.customer)).toHaveLength(1);
    expect(await x.inbox(alreadyBooked.f.customer)).toEqual([]);
    expect(await x.inbox(tooOld.f.customer)).toEqual([]);
  });
});

describe('Plan notices', () => {
  it('trial ending / ended: only while billing is on; no "ended" if they already chose another plan', async () => {
    const [ending, ended, moved] = [await x.shop(), await x.shop(), await x.shop()];
    const plan = await x.inShop(ending, (tx) =>
      tx.plan.findFirstOrThrow({ where: { audience: 'business', archivedAt: null } }),
    );
    const subscribe = (s: Shop, data: Record<string, unknown>) =>
      x.inShop(s, (tx) =>
        tx.subscription.create({
          data: {
            id: h.world.id(),
            businessId: s.business.id,
            planId: plan.id,
            provider: 'trial',
            status: 'trialing',
            ...data,
          },
        }),
      );
    await subscribe(ending, {
      currentPeriodStart: later(-28 * 24 * HOUR),
      currentPeriodEnd: later(2 * 24 * HOUR),
    });
    for (const s of [ended, moved])
      await subscribe(s, {
        status: 'expired',
        currentPeriodStart: later(-31 * 24 * HOUR),
        currentPeriodEnd: later(-HOUR),
        updatedAt: later(-HOUR),
      });
    await subscribe(moved, {
      provider: 'manual',
      status: 'active',
      currentPeriodStart: NOW,
      currentPeriodEnd: null,
    });

    await h.scheduler.planNotices(NOW); // billing off: nothing to say
    expect(await x.inbox(ending.owner)).toEqual([]);
    await withBilling(h.world, 'business', async () => {
      await h.scheduler.planNotices(NOW);
      await h.scheduler.planNotices(later(15 * MIN));
    });
    const inbox = await x.inbox(ending.owner);
    expect(inbox.map((n) => n.title)).toEqual(['Your free trial ends soon']);
    expect(inbox[0]!.body).toContain(
      `Your ${plan.name} trial for ${ending.business.name} ends on Thu 14 Jan`,
    );
    expect(await inboxTitles(ended.owner)).toEqual(['Your free trial has ended']);
    expect(await x.inbox(moved.owner)).toEqual([]);
  });
});

describe('Email', () => {
  it('booking confirmations go to a verified address only; team alerts by email only to people without the app', async () => {
    const b = await booking();
    const verified = await x.verifiedEmail(b.f.customer);
    const ownerAddress = await x.verifiedEmail(b.f.owner);
    await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(b), status: 'confirmed' });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(b));
    expect(h.email.to(verified).map((m) => m.subject)).toEqual(['Booking confirmed']);
    expect(h.email.to(ownerAddress).map((m) => m.subject)).toEqual(['New booking']);
    expect(
      await (
        await x.shardOf(b.f.customer)
      ).notification.count({ where: { userId: b.f.customer.id, channel: 'email', status: 'sent' } }),
    ).toBe(1);

    const other = await booking();
    const unverified = await x.verifiedEmail(other.f.customer, false);
    const ownerWithApp = await x.verifiedEmail(other.f.owner);
    await x.device(other.f.owner);
    await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(other), status: 'confirmed' });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(other));
    expect(h.email.to(unverified)).toEqual([]);
    expect(h.email.to(ownerWithApp)).toEqual([]);
  });

  it('unsubscribe link: GET only asks, POST switches off exactly that kind; a forged link does nothing', async () => {
    const b = await booking();
    const address = await x.verifiedEmail(b.f.customer);
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(b));
    const link = new URL(h.email.to(address)[0]!.headers!['List-Unsubscribe']!.slice(1, -1));
    // The link names the person by their public ID (DB-042).
    expect(link.searchParams.get('u')).toBe(b.f.customer.publicId);
    const path = `${link.pathname}${link.search}`;
    const prefs = async () =>
      (await x.shardOf(b.f.customer)).notificationPreference.findUnique({
        where: { userId: b.f.customer.id },
      });

    const page = await request(h.app).get(path).expect(200);
    expect(page.text).toContain('Turn off these emails?');
    expect(await prefs()).toBeNull();

    await request(h.app).post(path).expect(200);
    expect(await prefs()).toMatchObject({ emailBookingConfirmation: false, emailReminders: true });

    const forged = path.replace(/s=[0-9a-f]{4}/, 's=0000');
    await request(h.app).post(forged).expect(400);
    await request(h.app).post(path.replace('emailBookingConfirmation', 'emailReminders')).expect(400);
    expect(await prefs()).toMatchObject({ emailReminders: true });
  });
});

describe('WhatsApp', () => {
  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    return {
      raw,
      signature: `sha256=${createHmac('sha256', h.appSecret).update(raw).digest('hex')}`,
    };
  };
  const post = (body: unknown, signature?: string) => {
    const s = signed(body);
    return request(h.app)
      .post('/v1/webhooks/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature ?? s.signature)
      .send(s.raw);
  };
  const inbound = (from: string, text: string, id = `wamid.${randomUUID()}`) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              contacts: [{ wa_id: from }],
              messages: [
                {
                  from,
                  id,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const newNumber = () => `9230${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const lastReply = (digits: string) => h.wa.to(`+${digits}`).at(-1)?.body ?? '';

  /** Connects a fresh number to the person, as the app + WhatsApp would. */
  async function connect(p: Person) {
    const digits = newNumber();
    const res = await request(h.app).post('/v1/users/me/whatsapp/link').set(p.auth).expect(200);
    expect(res.body.data.link).toBe(
      `https://wa.me/${h.whatsappNumber.slice(1)}?text=${encodeURIComponent(`BUKU ${res.body.data.code}`)}`,
    );
    await post(inbound(digits, `buku ${res.body.data.code}`)).expect(200);
    return digits;
  }

  it('Meta verifies the webhook with our token; wrong token or signature is refused', async () => {
    const ok = await request(h.app)
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': h.verifyToken, 'hub.challenge': '12345' })
      .expect(200);
    expect(ok.text).toBe('12345');
    await request(h.app)
      .get('/v1/webhooks/whatsapp')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '1' })
      .expect(403);
    await post(inbound(newNumber(), 'hi'), 'sha256=00').expect(401);
    await post(inbound(newNumber(), 'hi'), signed({ other: true }).signature).expect(401);
  });

  it('connecting: the code proves the number; old/used codes fail; replies to unknown numbers; STOP and START', async () => {
    const { f, a } = await booking();
    const digits = await connect(f.customer);
    expect(lastReply(digits)).toContain('WhatsApp is connected');
    const status = await request(h.app).get('/v1/users/me/whatsapp').set(f.customer.auth).expect(200);
    expect(status.body.data).toMatchObject({
      connected: true,
      stopped: false,
      phone: `+92 ••••• ${digits.slice(-4)}`,
    });

    // The same webhook delivered twice changes nothing; a used code doesn't work again.
    const hi = inbound(digits, 'hi');
    await post(hi).expect(200);
    await post(hi).expect(200);
    expect(h.wa.to(`+${digits}`)).toHaveLength(2);
    expect(lastReply(digits)).toContain(`Haircut at ${f.business.name}`);
    expect(lastReply(digits)).toContain(a.code);

    const stranger = newNumber();
    await post(inbound(stranger, 'BUKU ZZZZZZ')).expect(200);
    expect(lastReply(stranger)).toContain('expired');
    await post(inbound(stranger, 'hello')).expect(200);
    expect(lastReply(stranger)).toContain('Settings → WhatsApp → Connect');

    await post(inbound(digits, ' stop ')).expect(200);
    expect(lastReply(digits)).toContain('are off');
    expect((await contactOf(f.customer))!.optedOutAt).not.toBeNull();
    await post(inbound(digits, 'START')).expect(200);
    expect((await contactOf(f.customer))!.optedOutAt).toBeNull();

    // The number moves to whoever proves it next (the handle follows, DB-018).
    const other = await x.person('Other customer');
    const code = (await request(h.app).post('/v1/users/me/whatsapp/link').set(other.auth)).body.data
      .code as string;
    await post(inbound(digits, `BUKU ${code}`)).expect(200);
    expect(await contactOf(f.customer)).toBeNull();
    expect(await contactOf(other)).not.toBeNull();
    expect(await h.world.handles.find('user.whatsapp', hashOf(digits))).toBe(other.id);
    await post(inbound(digits, 'hi')).expect(200);
    expect(lastReply(digits)).toContain('no upcoming visits');

    await request(h.app).delete('/v1/users/me/whatsapp').set(other.auth).expect(204);
    await request(h.app).delete('/v1/users/me/whatsapp').set(other.auth).expect(404);
    expect(await h.world.handles.find('user.whatsapp', hashOf(digits))).toBeNull();
  });

  it('a closed account lets its number go at once', async () => {
    const someone = await x.person('Leaving');
    const digits = await connect(someone);
    expect(await h.world.handles.find('user.whatsapp', hashOf(digits))).toBe(someone.id);
    const event = await x.deliver(TOPICS.USERS_DELETED, { userId: someone.id });
    await x.redeliver(event);
    expect(await contactOf(someone)).toBeNull();
    expect(await h.world.handles.find('user.whatsapp', hashOf(digits))).toBeNull();
    await post(inbound(digits, 'hi')).expect(200);
    expect(lastReply(digits)).toContain('Settings → WhatsApp → Connect');
  });

  it('sending: free in the window; paid template only without the app, for allowed types, within budget', async () => {
    await h.settings.update(
      {
        whatsappEnabled: true,
        whatsappPaidTypes: ['booking_confirmed'],
        whatsappMonthlyBudgetCents: 0,
        whatsappMessageCostCents: 4,
      },
      admin.id,
      ctx,
    );
    // Window open (they just connected): free, even with the app.
    const open = await booking();
    await x.device(open.f.customer);
    const openDigits = await connect(open.f.customer);
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(open));
    const sent = h.wa.to(`+${openDigits}`).at(-1)!;
    expect(sent).toMatchObject({ kind: 'text' });
    expect(sent.body).toContain('*Booking confirmed*');
    const openDb = await x.shardOf(open.f.customer);
    const row = await openDb.notification.findFirstOrThrow({
      where: { userId: open.f.customer.id, channel: 'whatsapp', type: 'booking_confirmed' },
    });
    expect(row).toMatchObject({ whatsappPricing: 'window', status: 'sent', externalId: sent.id });

    // Meta reports it delivered, then read (each status names whose message it was).
    const status = (s: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            {
              field: 'messages',
              value: { statuses: [{ id: sent.id, status: s, recipient_id: openDigits }] },
            },
          ],
        },
      ],
    });
    await post(status('delivered')).expect(200);
    await post(status('read')).expect(200);
    expect(await openDb.notification.findFirstOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'read',
    });

    // Window closed, no app: budget 0 → nothing; with budget → a template.
    const closed = await booking();
    const closedDigits = await connect(closed.f.customer);
    await (
      await x.shardOf(closed.f.customer)
    ).whatsappContact.update({
      where: { userId: closed.f.customer.id },
      data: { lastInboundAt: new Date(Date.now() - 2 * 24 * HOUR) },
    });
    const before = h.wa.to(`+${closedDigits}`).length;
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(closed));
    expect(h.wa.to(`+${closedDigits}`)).toHaveLength(before);

    await h.settings.update({ whatsappMonthlyBudgetCents: 1_000_000 }, admin.id, ctx);
    const elsewhere = await x.shop();
    const again = await x.appointment(elsewhere, { customer: closed.f.customer, startAt: daysAhead(3) });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of({ f: elsewhere, a: again }));
    const template = h.wa.to(`+${closedDigits}`).at(-1)!;
    expect(template).toMatchObject({ kind: 'template', template: 'buku_booking_confirmed' });
    expect(template.params).toEqual([
      elsewhere.business.name,
      'Haircut',
      expect.stringMatching(/, 10:30$/),
      again.code,
    ]);

    // Same person with the app: push is free, so no paid message.
    await x.device(closed.f.customer);
    const third = await x.appointment(elsewhere, { customer: closed.f.customer, startAt: daysAhead(4) });
    const count = h.wa.to(`+${closedDigits}`).length;
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of({ f: elsewhere, a: third }));
    expect(h.wa.to(`+${closedDigits}`)).toHaveLength(count);

    const usage = await h.settings.whatsappUsage();
    expect(usage.templateMessages).toBeGreaterThanOrEqual(1);
    expect(usage.estimatedCents).toBeGreaterThanOrEqual(4);
    await h.settings.update(
      { whatsappEnabled: false, whatsappPaidTypes: [], whatsappMonthlyBudgetCents: 0 },
      admin.id,
      ctx,
    );
  });
});

describe('Admin settings', () => {
  it('only platform admins; unknown template types refused; every change audited', async () => {
    const someone = await x.person('Someone');
    await request(h.app).get('/v1/admin/notifications/settings').set(someone.auth).expect(403);

    const auth = admin.auth;
    await request(h.app)
      .put('/v1/admin/notifications/settings')
      .set(auth)
      .send({ whatsappPaidTypes: ['team_new_booking'] })
      .expect(400);
    await request(h.app)
      .put('/v1/admin/notifications/settings')
      .set(auth)
      .send({ quietStartHour: 24 })
      .expect(400);
    const res = await request(h.app)
      .put('/v1/admin/notifications/settings')
      .set(auth)
      .send({ quietStartHour: 22, quietEndHour: 8 })
      .expect(200);
    expect(res.body.data).toMatchObject({ quietStartHour: 22, quietEndHour: 8, whatsappEnabled: false });
    // On the directory (reference data, DB-015); the audit entry on the admin's own shard.
    expect(
      await h.world.directory.notificationSettings.findUniqueOrThrow({ where: { id: 1 } }),
    ).toMatchObject({
      quietStartHour: 22,
      updatedById: admin.id,
    });
    expect(
      await (
        await x.shardOf(admin)
      ).auditLog.findFirst({
        where: { userId: admin.id, action: 'notifications.settings_updated' },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      oldValues: { quietStartHour: 21, quietEndHour: 9 },
      newValues: { quietStartHour: 22, quietEndHour: 8 },
    });
    await h.settings.update({ quietStartHour: 21, quietEndHour: 9 }, admin.id, ctx);

    const templates = await request(h.app)
      .get('/v1/admin/notifications/whatsapp/templates')
      .set(auth)
      .expect(200);
    expect(templates.body.data.map((t: { name: string }) => t.name)).toContain('buku_reminder_day_before');
    const usage = await request(h.app).get('/v1/admin/notifications/whatsapp/usage').set(auth).expect(200);
    expect(usage.body.data).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });
});

describe('Reviews', () => {
  it('“how was it?” after a visit — once, not for no-shows or reviewed visits; new review → owner and managers; reply → reviewer', async () => {
    const past = { startAt: later(-2 * HOUR), bookedAt: later(-3 * 24 * HOUR) };
    const visited = await booking(past);
    await x.update(visited.f, visited.a, { status: 'completed' });
    const missed = await booking(past);
    await x.update(missed.f, missed.a, { status: 'no_show' });
    const reviewed = await booking(past);
    await x.update(reviewed.f, reviewed.a, { status: 'completed' });
    const review = (b: { f: Shop; a: Visit }, overallRating: number) =>
      x.inShop(b.f, (tx) =>
        tx.review.create({
          data: {
            id: h.world.id(),
            appointmentId: b.a.id,
            appointmentStartAt: b.a.startAt,
            userId: b.f.customer.id,
            businessId: b.f.business.id,
            overallRating,
          },
        }),
      );
    await review(reviewed, 5);

    await h.scheduler.reviewRequests(NOW);
    await h.scheduler.reviewRequests(later(5 * 60_000));
    expect(await inboxTitles(visited.f.customer)).toEqual(['How was your Haircut?']);
    expect((await x.inbox(visited.f.customer))[0]!.data).toEqual({
      screen: 'review',
      appointmentId: visited.a.publicId,
    });
    expect(await x.inbox(missed.f.customer)).toEqual([]);
    expect(await x.inbox(reviewed.f.customer)).toEqual([]);

    const r = await review(visited, 4);
    const manager = await x.member(visited.f, 'manager');
    const desk = await x.member(visited.f, 'front_desk');
    const data = { reviewId: r.id, appointmentId: visited.a.id, businessId: visited.f.business.id };
    await x.deliver(TOPICS.REVIEWS_CREATED, data);
    for (const u of [visited.f.owner, manager]) expect(await inboxTitles(u)).toEqual(['New 4★ review']);
    expect((await x.inbox(manager))[0]!.body).toBe(
      'Ayesha K. reviewed Haircut. Reply to show customers you listen.',
    );
    expect(await x.inbox(desk)).toEqual([]);

    await x.deliver(TOPICS.REVIEWS_RESPONDED, data);
    expect((await inboxTitles(visited.f.customer)).at(-1)).toBe(
      `${visited.f.business.name} replied to your review`,
    );
  });
});
