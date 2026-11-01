import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createEvent, TOPICS } from '@buku/kafka';
import { withBilling } from '../../../packages/database/test/services-world.js';
import { addDays, toInstant, wallClock } from '../src/availability/time.js';
import { bookingEventHandler } from '../src/events/handlers.js';
import { TZ, useBookingHarness, type Person, type Salon } from './harness.js';

/**
 * Availability and booking against database v2 (D3d): the databases' own rules are part of what
 * is being tested — the customer's time claimed on their shard (one appointment at a time
 * anywhere), an employee never double-booked on the business's shard.
 */

const h = useBookingHarness();
const person = (...args: Parameters<typeof h.person>) => h.person(...args);
const salon = (...args: Parameters<typeof h.salon>) => h.salon(...args);

/** A day two days from now (comfortably beyond the default 60-minute notice). */
const DAY = () => addDays(wallClock(new Date(), TZ).date, 2);
const at = (date: string, time: string) => toInstant(date, time, TZ)!.toISOString();

const book = (who: Person, s: Salon, startAt: string, extra: Record<string, unknown> = {}) =>
  request(h.app)
    .post('/v1/appointments')
    .set(who.auth)
    .send({ businessId: s.b.publicId, serviceId: s.service.id.toString(), startAt, ...extra });

/** An appointment's row on the business's shard, by its public ID. */
const row = (s: Salon, publicId: string) =>
  h.inSalon(s, (tx) => tx.appointment.findFirstOrThrow({ where: { publicId } }));

describe('Availability', () => {
  it('lists free start times in the business’s timezone, for one or several days', async () => {
    const s = await salon({ staffCount: 2 });
    const res = await request(h.app).get(`/v1/businesses/${s.b.slug}/availability`).query({
      serviceId: s.service.id.toString(),
      date: DAY(),
      days: 2,
    });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data.timezone).toBe(TZ);
    expect(res.body.data.days.map((d: { date: string }) => d.date)).toEqual([DAY(), addDays(DAY(), 1)]);
    const slots = res.body.data.days[0].slots;
    expect(slots[0]).toEqual({
      startAt: at(DAY(), '09:00'),
      endAt: at(DAY(), '09:30'),
      time: '09:00',
      staffIds: s.staff.map((x) => x.id.toString()).sort(),
    });
    expect(slots.at(-1).time).toBe('16:30');
  });

  it('a booked time disappears for that employee, including the clean-up buffer', async () => {
    const s = await salon({ buffer: 15 });
    expect((await book(await person(), s, at(DAY(), '10:00'))).status).toBe(201);
    const slots = (
      await request(h.app)
        .get(`/v1/businesses/${s.b.publicId}/availability`)
        .query({ serviceId: s.service.id.toString(), date: DAY() })
    ).body.data.days[0].slots.map((x: { time: string }) => x.time);
    // 10:00–10:30 + 15 min clean-up: nothing may start from 09:30 (it would run into 10:00) to 10:30.
    expect(slots).toContain('09:15');
    expect(slots).not.toContain('09:30');
    expect(slots).not.toContain('10:30');
    expect(slots).toContain('10:45');
  });

  it('unknown or archived services are not found; past dates have no times', async () => {
    const s = await salon();
    const q = (serviceId: string, date: string) =>
      request(h.app).get(`/v1/businesses/${s.b.publicId}/availability`).query({ serviceId, date });
    expect((await q('999999999', DAY())).status).toBe(404);
    expect((await q('not-an-id', DAY())).status).toBe(400);
    const service = s.service.id.toString();
    expect((await q(service, addDays(DAY(), -10))).body.data.days[0].slots).toEqual([]);
    await h.inSalon(s, (tx) => tx.service.update({ where: { id: s.service.id }, data: { isActive: false } }));
    expect((await q(service, DAY())).status).toBe(404);
  });
});

describe('Booking', () => {
  it('automatic mode: confirmed at once, with a receipt (code + QR content) — nothing else stored', async () => {
    const s = await salon();
    const me = await person();
    const res = await book(me, s, at(DAY(), '11:00'), { notes: 'Short on the sides' });
    expect(res.status).toBe(201);
    const r = res.body.data;
    expect(r.code).toMatch(/^BK-[A-Z2-9]{6}$/);
    expect(r).toMatchObject({
      qr: r.code,
      status: 'confirmed',
      staff: { id: s.staff[0]!.id.toString(), displayName: 'Stylist 1' },
      service: { name: 'Haircut', durationMinutes: 30 },
      local: { date: DAY(), startTime: '11:00', endTime: '11:30', timezone: TZ },
      price: '800.00',
      currency: 'PKR',
      payment: 'pay_at_venue',
      notes: 'Short on the sides',
      policy: { canCancel: true, canReschedule: true },
    });
    const id = await h.appointmentId(s, r.id);
    const history = await h.inSalon(s, (tx) =>
      tx.appointmentEvent.findMany({ where: { appointmentId: id } }),
    );
    expect(history.map((e) => [e.fromStatus, e.toStatus, e.actorType])).toEqual([
      [null, 'confirmed', 'user'],
    ]);
    const events = await h.inSalon(s, (tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    );
    expect(events.map((e) => e.topic)).toEqual(['bookings.created', 'bookings.confirmed']);
    // events carry ids, not names
    expect(JSON.stringify(events, (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v))).not.toContain(
      me.name,
    );
    // The customer's side, on their own shard: their time held as booked, the visit in their list.
    const mine = await h.shardOf(me);
    expect(await mine.userTimeReservation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      appointmentId: id,
      expiresAt: null,
      businessId: s.b.id,
    });
    expect(
      await mine.userAppointment.findUniqueOrThrow({
        where: { userId_appointmentId: { userId: me.id, appointmentId: id } },
      }),
    ).toMatchObject({
      appointmentPublicId: r.id,
      status: 'confirmed',
      businessName: s.b.name,
      serviceName: 'Haircut',
    });
  });

  it('manual mode: pending until the business confirms; front desk may, staff may not', async () => {
    const s = await salon({ settings: { confirmationMode: 'manual' } });
    const res = await book(await person(), s, at(DAY(), '12:00'));
    expect(res.body.data.status).toBe('pending');
    const path = `${s.base}/appointments/${res.body.data.id}`;
    expect(
      (
        await request(h.app)
          .post(`${path}/confirm`)
          .set((await s.member('staff')).auth)
      ).status,
    ).toBe(403);
    const ok = await request(h.app)
      .post(`${path}/confirm`)
      .set((await s.member('front_desk')).auth);
    expect(ok.body.data.status).toBe('confirmed');
    expect((await request(h.app).post(`${path}/confirm`).set(s.owner.auth)).body.error.code).toBe(
      'INVALID_TRANSITION',
    );
  });

  it('a declined request is cancelled with reason "declined"', async () => {
    const s = await salon({ settings: { confirmationMode: 'manual' } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '12:30'));
    const declined = await request(h.app)
      .post(`${s.base}/appointments/${res.body.data.id}/decline`)
      .set(s.owner.auth)
      .send({ reason: 'Fully booked that day' });
    expect(declined.body.data).toMatchObject({
      status: 'cancelled',
      cancellation: { reasonCode: 'declined', cancelledBy: 'business' },
    });
    const receipt = await request(h.app).get(`/v1/appointments/${res.body.data.id}`).set(me.auth);
    expect(receipt.body.data.cancellation).toMatchObject({
      reasonCode: 'declined',
      reason: 'Fully booked that day',
    });
  });

  it('"anyone available" goes to the least-booked person; a taken person is refused', async () => {
    const s = await salon({ staffCount: 2 });
    const [one, two] = [
      await book(await person(), s, at(DAY(), '09:00')),
      await book(await person(), s, at(DAY(), '09:00')),
    ];
    expect(new Set([one.body.data.staff.id, two.body.data.staff.id]).size).toBe(2);
    const third = await book(await person(), s, at(DAY(), '09:00'));
    expect([third.status, third.body.error.code]).toEqual([409, 'SLOT_UNAVAILABLE']);
    // Chosen person, already busy at 09:00:
    const chosen = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[0]!.id.toString() });
    expect(chosen.status).toBe(409);
  });

  it('ten people racing for the last slot: exactly one gets it', async () => {
    const s = await salon();
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const results = await Promise.all(people.map((p) => book(p, s, at(DAY(), '15:00'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE'),
    ).toBe(true);
  });

  it('two people, the same employee, the very same instant: one booking, one clear “taken”, nothing left behind', async () => {
    // Asked by the owner (2026-10-18). Run several times: the order is the database's, every time.
    for (let run = 0; run < 5; run++) {
      const s = await salon();
      const [ali, sara] = [await person(), await person()];
      const startAt = at(DAY(), '11:00');
      // Both requests are built first, then sent together.
      const results = await Promise.all(
        [ali, sara].map((p) => book(p, s, startAt, { staffId: s.staff[0]!.id.toString() })),
      );
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const lost = results.findIndex((r) => r.status === 409);
      expect(results[lost]!.body.error.code).toBe('SLOT_UNAVAILABLE');
      // Exactly one live appointment for that employee then, on the business's shard...
      const live = await h.inSalon(s, (tx) =>
        tx.appointmentIndex.count({
          where: { staffId: s.staff[0]!.id, live: true, startAt: new Date(startAt) },
        }),
      );
      expect(live).toBe(1);
      // ...and the one who lost holds no time on their own shard: they can book again at once.
      const loser = [ali, sara][lost]!;
      expect(await (await h.shardOf(loser)).userTimeReservation.count({ where: { userId: loser.id } })).toBe(
        0,
      );
    }
  });

  it('a busy hour: many people booking at once get a booking or a clear “taken”, never a server error', async () => {
    const s = await salon({ staffCount: 3 });
    const people = await Promise.all(Array.from({ length: 24 }, () => person()));
    const times = ['10:00', '10:15', '10:30', '10:45'];
    const results = await Promise.all(people.map((p, i) => book(p, s, at(DAY(), times[i % times.length]!))));
    // Conflicts between the transactions (write conflicts, deadlocks) are retried, not shown as 500s.
    expect(results.map((r) => r.status).filter((st) => st !== 201 && st !== 409)).toEqual([]);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'SLOT_UNAVAILABLE'),
    ).toBe(true);
    // Every one of the three people is booked at each start time that doesn't overlap their own earlier one.
    expect(results.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(3);
  });

  it('a customer can’t hold two overlapping appointments, even at different businesses (D-036)', async () => {
    const [a, b] = [await salon(), await salon()];
    const me = await person();
    expect((await book(me, a, at(DAY(), '13:00'))).status).toBe(201);
    const clash = await book(me, b, at(DAY(), '13:15'));
    expect([clash.status, clash.body.error.code]).toEqual([409, 'APPOINTMENT_OVERLAP']);
  });

  it('the same time at two businesses, booked at once: one booking, and a clear “you already have one”', async () => {
    const [a, b] = [await salon(), await salon()];
    const me = await person();
    const results = await Promise.all([book(me, a, at(DAY(), '16:00')), book(me, b, at(DAY(), '16:00'))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('APPOINTMENT_OVERLAP');
    // Another time the same day is fine.
    expect((await book(me, b, at(DAY(), '11:00'))).status).toBe(201);
  });

  it('caps future bookings per customer per business (D-037), even when sent at once', async () => {
    const s = await salon({ staffCount: 3, settings: { maxFutureBookingsPerCustomer: 2 } });
    const me = await person();
    const results = await Promise.all(
      ['09:00', '10:00', '11:00', '12:00'].map((t) => book(me, s, at(DAY(), t))),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'LIMIT_REACHED')).toBe(
      true,
    );
  });

  it('only offered times can be booked: outside hours, off-step, too soon, too far, in the past', async () => {
    const s = await salon({ settings: { bookingHorizonDays: 30 } });
    const me = await person();
    const code = async (startAt: string): Promise<string> =>
      ((await book(me, s, startAt)).body as { error: { code: string } }).error.code;
    expect(await code(at(DAY(), '08:00'))).toBe('SLOT_UNAVAILABLE');
    expect(await code(at(DAY(), '10:07'))).toBe('SLOT_UNAVAILABLE');
    expect(await code(new Date(Date.now() + 10 * 60_000).toISOString())).toBe('SLOT_TOO_SOON');
    expect(await code(at(addDays(DAY(), 40), '10:00'))).toBe('SLOT_TOO_FAR_AHEAD');
    expect(await code(new Date(Date.now() - 3_600_000).toISOString())).toBe('SLOT_IN_PAST');
  });

  it('employee accounts can’t book; requests must be signed in and well-formed', async () => {
    const s = await salon();
    const employee = await person('staff');
    const res = await book(employee, s, at(DAY(), '10:00'));
    expect([res.status, res.body.error.code]).toEqual([403, 'BOOKING_NOT_ALLOWED']);
    expect((await request(h.app).post('/v1/appointments').send({})).status).toBe(401);
    expect((await book(await person(), s, at(DAY(), '10:00'), { price: 1 })).status).toBe(400);
    expect((await book(await person(), s, 'tomorrow at ten')).status).toBe(400);
  });
});

describe('My appointments (receipts)', () => {
  it('only the customer sees their receipt; lists split upcoming and past', async () => {
    const s = await salon();
    const me = await person();
    const res = await book(me, s, at(DAY(), '14:00'));
    expect(
      (
        await request(h.app)
          .get(`/v1/appointments/${res.body.data.id}`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
    const upcoming = await request(h.app).get('/v1/appointments').set(me.auth);
    expect(upcoming.body.data.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);
    expect(upcoming.body.meta).toMatchObject({ total: 1 });
    expect((await request(h.app).get('/v1/appointments?scope=past').set(me.auth)).body.data).toEqual([]);
  });

  it('cancelling: reason, "book later" reminder, late flag inside the window; the time is free again', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 168 } }); // a week: DAY() is inside it
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    const cancel = await request(h.app)
      .post(`/v1/appointments/${res.body.data.id}/cancel`)
      .set(me.auth)
      .send({ reasonCode: 'schedule_conflict', note: 'Exam moved', bookLater: true });
    expect(cancel.body.data).toMatchObject({
      status: 'cancelled',
      cancellation: { cancelledBy: 'user', reasonCode: 'schedule_conflict', reason: 'Exam moved' },
      policy: { canCancel: false },
    });
    const cancelled = await row(s, res.body.data.id as string);
    expect(cancelled.lateCancellation).toBe(true);
    expect(cancelled.rebookReminderAt!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
    // The customer's time is theirs again, and the late cancellation counts (D-078).
    const mine = await h.shardOf(me);
    expect(await mine.userTimeReservation.count({ where: { appointmentId: cancelled.id } })).toBe(0);
    expect(
      await mine.userVisitOutcome.findUniqueOrThrow({
        where: { userId_refId: { userId: me.id, refId: cancelled.id } },
      }),
    ).toMatchObject({ kind: 'late_cancel', source: 'appointment' });
    expect(
      (
        await request(h.app)
          .post(`/v1/appointments/${res.body.data.id}/cancel`)
          .set(me.auth)
          .send({ reasonCode: 'other' })
      ).status,
    ).toBe(409);
    // Someone else can now take 10:00.
    expect((await book(await person(), s, at(DAY(), '10:00'))).status).toBe(201);
  });

  it('closing the account cancels every visit still to come, once, as the customer; arrived ones stay', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 168 } }); // a week: DAY() is inside it
    const me = await person();
    const first = (await book(me, s, at(DAY(), '10:00'))).body.data.id as string;
    const second = (await book(me, s, at(DAY(), '12:00'))).body.data.id as string;
    const arrived = (await book(me, s, at(DAY(), '14:00'))).body.data.id as string;
    await h.inSalon(s, (tx) =>
      tx.appointment.updateMany({ where: { publicId: arrived }, data: { checkedInAt: new Date() } }),
    );
    const someoneElse = (await book(await person(), s, at(DAY(), '16:00'))).body.data.id as string;

    const handle = bookingEventHandler({
      staff: {} as never,
      appointments: h.booking.appointments,
      persons: h.booking.persons,
    });
    const event = createEvent({
      type: TOPICS.USERS_DELETED,
      source: 'auth-service',
      subject: me.id.toString(),
      data: { userId: me.id.toString(), purgeAfter: new Date(Date.now() + 30 * 86_400_000).toISOString() },
    });
    const ctx = { topic: event.type, partition: 0, offset: '0', key: null, attempt: 1 };
    await handle(event, ctx);
    await handle(event, ctx); // delivered twice: nothing more happens

    const rows = await h.inSalon(s, (tx) =>
      tx.appointment.findMany({ where: { publicId: { in: [first, second, arrived, someoneElse] } } }),
    );
    const byId = new Map(rows.map((r) => [r.publicId, r]));
    for (const id of [first, second]) {
      expect(byId.get(id)).toMatchObject({
        status: 'cancelled',
        cancelledBy: 'user',
        cancelReasonCode: 'other',
        lateCancellation: true,
      });
    }
    expect(byId.get(arrived)!.status).toBe('confirmed');
    expect(byId.get(someoneElse)!.status).toBe('confirmed');
    // The business is told, once per visit.
    const told = await h.inSalon(s, (tx) =>
      tx.outboxEvent.findMany({
        where: {
          aggregateId: { in: [byId.get(first)!.id, byId.get(second)!.id] },
          topic: 'bookings.cancelled',
        },
      }),
    );
    expect(told).toHaveLength(2);
    // The times are free for others again.
    expect((await book(await person(), s, at(DAY(), '10:00'))).status).toBe(201);
  });

  it('cancelling well before the window is not late', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 0 } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    await request(h.app)
      .post(`/v1/appointments/${res.body.data.id}/cancel`)
      .set(me.auth)
      .send({ reasonCode: 'not_needed' });
    const cancelled = await row(s, res.body.data.id as string);
    expect([cancelled.lateCancellation, cancelled.rebookReminderAt]).toEqual([false, null]);
  });

  it('rescheduling moves the booking (same person when free), even to an overlapping time', async () => {
    const s = await salon({ staffCount: 2 });
    const me = await person();
    const first = await book(me, s, at(DAY(), '10:00'));
    const moved = await request(h.app)
      .post(`/v1/appointments/${first.body.data.id}/reschedule`)
      .set(me.auth)
      .send({ startAt: at(DAY(), '10:15') });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({
      local: { startTime: '10:15' },
      staff: { id: first.body.data.staff.id },
      rescheduledFromId: first.body.data.id,
    });
    const old = await row(s, first.body.data.id as string);
    expect(old.status).toBe('rescheduled');
    expect(old.code).not.toBe(moved.body.data.code);
    // On the customer's shard: only the new time is held; the list knows both.
    const mine = await h.shardOf(me);
    const held = await mine.userTimeReservation.findMany({ where: { userId: me.id } });
    expect(held.map((c) => c.startAt.toISOString())).toEqual([at(DAY(), '10:15')]);
    expect(
      (await mine.userAppointment.findMany({ where: { userId: me.id }, orderBy: { startAt: 'asc' } })).map(
        (a) => a.status,
      ),
    ).toEqual(['rescheduled', 'confirmed']);
  });

  it('rescheduling is refused inside the cancellation window', async () => {
    const s = await salon({ settings: { cancellationWindowHours: 168 } });
    const me = await person();
    const res = await book(me, s, at(DAY(), '10:00'));
    expect(res.body.data.policy.canReschedule).toBe(false);
    const moved = await request(h.app)
      .post(`/v1/appointments/${res.body.data.id}/reschedule`)
      .set(me.auth)
      .send({ startAt: at(DAY(), '11:00') });
    expect(moved.body.error.code).toBe('CANCELLATION_WINDOW_PASSED');
  });
});

describe('The business’s list (serve customers with or without a phone)', () => {
  it('shows the day, finds a receipt by code or a customer by name, without contact details', async () => {
    const s = await salon({ staffCount: 2 });
    const ayesha = await person('user', 'Ayesha Khan');
    const res = await book(ayesha, s, at(DAY(), '16:00'));
    const code: string = res.body.data.code;

    const day = await request(h.app).get(`${s.base}/appointments`).query({ date: DAY() }).set(s.owner.auth);
    expect(day.body.data.items.map((a: { code: string }) => a.code)).toEqual([code]);
    const item = day.body.data.items[0];
    expect(item.customer).toEqual({
      id: ayesha.publicId,
      name: 'Ayesha Khan',
      reliability: { label: 'New customer', showsUpPercent: null },
    });
    expect(JSON.stringify(item)).not.toMatch(/email|phone|avatar/i);

    // A week (the calendar): the day before shows nothing, a week from it includes this one.
    const before = addDays(DAY(), -1);
    expect(
      (await request(h.app).get(`${s.base}/appointments`).query({ date: before }).set(s.owner.auth)).body.data
        .items,
    ).toEqual([]);
    const week = await request(h.app)
      .get(`${s.base}/appointments`)
      .query({ date: before, days: 7 })
      .set(s.owner.auth);
    expect(week.body.data.items.map((a: { code: string }) => a.code)).toEqual([code]);
    await request(h.app)
      .get(`${s.base}/appointments`)
      .query({ date: before, days: 8 })
      .set(s.owner.auth)
      .expect(400);

    const byCode = await request(h.app)
      .get(`${s.base}/appointments`)
      .query({ q: code.toLowerCase() })
      .set(s.owner.auth);
    expect(byCode.body.data.items.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);
    const byName = await request(h.app)
      .get(`${s.base}/appointments`)
      .query({ q: 'ayesha' })
      .set(s.owner.auth);
    expect(byName.body.data.items).toHaveLength(1);
    // Another business can't find it.
    const other = await salon();
    expect(
      (await request(h.app).get(`${other.base}/appointments`).query({ q: code }).set(other.owner.auth)).body
        .data.items,
    ).toEqual([]);
  });

  it('staff see only their own appointments; outsiders get 404; cancelling needs a reason', async () => {
    const s = await salon({ staffCount: 2 });
    const stylist = await s.member('staff');
    await h.inSalon(s, (tx) =>
      tx.staff.update({ where: { id: s.staff[0]!.id }, data: { userId: stylist.id } }),
    );
    const mine = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[0]!.id.toString() });
    const theirs = await book(await person(), s, at(DAY(), '09:00'), { staffId: s.staff[1]!.id.toString() });

    const list = await request(h.app).get(`${s.base}/appointments`).query({ date: DAY() }).set(stylist.auth);
    expect(list.body.data.items.map((a: { id: string }) => a.id)).toEqual([mine.body.data.id]);
    expect(
      (await request(h.app).get(`${s.base}/appointments/${theirs.body.data.id}`).set(stylist.auth)).status,
    ).toBe(404);
    expect(
      (
        await request(h.app)
          .get(`${s.base}/appointments`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);

    const path = `${s.base}/appointments/${theirs.body.data.id}/cancel`;
    expect((await request(h.app).post(path).set(s.owner.auth).send({})).status).toBe(400);
    const cancelled = await request(h.app).post(path).set(s.owner.auth).send({ reason: 'Stylist is ill' });
    expect(cancelled.body.data.cancellation).toMatchObject({
      cancelledBy: 'business',
      reasonCode: 'business_unavailable',
      late: false,
    });
  });
});

describe('Customers book for free (D-101)', () => {
  it('no BUKU limit on bookings, at one business or many, even if charging customers were switched on', async () => {
    await withBilling(h.world, 'user', async () => {
      const [a, b] = [await salon({ staffCount: 2 }), await salon({ staffCount: 2 })];
      const me = await person();
      for (const [s, time] of [
        [a, '09:00'],
        [b, '10:00'],
        [a, '11:00'],
        [b, '12:00'],
      ] as const) {
        expect((await book(me, s, at(DAY(), time))).status).toBe(201);
      }
      // The next day too: only each business's own cap on upcoming bookings applies (3 here).
      expect((await book(me, a, at(addDays(DAY(), 1), '09:00'))).status).toBe(201);
    });
  });
});

describe('The customer’s side, kept on their own shard (D3d, DB-014)', () => {
  it('a claim left by a booking that never happened is given back; one whose booking did is kept', async () => {
    const s = await salon();
    const me = await person();
    const mine = await h.shardOf(me);
    // A booking that crashed after claiming the customer's time: no appointment behind it.
    const orphan = h.world.id();
    const startAt = new Date(at(DAY(), '10:00'));
    await mine.userTimeReservation.create({
      data: {
        id: orphan,
        userId: me.id,
        businessId: s.b.id,
        startAt,
        endAt: new Date(startAt.getTime() + 30 * 60_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    // And one whose appointment exists, though the step that marks the claim booked was lost.
    const booked = await book(me, s, at(DAY(), '12:00'));
    const id = await h.appointmentId(s, booked.body.data.id as string);
    await mine.userTimeReservation.update({
      where: { id },
      data: { appointmentId: null, expiresAt: new Date(Date.now() - 1000) },
    });
    // The time the orphan held is blocked until the sweeper comes by.
    expect((await book(me, s, at(DAY(), '10:00'))).body.error.code).toBe('APPOINTMENT_OVERLAP');

    await h.booking.sweeper.sweep();
    expect(await mine.userTimeReservation.count({ where: { id: orphan } })).toBe(0);
    expect(await mine.userTimeReservation.findUniqueOrThrow({ where: { id } })).toMatchObject({
      appointmentId: id,
      expiresAt: null,
    });
    expect((await book(me, s, at(DAY(), '10:00'))).status).toBe(201);
  });

  it('booking-service’s own events bring a customer’s list back up to date, however often they come', async () => {
    const s = await salon();
    const me = await person();
    const res = await book(me, s, at(DAY(), '14:00'));
    const id = await h.appointmentId(s, res.body.data.id as string);
    await request(h.app)
      .post(`${s.base}/appointments/${res.body.data.id}/cancel`)
      .set(s.owner.auth)
      .send({ reason: 'Closed for a family event' });
    // As if the customer's shard had missed every step after the business's commit:
    const mine = await h.shardOf(me);
    await mine.userAppointment.deleteMany({ where: { userId: me.id } });
    const handle = bookingEventHandler({
      staff: {} as never,
      appointments: {} as never,
      persons: h.booking.persons,
    });
    const event = createEvent({
      type: TOPICS.BOOKINGS_CANCELLED,
      source: 'booking-service',
      subject: id.toString(),
      data: { appointmentId: id.toString(), businessId: s.b.id.toString(), userId: me.id.toString() },
    });
    const ctx = { topic: event.type, partition: 0, offset: '0', key: null, attempt: 1 };
    await handle(event, ctx);
    await handle(event, ctx);
    expect(await mine.userAppointment.findMany({ where: { userId: me.id } })).toEqual([
      expect.objectContaining({ appointmentId: id, status: 'cancelled' }),
    ]);
    expect(await mine.userTimeReservation.count({ where: { userId: me.id } })).toBe(0);
    // And "my appointments" reads it.
    const past = await request(h.app).get('/v1/appointments?scope=past').set(me.auth);
    expect(past.body.data.map((a: { id: string }) => a.id)).toEqual([res.body.data.id]);
  });
});
