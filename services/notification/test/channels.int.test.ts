import { createHmac, randomUUID } from 'node:crypto';
import { generateConfirmationCode } from '@buku/common';
import type { Database } from '@buku/database';
import { TOPICS } from '@buku/kafka';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBusinessFixture } from '../../../packages/database/test/fixtures.js';
import { requestContext } from '../src/http/context.js';
import { booking, createHarness, helpers, type Harness } from './harness.js';

/**
 * Email, WhatsApp and timed messages, against the real database and Valkey.
 * Timed jobs run with a fixed clock in 2027 (10:00 UTC = 15:00 in Lahore, not
 * night anywhere we test), so nothing else in the test database is in range.
 */

let h: Harness;
let db: Database;
let x: ReturnType<typeof helpers>;
let admin: string;
const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = new Date('2027-01-12T10:00:00Z');
const later = (ms: number) => new Date(NOW.getTime() + ms);
const ctx = requestContext({ ip: '127.0.0.1', get: () => undefined } as never);

beforeAll(async () => {
  h = await createHarness('notification-channels-int-test');
  db = h.db;
  x = helpers(h);
  admin = (await person('Admin', 'super_admin')).id;
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
    admin,
    ctx,
  );
  await h.db.$disconnect();
  await h.redis.quit();
});

/** 10:30 in Lahore, `days` from today. */
const daysAhead = (days: number) => {
  const d = new Date(Date.now() + days * 24 * HOUR);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 5, 30));
};
/** A person (every account needs an email, phone or social identity). */
const person = (name: string, role: 'user' | 'super_admin' = 'user') =>
  db.user.create({ data: { name, role, emailHash: randomUUID().replace(/-/g, '').padEnd(64, '0') } });
const inboxTitles = async (userId: string) => (await x.inbox(userId)).map((n) => n.title);

describe('Appointment reminders', () => {
  it('day before: inbox, push and email — exactly once, even when two instances run at the same moment', async () => {
    const { f, a } = await booking(db, { startAt: later(20 * HOUR), createdAt: later(-3 * 24 * HOUR) });
    const phone = await x.device(f.customer.id);
    const address = await x.verifiedEmail(f.customer.id);

    await Promise.all([h.scheduler.appointmentReminders(NOW), h.scheduler.appointmentReminders(NOW)]);
    await h.scheduler.appointmentReminders(later(MIN));

    const inbox = await x.inbox(f.customer.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ type: 'reminder_24h', appointmentId: a.id });
    expect(inbox[0]!.title).toMatch(/^Reminder: Haircut on /);
    expect(h.push.to(phone)).toHaveLength(1);
    const [mail] = h.email.to(address);
    expect(mail!.text).toContain(a.confirmationCode);
    expect(mail!.headers?.['List-Unsubscribe']).toContain('p=emailReminders');
    expect(h.email.to(address)).toHaveLength(1);

    // Two hours before: the "soon" reminder (push only: they have the app).
    await h.scheduler.appointmentReminders(later(19 * HOUR));
    expect(await inboxTitles(f.customer.id)).toEqual([inbox[0]!.title, 'Soon: Haircut at 11:00']);
    expect(h.email.to(address)).toHaveLength(1);
  });

  it('not for cancelled or checked-in visits, not at night, and a request nobody answered nudges the approvers', async () => {
    const cancelled = await booking(db, { startAt: later(20 * HOUR), createdAt: later(-3 * 24 * HOUR) });
    await db.appointment.update({
      where: { id: cancelled.a.id },
      data: { status: 'cancelled', cancelledAt: NOW, cancelledBy: 'user' },
    });
    const arrived = await booking(db, { startAt: later(90 * MIN), createdAt: later(-3 * 24 * HOUR) });
    await db.appointment.update({ where: { id: arrived.a.id }, data: { checkedInAt: NOW } });
    const night = await booking(db, { startAt: later(30 * HOUR), createdAt: later(-3 * 24 * HOUR) });
    const request = await booking(db, {
      status: 'pending',
      startAt: later(20 * HOUR),
      createdAt: later(-3 * HOUR),
    });
    const manager = await x.member(request.f.business.id, 'manager');

    await h.scheduler.appointmentReminders(NOW);
    // 03:00 in Lahore, 18 h before `night`: inside the day-before range, but it's night.
    await h.scheduler.appointmentReminders(later(12 * HOUR));

    expect(await x.inbox(cancelled.f.customer.id)).toEqual([]);
    expect(await x.inbox(arrived.f.customer.id)).toEqual([]);
    expect(await x.inbox(night.f.customer.id)).toEqual([]);
    expect(await x.inbox(request.f.customer.id)).toEqual([]);
    for (const u of [request.f.owner.id, manager.id])
      expect(await inboxTitles(u)).toEqual(['A booking request is waiting']);
  });

  it('switched off by the admin → none', async () => {
    const { f } = await booking(db, {
      startAt: later(20 * HOUR + 7 * MIN),
      createdAt: later(-3 * 24 * HOUR),
    });
    await h.settings.update({ reminder24h: false }, admin, ctx);
    await h.scheduler.appointmentReminders(NOW);
    await h.settings.update({ reminder24h: true }, admin, ctx);
    expect(await x.inbox(f.customer.id)).toEqual([]);
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
    const asked = await booking(db, { startAt: later(-30 * 24 * HOUR), createdAt: later(-31 * 24 * HOUR) });
    await db.appointment.update({
      where: { id: asked.a.id },
      data: { ...bookLater, rebookReminderAt: later(-HOUR) },
    });
    const alreadyBooked = await booking(db, {
      startAt: later(-30 * 24 * HOUR),
      createdAt: later(-31 * 24 * HOUR),
    });
    await db.appointment.update({
      where: { id: alreadyBooked.a.id },
      data: { ...bookLater, rebookReminderAt: later(-HOUR) },
    });
    await db.appointment.create({
      data: {
        businessId: alreadyBooked.f.business.id,
        serviceId: alreadyBooked.f.service.id,
        userId: alreadyBooked.f.customer.id,
        status: 'confirmed',
        startAt: later(3 * 24 * HOUR),
        endAt: later(3 * 24 * HOUR + 30 * MIN),
        blockedUntil: later(3 * 24 * HOUR + 30 * MIN),
        price: 800,
        currency: 'PKR',
        confirmationCode: generateConfirmationCode(),
      },
    });
    const tooOld = await booking(db, { startAt: later(-40 * 24 * HOUR), createdAt: later(-41 * 24 * HOUR) });
    await db.appointment.update({
      where: { id: tooOld.a.id },
      data: { ...bookLater, rebookReminderAt: later(-4 * 24 * HOUR) },
    });

    await h.scheduler.rebookReminders(NOW);
    await h.scheduler.rebookReminders(later(5 * MIN));

    const [n] = await x.inbox(asked.f.customer.id);
    expect(n).toMatchObject({
      title: 'Time to book Haircut again?',
      data: { screen: 'book', businessId: asked.f.business.id, serviceId: asked.f.service.id },
    });
    expect(await x.inbox(asked.f.customer.id)).toHaveLength(1);
    expect(await x.inbox(alreadyBooked.f.customer.id)).toEqual([]);
    expect(await x.inbox(tooOld.f.customer.id)).toEqual([]);
  });
});

describe('Plan notices', () => {
  it('trial ending / ended: only while billing is on; no "ended" if they already chose another plan', async () => {
    const plan = await db.plan.findFirstOrThrow({ where: { audience: 'user', archivedAt: null } });
    const [ending, ended, moved] = await Promise.all([person('Ending'), person('Ended'), person('Moved on')]);
    await db.subscription.create({
      data: {
        planId: plan.id,
        userId: ending.id,
        provider: 'trial',
        status: 'trialing',
        currentPeriodStart: later(-28 * 24 * HOUR),
        currentPeriodEnd: later(2 * 24 * HOUR),
      },
    });
    for (const u of [ended, moved])
      await db.subscription.create({
        data: {
          planId: plan.id,
          userId: u.id,
          provider: 'trial',
          status: 'expired',
          currentPeriodStart: later(-31 * 24 * HOUR),
          currentPeriodEnd: later(-HOUR),
          updatedAt: later(-HOUR),
        },
      });
    await db.subscription.create({
      data: {
        planId: plan.id,
        userId: moved.id,
        provider: 'manual',
        status: 'active',
        currentPeriodStart: NOW,
      },
    });
    const billing = await db.billingSettings.findUniqueOrThrow({ where: { audience: 'user' } });

    try {
      await db.billingSettings.update({ where: { audience: 'user' }, data: { enabled: false } });
      await h.scheduler.planNotices(NOW);
      expect(await x.inbox(ending.id)).toEqual([]);

      await db.billingSettings.update({ where: { audience: 'user' }, data: { enabled: true } });
      await h.scheduler.planNotices(NOW);
      await h.scheduler.planNotices(later(15 * MIN));
    } finally {
      await db.billingSettings.update({ where: { audience: 'user' }, data: { enabled: billing.enabled } });
    }
    const inbox = await x.inbox(ending.id);
    expect(inbox.map((n) => n.title)).toEqual(['Your free trial ends soon']);
    expect(inbox[0]!.body).toContain(`Your ${plan.name} trial ends on Thu 14 Jan`);
    expect(await inboxTitles(ended.id)).toEqual(['Your free trial has ended']);
    expect(await x.inbox(moved.id)).toEqual([]);
  });
});

describe('Email', () => {
  it('booking confirmations go to a verified address only; team alerts by email only to people without the app', async () => {
    const { f, a } = await booking(db);
    const verified = await x.verifiedEmail(f.customer.id);
    const ownerAddress = await x.verifiedEmail(f.owner.id);
    await x.deliver(TOPICS.BOOKINGS_CREATED, { appointmentId: a.id, status: 'confirmed' });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    expect(h.email.to(verified).map((m) => m.subject)).toEqual(['Booking confirmed']);
    expect(h.email.to(ownerAddress).map((m) => m.subject)).toEqual(['New booking']);
    expect(
      await db.notification.count({ where: { userId: f.customer.id, channel: 'email', status: 'sent' } }),
    ).toBe(1);

    const other = await booking(db);
    const unverified = await x.verifiedEmail(other.f.customer.id, false);
    const ownerWithApp = await x.verifiedEmail(other.f.owner.id);
    await x.device(other.f.owner.id);
    await x.deliver(TOPICS.BOOKINGS_CREATED, { appointmentId: other.a.id, status: 'confirmed' });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: other.a.id });
    expect(h.email.to(unverified)).toEqual([]);
    expect(h.email.to(ownerWithApp)).toEqual([]);
  });

  it('unsubscribe link: GET only asks, POST switches off exactly that kind; a forged link does nothing', async () => {
    const { f, a } = await booking(db);
    const address = await x.verifiedEmail(f.customer.id);
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    const link = new URL(h.email.to(address)[0]!.headers!['List-Unsubscribe']!.slice(1, -1));
    const path = `${link.pathname}${link.search}`;

    const page = await request(h.app).get(path).expect(200);
    expect(page.text).toContain('Turn off these emails?');
    expect(await db.notificationPreference.findUnique({ where: { userId: f.customer.id } })).toBeNull();

    await request(h.app).post(path).expect(200);
    const prefs = await db.notificationPreference.findUniqueOrThrow({ where: { userId: f.customer.id } });
    expect(prefs).toMatchObject({ emailBookingConfirmation: false, emailReminders: true });

    const forged = path.replace(/s=[0-9a-f]{4}/, 's=0000');
    await request(h.app).post(forged).expect(400);
    await request(h.app).post(path.replace('emailBookingConfirmation', 'emailReminders')).expect(400);
    expect(
      await db.notificationPreference.findUniqueOrThrow({ where: { userId: f.customer.id } }),
    ).toMatchObject({
      emailReminders: true,
    });
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
  async function connect(userId: string) {
    const digits = newNumber();
    const res = await request(h.app)
      .post('/v1/users/me/whatsapp/link')
      .set(await x.authFor(userId))
      .expect(200);
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
    const { f, a } = await booking(db);
    const digits = await connect(f.customer.id);
    expect(lastReply(digits)).toContain('WhatsApp is connected');
    const status = await request(h.app)
      .get('/v1/users/me/whatsapp')
      .set(await x.authFor(f.customer.id))
      .expect(200);
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
    expect(lastReply(digits)).toContain(a.confirmationCode);

    const stranger = newNumber();
    await post(inbound(stranger, 'BUKU ZZZZZZ')).expect(200);
    expect(lastReply(stranger)).toContain('expired');
    await post(inbound(stranger, 'hello')).expect(200);
    expect(lastReply(stranger)).toContain('Settings → WhatsApp → Connect');

    await post(inbound(digits, ' stop ')).expect(200);
    expect(lastReply(digits)).toContain('are off');
    expect(
      (await db.whatsappContact.findUniqueOrThrow({ where: { userId: f.customer.id } })).optedOutAt,
    ).not.toBeNull();
    await post(inbound(digits, 'START')).expect(200);
    expect(
      (await db.whatsappContact.findUniqueOrThrow({ where: { userId: f.customer.id } })).optedOutAt,
    ).toBeNull();

    // The number moves to whoever proves it next.
    const other = await createBusinessFixture(db);
    const code = (
      await request(h.app)
        .post('/v1/users/me/whatsapp/link')
        .set(await x.authFor(other.customer.id))
    ).body.data.code as string;
    await post(inbound(digits, `BUKU ${code}`)).expect(200);
    expect(await db.whatsappContact.findUnique({ where: { userId: f.customer.id } })).toBeNull();
    expect(await db.whatsappContact.findUnique({ where: { userId: other.customer.id } })).not.toBeNull();

    await request(h.app)
      .delete('/v1/users/me/whatsapp')
      .set(await x.authFor(other.customer.id))
      .expect(204);
    await request(h.app)
      .delete('/v1/users/me/whatsapp')
      .set(await x.authFor(other.customer.id))
      .expect(404);
  });

  it('sending: free in the window; paid template only without the app, for allowed types, within budget', async () => {
    await h.settings.update(
      {
        whatsappEnabled: true,
        whatsappPaidTypes: ['booking_confirmed'],
        whatsappMonthlyBudgetCents: 0,
        whatsappMessageCostCents: 4,
      },
      admin,
      ctx,
    );
    // Window open (they just connected): free, even with the app.
    const open = await booking(db);
    await x.device(open.f.customer.id);
    const openDigits = await connect(open.f.customer.id);
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: open.a.id });
    const sent = h.wa.to(`+${openDigits}`).at(-1)!;
    expect(sent).toMatchObject({ kind: 'text' });
    expect(sent.body).toContain('*Booking confirmed*');
    const row = await db.notification.findFirstOrThrow({
      where: { userId: open.f.customer.id, channel: 'whatsapp', type: 'booking_confirmed' },
    });
    expect(row).toMatchObject({ whatsappPricing: 'window', status: 'sent', externalId: sent.id });

    // Meta reports it delivered, then read.
    const status = (s: string) => ({
      object: 'whatsapp_business_account',
      entry: [
        { id: 'waba', changes: [{ field: 'messages', value: { statuses: [{ id: sent.id, status: s }] } }] },
      ],
    });
    await post(status('delivered')).expect(200);
    await post(status('read')).expect(200);
    expect(await db.notification.findFirstOrThrow({ where: { id: row.id } })).toMatchObject({
      status: 'read',
    });

    // Window closed, no app: budget 0 → nothing; with budget → a template.
    const closed = await booking(db);
    const closedDigits = await connect(closed.f.customer.id);
    await db.whatsappContact.update({
      where: { userId: closed.f.customer.id },
      data: { lastInboundAt: new Date(Date.now() - 2 * 24 * HOUR) },
    });
    const before = h.wa.to(`+${closedDigits}`).length;
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: closed.a.id });
    expect(h.wa.to(`+${closedDigits}`)).toHaveLength(before);

    await h.settings.update({ whatsappMonthlyBudgetCents: 1_000_000 }, admin, ctx);
    const again = await booking(db, { startAt: daysAhead(3) });
    await db.appointment.update({ where: { id: again.a.id }, data: { userId: closed.f.customer.id } });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: again.a.id });
    const template = h.wa.to(`+${closedDigits}`).at(-1)!;
    expect(template).toMatchObject({ kind: 'template', template: 'buku_booking_confirmed' });
    expect(template.params).toEqual([
      again.f.business.name,
      'Haircut',
      expect.stringMatching(/, 10:30$/),
      again.a.confirmationCode,
    ]);

    // Same person with the app: push is free, so no paid message.
    await x.device(closed.f.customer.id);
    const third = await booking(db, { startAt: daysAhead(4) });
    await db.appointment.update({ where: { id: third.a.id }, data: { userId: closed.f.customer.id } });
    const count = h.wa.to(`+${closedDigits}`).length;
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: third.a.id });
    expect(h.wa.to(`+${closedDigits}`)).toHaveLength(count);

    const usage = await h.settings.whatsappUsage();
    expect(usage.templateMessages).toBeGreaterThanOrEqual(1);
    expect(usage.estimatedCents).toBeGreaterThanOrEqual(4);
    await h.settings.update(
      { whatsappEnabled: false, whatsappPaidTypes: [], whatsappMonthlyBudgetCents: 0 },
      admin,
      ctx,
    );
  });
});

describe('Admin settings', () => {
  it('only platform admins; unknown template types refused; every change audited', async () => {
    const someone = await person('Someone');
    await request(h.app)
      .get('/v1/admin/notifications/settings')
      .set(await x.authFor(someone.id))
      .expect(403);

    const auth = await x.authFor(admin, 'super_admin');
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
    expect(
      await db.auditLog.findFirst({
        where: { userId: admin, action: 'notifications.settings_updated' },
        orderBy: { createdAt: 'desc' },
      }),
    ).toMatchObject({
      oldValues: { quietStartHour: 21, quietEndHour: 9 },
      newValues: { quietStartHour: 22, quietEndHour: 8 },
    });

    const templates = await request(h.app)
      .get('/v1/admin/notifications/whatsapp/templates')
      .set(auth)
      .expect(200);
    expect(templates.body.data.map((t: { name: string }) => t.name)).toContain('buku_reminder_day_before');
    const usage = await request(h.app).get('/v1/admin/notifications/whatsapp/usage').set(auth).expect(200);
    expect(usage.body.data).toMatchObject({ month: expect.stringMatching(/^\d{4}-\d{2}$/) });
  });
});
