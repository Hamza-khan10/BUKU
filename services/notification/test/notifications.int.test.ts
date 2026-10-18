import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TOPICS } from '@buku/kafka';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ExpoPushSender } from '../src/push/expo.js';
import { useNotificationHarness, type Person, type Shop } from './harness.js';

/**
 * Booking and queue events → inbox and push, on database v2 (D3f). A fake push sender records
 * what each device would get; tokens containing "gone" behave like uninstalled apps.
 */

const { h, x } = useNotificationHarness('notification-int-test');

/** A business with a customer and an appointment (default: two days ahead, 10:30 Lahore time). */
async function booking(opts: { staffUserId?: bigint; status?: 'pending' | 'confirmed' } = {}) {
  const f = await x.shop();
  if (opts.staffUserId)
    await x.inShop(f, (tx) =>
      tx.staff.update({ where: { id: f.staffA.id }, data: { userId: opts.staffUserId } }),
    );
  const a = await x.appointment(f, { status: opts.status ?? 'confirmed' });
  return { f, a };
}
const of = (f: Shop, a: { id: bigint }) => ({ appointmentId: a.id, businessId: f.business.id });
const inbox = (p: Person) => x.inbox(p);
const sent = async (p: Person, channel: string, status?: string) =>
  (await x.shardOf(p)).notification.count({ where: { userId: p.id, channel, ...(status && { status }) } });

describe('Bookings', () => {
  it('automatic booking: the business hears “new booking”, the customer gets the confirmation with the code', async () => {
    const { f, a } = await booking();
    const [phone, tablet] = [await x.device(f.customer), await x.device(f.customer)];
    const ownerPhone = await x.device(f.owner);

    await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(f, a), status: 'confirmed' });
    expect((await inbox(f.owner)).map((n) => n.title)).toEqual(['New booking']);
    expect(h.push.to(ownerPhone)[0]!.body).toMatch(/^Ayesha K\. booked Haircut on .+, 10:30 with Staff A\.$/);
    expect(await inbox(f.customer)).toEqual([]);

    const event = await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(f, a));
    const [confirmed] = await inbox(f.customer);
    expect(confirmed).toMatchObject({
      title: 'Booking confirmed',
      appointmentId: a.id,
      // Deep links name the appointment by its public ID (DB-042).
      data: { screen: 'appointment', appointmentId: a.publicId },
    });
    expect(confirmed!.body).toContain(`Your code: ${a.code}`);
    expect([h.push.to(phone).length, h.push.to(tablet).length]).toEqual([1, 1]);
    expect(await sent(f.customer, 'push', 'sent')).toBe(2);

    // Kafka delivers twice sometimes: nothing is duplicated.
    await x.redeliver(event);
    expect(await inbox(f.customer)).toHaveLength(1);
    expect(h.push.to(phone)).toHaveLength(1);
  });

  it('manual approval: the request goes to owner, managers and front desk (not staff); a decline reaches the customer', async () => {
    const { f, a } = await booking({ status: 'pending' });
    const [manager, desk, staff] = [
      await x.member(f, 'manager'),
      await x.member(f, 'front_desk'),
      await x.member(f, 'staff'),
    ];
    await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(f, a), status: 'pending' });
    expect((await inbox(f.customer))[0]!.title).toBe('Request sent');
    for (const u of [f.owner, manager, desk]) expect((await inbox(u))[0]!.title).toBe('New booking request');
    expect(await inbox(staff)).toEqual([]);

    await x.update(f, a, {
      status: 'cancelled',
      cancelledAt: new Date(),
      cancelledBy: 'business',
      cancelReasonCode: 'declined',
      cancelReason: 'Fully booked that day',
    });
    await x.deliver(TOPICS.BOOKINGS_CANCELLED, {
      ...of(f, a),
      cancelledBy: 'business',
      reasonCode: 'declined',
    });
    expect((await inbox(f.customer)).at(-1)).toMatchObject({
      title: 'Booking not accepted',
      body: expect.stringContaining(': Fully booked that day.'),
    });
  });

  it('the employee doing the service hears about their bookings (not the owner); late cancels are flagged', async () => {
    const stylist = await x.person('Ali Raza');
    const { f, a } = await booking({ staffUserId: stylist.id });
    await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(f, a), status: 'confirmed' });
    await x.deliver(TOPICS.BOOKINGS_CANCELLED, { ...of(f, a), cancelledBy: 'user', late: true });
    expect((await inbox(stylist)).map((n) => n.title)).toEqual(['New booking', 'Late cancellation']);
    expect(await inbox(f.owner)).toEqual([]);
  });

  it('reschedules and missed visits reach the customer', async () => {
    const { f, a } = await booking();
    await x.deliver(TOPICS.BOOKINGS_RESCHEDULED, of(f, a));
    await x.deliver(TOPICS.BOOKINGS_NO_SHOW, of(f, a));
    expect((await inbox(f.customer)).map((n) => n.title)).toEqual(['Booking moved', 'We missed you']);
    expect((await inbox(f.owner)).map((n) => n.title)).toEqual(['Booking moved']);
  });

  it('people on different shards each get theirs once, even when the event comes again', async () => {
    const { f, a } = await booking({ status: 'pending' });
    const manager = await x.member(f, 'manager');
    const event = await x.deliver(TOPICS.BOOKINGS_CREATED, { ...of(f, a), status: 'pending' });
    await x.redeliver(event);
    for (const u of [f.customer, f.owner, manager]) expect(await inbox(u)).toHaveLength(1);
  });
});

describe('Queue', () => {
  async function ticket(userId: bigint | null, sessionDate = '2026-12-01') {
    const f = await x.shop();
    const date = new Date(`${sessionDate}T00:00:00Z`);
    const entry = await x.inShop(f, async (tx) => {
      const session = await tx.queueSession.create({
        data: {
          id: h.world.id(),
          businessId: f.business.id,
          sessionDate: date,
          status: 'open',
          currentNumber: 23,
          gracePeriodSeconds: 300,
        },
      });
      return tx.queueTicket.create({
        data: {
          id: h.world.id(),
          sessionDate: date,
          sessionId: session.id,
          businessId: f.business.id,
          userId,
          ticketNumber: 23,
          calledAt: new Date(`${sessionDate}T09:00:00Z`),
          status: 'called',
        },
      });
    });
    return {
      f,
      entry,
      base: { entryId: entry.id, businessId: f.business.id, sessionDate, userId, ticket: 'A-023' },
    };
  }

  it('counts down, calls (with the time to come by), and tells them if the queue closed', async () => {
    const customer = await x.person('Queue Customer');
    const { base, entry } = await ticket(customer.id);
    await x.deliver(TOPICS.QUEUE_POSITION_UPDATED, { ...base, ahead: 5 });
    await x.deliver(TOPICS.QUEUE_ENTRY_CALLED, base);
    await x.deliver(TOPICS.QUEUE_ENTRY_LEFT, { ...base, reason: 'left' });
    await x.deliver(TOPICS.QUEUE_ENTRY_LEFT, { ...base, reason: 'queue_closed' });
    const messages = await inbox(customer);
    expect(messages.map((n) => [n.title, n.body])).toEqual([
      ['5 people ahead of you', expect.stringContaining('Please start heading over.')],
      ['It’s your turn — A-023', expect.stringContaining('by 14:05.')],
      ['The queue has closed', expect.stringContaining('A-023')],
    ]);
    expect(messages[0]).toMatchObject({
      queueTicketId: entry.id,
      data: { screen: 'queue-ticket', entryId: entry.id.toString() },
    });
  });

  it('walk-ins (no account) get nothing', async () => {
    const { base } = await ticket(null);
    await expect(x.deliver(TOPICS.QUEUE_ENTRY_CALLED, base)).resolves.toBeDefined();
  });
});

describe('Preferences decide pushes; the inbox always has the message', () => {
  it('switching off booking pushes keeps the inbox; “it’s your turn” always pushes', async () => {
    const { f, a } = await booking();
    const phone = await x.device(f.customer);
    await (
      await x.shardOf(f.customer)
    ).notificationPreference.upsert({
      where: { userId: f.customer.id },
      create: { userId: f.customer.id, pushBookingConfirmation: false, pushQueueUpdates: false },
      update: { pushBookingConfirmation: false, pushQueueUpdates: false },
    });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(f, a));
    expect(await inbox(f.customer)).toHaveLength(1);
    expect(h.push.to(phone)).toEqual([]);

    const date = new Date('2026-12-02T00:00:00Z');
    const entry = await x.inShop(f, async (tx) => {
      const session = await tx.queueSession.create({
        data: {
          id: h.world.id(),
          businessId: f.business.id,
          sessionDate: date,
          status: 'open',
          currentNumber: 1,
        },
      });
      return tx.queueTicket.create({
        data: {
          id: h.world.id(),
          sessionDate: date,
          sessionId: session.id,
          businessId: f.business.id,
          userId: f.customer.id,
          ticketNumber: 1,
          status: 'called',
          calledAt: new Date(),
        },
      });
    });
    const base = {
      entryId: entry.id,
      businessId: f.business.id,
      sessionDate: '2026-12-02',
      userId: f.customer.id,
      ticket: 'A-001',
    };
    await x.deliver(TOPICS.QUEUE_POSITION_UPDATED, { ...base, ahead: 1 });
    await x.deliver(TOPICS.QUEUE_ENTRY_CALLED, base);
    expect(h.push.to(phone).map((m) => m.title)).toEqual(['It’s your turn — A-001']);
  });

  it('closed accounts get nothing', async () => {
    const { f, a } = await booking();
    await (
      await x.shardOf(f.customer)
    ).user.update({ where: { id: f.customer.id }, data: { deletedAt: new Date() } });
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(f, a));
    expect(await (await x.shardOf(f.customer)).notification.count({ where: { userId: f.customer.id } })).toBe(
      0,
    );
  });
});

describe('Devices that no longer exist', () => {
  it('are switched off at once (send error) or after the receipt (≈15 min later)', async () => {
    const { f, a } = await booking();
    const [now, later, fine] = [
      await x.device(f.customer, 'gone-now'),
      await x.device(f.customer, 'gone-later'),
      await x.device(f.customer),
    ];
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(f, a));
    const db = await x.shardOf(f.customer);
    const tokens = async () =>
      Object.fromEntries(
        (await db.pushToken.findMany({ where: { userId: f.customer.id } })).map((t) => [t.token, t.isActive]),
      );
    expect(await tokens()).toEqual({ [now]: false, [later]: true, [fine]: true });

    // Receipts aren't checked before 15 minutes.
    expect((await h.notifier.checkReceipts()).checked).toBe(0);
    const r = await h.notifier.checkReceipts(new Date(Date.now() + 16 * 60_000));
    expect(r).toMatchObject({ delivered: expect.any(Number), failed: expect.any(Number) });
    expect(await tokens()).toEqual({ [now]: false, [later]: false, [fine]: true });
    const rows = await db.notification.findMany({ where: { userId: f.customer.id, channel: 'push' } });
    expect(rows.map((n) => n.status).sort()).toEqual(['delivered', 'failed', 'failed']);
  });
});

describe('Inbox and preferences API', () => {
  it('lists my messages newest first with the unread count; read, read all, delete — only mine', async () => {
    const { f, a } = await booking();
    await x.deliver(TOPICS.BOOKINGS_CONFIRMED, of(f, a));
    await x.deliver(TOPICS.BOOKINGS_RESCHEDULED, of(f, a));
    const me = f.customer.auth;
    const list = await request(h.app).get('/v1/notifications').set(me);
    expect(list.body.data.map((n: { title: string }) => n.title)).toEqual([
      'Booking moved',
      'Booking confirmed',
    ]);
    expect(list.body.meta).toMatchObject({ total: 2, unread: 2 });
    expect(JSON.stringify(list.body.data)).not.toContain('channel');

    const first = list.body.data[0].id as string;
    expect(first).toMatch(/^[1-9][0-9]+$/);
    expect((await request(h.app).post(`/v1/notifications/${first}/read`).set(f.owner.auth)).status).toBe(404);
    expect((await request(h.app).post(`/v1/notifications/${first}/read`).set(me)).status).toBe(204);
    expect((await request(h.app).get('/v1/notifications/unread-count').set(me)).body.data).toEqual({
      unread: 1,
    });
    expect((await request(h.app).get('/v1/notifications?unread=true').set(me)).body.data).toHaveLength(1);
    expect((await request(h.app).post('/v1/notifications/read-all').set(me)).body.data).toEqual({
      marked: 1,
    });
    expect((await request(h.app).delete(`/v1/notifications/${first}`).set(me)).status).toBe(204);
    expect((await request(h.app).get('/v1/notifications').set(me)).body.data).toHaveLength(1);
    expect((await request(h.app).get('/v1/notifications')).status).toBe(401);
    expect((await request(h.app).post('/v1/notifications/not-an-id/read').set(me)).status).toBe(400);
  });

  it('preferences: defaults, changes, and marketing needs explicit consent (recorded)', async () => {
    const { f } = await booking();
    const me = f.customer.auth;
    expect((await request(h.app).get('/v1/users/me/notification-prefs').set(me)).body.data).toMatchObject({
      pushBookingConfirmation: true,
      pushQueueUpdates: true,
      marketingEmails: false,
      marketingConsentAt: null,
      queueCalledAlwaysOn: true,
    });
    const on = await request(h.app)
      .put('/v1/users/me/notification-prefs')
      .set(me)
      .send({ pushReminders: false, marketingEmails: true });
    expect(on.body.data).toMatchObject({
      pushReminders: false,
      marketingEmails: true,
      marketingConsentAt: expect.any(String),
    });
    const off = await request(h.app)
      .put('/v1/users/me/notification-prefs')
      .set(me)
      .send({ marketingEmails: false });
    expect(off.body.data.marketingConsentAt).toBeNull();
    expect(
      (await request(h.app).put('/v1/users/me/notification-prefs').set(me).send({ smsEverything: true }))
        .status,
    ).toBe(400);
  });
});

describe('Expo push service client', () => {
  it('sends in batches of 100, maps DeviceNotRegistered, filters non-Expo tokens, reads receipts', async () => {
    const batches: unknown[][] = [];
    const api = express();
    api.use(express.json({ limit: '1mb' }));
    api.post('/send', (req, res) => {
      const msgs = req.body as { to: string }[];
      batches.push(msgs);
      res.json({
        data: msgs.map((m, i) =>
          String(m.to).includes('dead')
            ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } }
            : { status: 'ok', id: `t${batches.length}-${i}` },
        ),
      });
    });
    api.post('/getReceipts', (req, res) => {
      const ids = (req.body as { ids: string[] }).ids;
      res.json({
        data: Object.fromEntries(
          ids.map((id) => [
            id,
            String(id).endsWith('-0')
              ? { status: 'error', message: 'x', details: { error: 'MessageRateExceeded' } }
              : { status: 'ok' },
          ]),
        ),
      });
    });
    const server: Server = api.listen(0);
    await new Promise((r) => server.once('listening', r));
    try {
      const expo = new ExpoPushSender({
        baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      });
      expect(expo.accepts('ExponentPushToken[abc]')).toBe(true);
      expect(expo.accepts('fcm-web-token-123')).toBe(false);
      const messages = Array.from({ length: 150 }, (_, i) => ({
        token: `ExponentPushToken[${i === 3 ? 'dead' : i}]`,
        title: 'T',
        body: 'B',
        data: { screen: 's' },
      }));
      const tickets = await expo.send(messages);
      expect(batches.map((b) => b.length)).toEqual([100, 50]);
      expect(tickets[3]).toEqual({ ok: false, error: 'DeviceNotRegistered', deviceGone: true });
      expect(tickets[4]).toEqual({ ok: true, id: 't1-4' });
      const receipts = await expo.receipts(['t1-0', 't1-4']);
      expect(receipts.get('t1-0')).toEqual({ ok: false, error: 'MessageRateExceeded', deviceGone: false });
      expect(receipts.get('t1-4')).toEqual({ ok: true });
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
