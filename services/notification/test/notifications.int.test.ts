import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { maintainPartitions, type Database } from '@buku/database';
import { TOPICS, type EventHandler } from '@buku/kafka';
import express, { type Express } from 'express';
import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Notifier } from '../src/notifier.js';
import { createBusinessFixture } from '../../../packages/database/test/fixtures.js';
import { ExpoPushSender } from '../src/push/expo.js';
import { booking as bookingIn, createHarness, helpers, type FakePush, type Harness } from './harness.js';

/**
 * Booking and queue events → inbox and push, against the real database. A
 * fake push sender records what each device would get; tokens containing
 * "gone" behave like uninstalled apps.
 */

let h: Harness;
let app: Express;
let db: Database;
let redis: Redis;
let handle: EventHandler;
let notifier: Notifier;
let push: FakePush;
let x: ReturnType<typeof helpers>;

beforeAll(async () => {
  h = await createHarness('notification-int-test');
  ({ app, db, redis, handle, notifier, push } = h);
  x = helpers(h);
});

afterAll(async () => {
  await db.$disconnect();
  await redis.quit();
});

const ctx = { topic: 'test', partition: 0, offset: '0', key: null, attempt: 1 };
const deliver = (...args: Parameters<ReturnType<typeof helpers>['deliver']>) => x.deliver(...args);
const device = (userId: string, label?: string) => x.device(userId, label);
const inbox = (userId: string) => x.inbox(userId);
const authFor = (userId: string) => x.authFor(userId);
const booking = (opts: { staffUserId?: string; status?: 'pending' | 'confirmed' } = {}) =>
  bookingIn(db, opts);
const member = (businessId: string, role: 'manager' | 'front_desk' | 'staff') => x.member(businessId, role);

describe('Bookings', () => {
  it('automatic booking: the business hears “new booking”, the customer gets the confirmation with the code', async () => {
    const { f, a } = await booking();
    const [phone, tablet] = [await device(f.customer.id), await device(f.customer.id)];
    const ownerPhone = await device(f.owner.id);

    await deliver(TOPICS.BOOKINGS_CREATED, { appointmentId: a.id, status: 'confirmed' });
    expect((await inbox(f.owner.id)).map((n) => n.title)).toEqual(['New booking']);
    expect(push.to(ownerPhone)[0]!.body).toMatch(/^Ayesha K\. booked Haircut on .+, 10:30 with Staff A\.$/);
    expect(await inbox(f.customer.id)).toEqual([]);

    const event = await deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    const [confirmed] = await inbox(f.customer.id);
    expect(confirmed).toMatchObject({
      title: 'Booking confirmed',
      appointmentId: a.id,
      data: { screen: 'appointment', appointmentId: a.id },
    });
    expect(confirmed!.body).toContain(`Your code: ${a.confirmationCode}`);
    expect([push.to(phone).length, push.to(tablet).length]).toEqual([1, 1]);
    expect(
      await db.notification.count({ where: { userId: f.customer.id, channel: 'push', status: 'sent' } }),
    ).toBe(2);

    // Kafka delivers twice sometimes: nothing is duplicated.
    await handle(event, ctx);
    expect(await inbox(f.customer.id)).toHaveLength(1);
    expect(push.to(phone)).toHaveLength(1);
  });

  it('manual approval: the request goes to owner, managers and front desk (not staff); a decline reaches the customer', async () => {
    const { f, a } = await booking({ status: 'pending' });
    const [manager, desk, staff] = [
      await member(f.business.id, 'manager'),
      await member(f.business.id, 'front_desk'),
      await member(f.business.id, 'staff'),
    ];
    await deliver(TOPICS.BOOKINGS_CREATED, { appointmentId: a.id, status: 'pending' });
    expect((await inbox(f.customer.id))[0]!.title).toBe('Request sent');
    for (const u of [f.owner, manager, desk])
      expect((await inbox(u.id))[0]!.title).toBe('New booking request');
    expect(await inbox(staff.id)).toEqual([]);

    await db.appointment.update({
      where: { id: a.id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancelledBy: 'business',
        cancelReasonCode: 'declined',
        cancelReason: 'Fully booked that day',
      },
    });
    await deliver(TOPICS.BOOKINGS_CANCELLED, {
      appointmentId: a.id,
      cancelledBy: 'business',
      reasonCode: 'declined',
    });
    expect((await inbox(f.customer.id)).at(-1)).toMatchObject({
      title: 'Booking not accepted',
      body: expect.stringContaining(': Fully booked that day.'),
    });
  });

  it('the employee doing the service hears about their bookings (not the owner); late cancels are flagged', async () => {
    const stylist = await db.user.create({
      data: { name: 'Ali Raza', emailHash: randomUUID().replace(/-/g, '').padEnd(64, '1') },
    });
    const { f, a } = await booking({ staffUserId: stylist.id });
    await deliver(TOPICS.BOOKINGS_CREATED, { appointmentId: a.id, status: 'confirmed' });
    await deliver(TOPICS.BOOKINGS_CANCELLED, { appointmentId: a.id, cancelledBy: 'user', late: true });
    expect((await inbox(stylist.id)).map((n) => n.title)).toEqual(['New booking', 'Late cancellation']);
    expect(await inbox(f.owner.id)).toEqual([]);
  });

  it('reschedules and missed visits reach the customer', async () => {
    const { f, a } = await booking();
    await deliver(TOPICS.BOOKINGS_RESCHEDULED, { appointmentId: a.id });
    await deliver(TOPICS.BOOKINGS_NO_SHOW, { appointmentId: a.id });
    expect((await inbox(f.customer.id)).map((n) => n.title)).toEqual(['Booking moved', 'We missed you']);
    expect((await inbox(f.owner.id)).map((n) => n.title)).toEqual(['Booking moved']);
  });
});

describe('Queue', () => {
  async function ticket(userId: string | null) {
    const f = await createBusinessFixture(db);
    const session = await db.queueSession.create({
      data: {
        businessId: f.business.id,
        sessionDate: new Date('2026-12-01'),
        status: 'open',
        currentNumber: 1,
        gracePeriodSeconds: 300,
      },
    });
    const entry = await db.queueEntry.create({
      data: {
        sessionId: session.id,
        userId,
        ticketNumber: 23,
        calledAt: new Date('2026-12-01T09:00:00Z'),
        status: 'called',
      },
    });
    return { f, entry, base: { entryId: entry.id, businessId: f.business.id, userId, ticket: 'A-023' } };
  }

  it('counts down, calls (with the time to come by), and tells them if the queue closed', async () => {
    const customer = (await createBusinessFixture(db)).customer;
    const { base } = await ticket(customer.id);
    await deliver(TOPICS.QUEUE_POSITION_UPDATED, { ...base, ahead: 5 });
    await deliver(TOPICS.QUEUE_ENTRY_CALLED, base);
    await deliver(TOPICS.QUEUE_ENTRY_LEFT, { ...base, reason: 'left' });
    await deliver(TOPICS.QUEUE_ENTRY_LEFT, { ...base, reason: 'queue_closed' });
    expect((await inbox(customer.id)).map((n) => [n.title, n.body])).toEqual([
      ['5 people ahead of you', expect.stringContaining('Please start heading over.')],
      ['It’s your turn — A-023', expect.stringContaining('by 14:05.')],
      ['The queue has closed', expect.stringContaining('A-023')],
    ]);
  });

  it('walk-ins (no account) get nothing', async () => {
    const { base } = await ticket(null);
    await expect(deliver(TOPICS.QUEUE_ENTRY_CALLED, base)).resolves.toBeDefined();
  });
});

describe('Preferences decide pushes; the inbox always has the message', () => {
  it('switching off booking pushes keeps the inbox; “it’s your turn” always pushes', async () => {
    const { f, a } = await booking();
    const phone = await device(f.customer.id);
    await db.notificationPreference.upsert({
      where: { userId: f.customer.id },
      create: { userId: f.customer.id, pushBookingConfirmation: false, pushQueueUpdates: false },
      update: { pushBookingConfirmation: false, pushQueueUpdates: false },
    });
    await deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    expect(await inbox(f.customer.id)).toHaveLength(1);
    expect(push.to(phone)).toEqual([]);

    const session = await db.queueSession.create({
      data: {
        businessId: f.business.id,
        sessionDate: new Date('2026-12-02'),
        status: 'open',
        currentNumber: 1,
      },
    });
    const entry = await db.queueEntry.create({
      data: {
        sessionId: session.id,
        userId: f.customer.id,
        ticketNumber: 1,
        status: 'called',
        calledAt: new Date(),
      },
    });
    const base = { entryId: entry.id, businessId: f.business.id, userId: f.customer.id, ticket: 'A-001' };
    await deliver(TOPICS.QUEUE_POSITION_UPDATED, { ...base, ahead: 1 });
    await deliver(TOPICS.QUEUE_ENTRY_CALLED, base);
    expect(push.to(phone).map((m) => m.title)).toEqual(['It’s your turn — A-001']);
  });

  it('deleted accounts get nothing', async () => {
    const { f, a } = await booking();
    await db.user.update({ where: { id: f.customer.id }, data: { deletedAt: new Date() } });
    await deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    expect(await db.notification.count({ where: { userId: f.customer.id } })).toBe(0);
  });
});

describe('Devices that no longer exist', () => {
  it('are switched off at once (send error) or after the receipt (≈15 min later)', async () => {
    const { f, a } = await booking();
    const [now, later, fine] = [
      await device(f.customer.id, 'gone-now'),
      await device(f.customer.id, 'gone-later'),
      await device(f.customer.id),
    ];
    await deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    const tokens = async () =>
      Object.fromEntries(
        (await db.pushToken.findMany({ where: { userId: f.customer.id } })).map((t) => [t.token, t.isActive]),
      );
    expect(await tokens()).toEqual({ [now]: false, [later]: true, [fine]: true });

    // Receipts aren't checked before 15 minutes.
    expect((await notifier.checkReceipts()).checked).toBe(0);
    const r = await notifier.checkReceipts(new Date(Date.now() + 16 * 60_000));
    expect(r).toMatchObject({ delivered: expect.any(Number), failed: expect.any(Number) });
    expect(await tokens()).toEqual({ [now]: false, [later]: false, [fine]: true });
    const rows = await db.notification.findMany({
      where: { userId: f.customer.id, channel: 'push' },
      include: {},
    });
    expect(rows.map((n) => n.status).sort()).toEqual(['delivered', 'failed', 'failed']);
  });
});

describe('Inbox and preferences API', () => {
  it('lists my messages newest first with the unread count; read, read all, delete — only mine', async () => {
    const { f, a } = await booking();
    await deliver(TOPICS.BOOKINGS_CONFIRMED, { appointmentId: a.id });
    await deliver(TOPICS.BOOKINGS_RESCHEDULED, { appointmentId: a.id });
    const me = await authFor(f.customer.id);
    const list = await request(app).get('/v1/notifications').set(me);
    expect(list.body.data.map((n: { title: string }) => n.title)).toEqual([
      'Booking moved',
      'Booking confirmed',
    ]);
    expect(list.body.meta).toMatchObject({ total: 2, unread: 2 });
    expect(JSON.stringify(list.body.data)).not.toContain('channel');

    const first = list.body.data[0].id as string;
    expect(
      (
        await request(app)
          .post(`/v1/notifications/${first}/read`)
          .set(await authFor(f.owner.id))
      ).status,
    ).toBe(404);
    expect((await request(app).post(`/v1/notifications/${first}/read`).set(me)).status).toBe(204);
    expect((await request(app).get('/v1/notifications/unread-count').set(me)).body.data).toEqual({
      unread: 1,
    });
    expect((await request(app).get('/v1/notifications?unread=true').set(me)).body.data).toHaveLength(1);
    expect((await request(app).post('/v1/notifications/read-all').set(me)).body.data).toEqual({ marked: 1 });
    expect((await request(app).delete(`/v1/notifications/${first}`).set(me)).status).toBe(204);
    expect((await request(app).get('/v1/notifications').set(me)).body.data).toHaveLength(1);
    expect((await request(app).get('/v1/notifications')).status).toBe(401);
  });

  it('preferences: defaults, changes, and marketing needs explicit consent (recorded)', async () => {
    const { f } = await booking();
    const me = await authFor(f.customer.id);
    expect((await request(app).get('/v1/users/me/notification-prefs').set(me)).body.data).toMatchObject({
      pushBookingConfirmation: true,
      pushQueueUpdates: true,
      marketingEmails: false,
      marketingConsentAt: null,
      queueCalledAlwaysOn: true,
    });
    const on = await request(app)
      .put('/v1/users/me/notification-prefs')
      .set(me)
      .send({ pushReminders: false, marketingEmails: true });
    expect(on.body.data).toMatchObject({
      pushReminders: false,
      marketingEmails: true,
      marketingConsentAt: expect.any(String),
    });
    const off = await request(app)
      .put('/v1/users/me/notification-prefs')
      .set(me)
      .send({ marketingEmails: false });
    expect(off.body.data.marketingConsentAt).toBeNull();
    expect(
      (await request(app).put('/v1/users/me/notification-prefs').set(me).send({ smsEverything: true }))
        .status,
    ).toBe(400);
  });
});

describe('Housekeeping', () => {
  it('monthly partitions are kept ahead and the catch-all partitions stay empty', async () => {
    const r = await maintainPartitions(db);
    expect(r).toEqual({ ran: true, strayRows: {} });
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
          m.to.includes('dead')
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
            id.endsWith('-0')
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
