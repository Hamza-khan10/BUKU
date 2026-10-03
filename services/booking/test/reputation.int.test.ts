import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useBookingHarness, type Person, type Salon } from './harness.js';

/**
 * Customer reliability (encourage, don't punish) and the business's
 * cancellation report, against the real database.
 */

const h = useBookingHarness();
const HOUR = 60;
const DAY = 24 * HOUR;

/** A past appointment for `customer` ending in `outcome`, `daysAgo` days ago. */
async function past(
  s: Salon,
  customer: Person,
  daysAgo: number,
  outcome: 'completed' | 'checked_in' | 'no_show' | 'cancel' | 'late_cancel' | 'business_cancel' | 'declined',
  extra: { reason?: 'schedule_conflict' | 'illness' | 'too_expensive'; rebookLater?: boolean } = {},
) {
  const a = await h.appointment(s, customer, -daysAgo * DAY + 7 * HOUR);
  const startAt = (await h.db.appointment.findUniqueOrThrow({ where: { id: a.id } })).startAt;
  const cancelled = (by: 'user' | 'business', code: string, late = false) => ({
    status: 'cancelled' as const,
    cancelledAt: new Date(startAt.getTime() - (late ? 1 : 48) * 3_600_000),
    cancelledBy: by,
    cancelReasonCode: code as never,
    lateCancellation: late,
    ...(extra.rebookLater && { rebookReminderAt: new Date(startAt.getTime() + 7 * 86_400_000) }),
  });
  const data =
    outcome === 'completed'
      ? { status: 'completed' as const }
      : outcome === 'checked_in'
        ? { checkedInAt: startAt }
        : outcome === 'no_show'
          ? { status: 'no_show' as const }
          : outcome === 'cancel'
            ? cancelled('user', extra.reason ?? 'schedule_conflict')
            : outcome === 'late_cancel'
              ? cancelled('user', extra.reason ?? 'illness', true)
              : outcome === 'business_cancel'
                ? cancelled('business', 'business_unavailable')
                : cancelled('business', 'declined');
  await h.db.appointment.update({ where: { id: a.id }, data });
  return a;
}

describe('Customer reliability', () => {
  it('the customer sees the figure and what it’s made of; ordinary cancels never count; queues count too', async () => {
    const s = await h.salon({ staffCount: 3 });
    const c = await h.person();
    const mine = () => request(h.app).get('/v1/appointments/reliability').set(c.auth).expect(200);

    await past(s, c, 40, 'completed');
    await past(s, c, 30, 'cancel'); // ordinary: no effect
    expect((await mine()).body.data).toMatchObject({
      showsUpPercent: null,
      label: 'New customer',
      basedOn: 1,
    });

    for (const d of [20, 15, 10, 9, 8, 7, 6]) await past(s, c, d, 'completed');
    await past(s, c, 5, 'checked_in');
    await past(s, c, 4, 'no_show');
    await past(s, c, 3, 'late_cancel');
    // Served from a queue counts as a visit.
    const session = await h.db.queueSession.create({
      data: { businessId: s.b.id, sessionDate: new Date(Date.now() - 2 * 86_400_000), status: 'closed' },
    });
    await h.db.queueEntry.create({
      data: {
        sessionId: session.id,
        userId: c.id,
        ticketNumber: 1,
        status: 'completed',
        joinedAt: new Date(Date.now() - 2 * 86_400_000),
      },
    });
    // Over a year ago: forgotten.
    await past(s, c, 400, 'no_show');

    const res = (await mine()).body.data;
    expect(res).toMatchObject({
      visits: 10,
      noShows: 1,
      lateCancellations: 1,
      basedOn: 12,
      showsUpPercent: 87, // 10 / (10 + 1 + 0.5)
      label: 'Shows up 87%',
      businessesSee: 'Shows up 87%',
    });
    expect(res.tip).toMatch(/cancel before/);
  });

  it('businesses see only the label, on their appointment list and detail', async () => {
    const s = await h.salon({ staffCount: 2 });
    const regular = await h.person();
    for (const d of [30, 20, 10]) await past(s, regular, d, 'completed');
    const newbie = await h.person();
    const a = await h.appointment(s, regular, 2 * DAY);
    await h.appointment(s, newbie, 2 * DAY, { staffIndex: 1 });

    const date = (await h.db.appointment.findUniqueOrThrow({ where: { id: a.id } })).startAt;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(date);
    const list = await request(h.app).get(`${s.base}/appointments?date=${day}`).set(s.owner.auth).expect(200);
    const labels = Object.fromEntries(
      list.body.data.items.map((i: { customer: { id: string; reliability: { label: string } } }) => [
        i.customer.id,
        i.customer.reliability,
      ]),
    );
    expect(labels[regular.id]).toEqual({ label: 'Shows up 100%', showsUpPercent: 100 });
    expect(labels[newbie.id]).toEqual({ label: 'New customer', showsUpPercent: null });
    expect(JSON.stringify(list.body)).not.toMatch(/noShows|lateCancellations/);

    const one = await request(h.app).get(`${s.base}/appointments/${a.id}`).set(s.owner.auth).expect(200);
    expect(one.body.data.customer.reliability.label).toBe('Shows up 100%');
  });

  it('a business can ask to approve bookings from customers who often don’t come; new customers are never held back', async () => {
    const s = await h.salon({ settings: { approvalBelowShowUpPercent: 80 } });
    const flaky = await h.person();
    for (const d of [30, 20]) await past(s, flaky, d, 'completed');
    for (const d of [15, 10]) await past(s, flaky, d, 'no_show'); // 50%
    const fresh = await h.person();
    const reliable = await h.person();
    for (const d of [30, 20, 10]) await past(s, reliable, d, 'completed');

    const tomorrow = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(
      new Date(Date.now() + DAY * 60_000),
    );
    const slots = (
      await request(h.app).get(
        `/v1/businesses/${s.b.id}/availability?serviceId=${s.service.id}&date=${tomorrow}`,
      )
    ).body.data.days[0].slots as { startAt: string }[];
    const book = (p: Person, i: number) =>
      request(h.app)
        .post('/v1/appointments')
        .set(p.auth)
        .send({ businessId: s.b.id, serviceId: s.service.id, startAt: slots[i]!.startAt })
        .expect(201);
    expect((await book(flaky, 0)).body.data.status).toBe('pending');
    expect((await book(fresh, 2)).body.data.status).toBe('confirmed');
    expect((await book(reliable, 4)).body.data.status).toBe('confirmed');
  });
});

describe('Cancellation report', () => {
  it('totals, rates, reasons, when, which service/employee, and "remind me later" coming back', async () => {
    const s = await h.salon({ staffCount: 2 });
    const [c1, c2, c3] = [await h.person(), await h.person(), await h.person()];
    await past(s, c1, 10, 'completed');
    await past(s, c1, 9, 'completed');
    await past(s, c2, 8, 'no_show');
    await past(s, c2, 7, 'cancel', { reason: 'schedule_conflict' });
    await past(s, c3, 6, 'late_cancel', { reason: 'illness', rebookLater: true });
    await past(s, c3, 5, 'business_cancel');
    await past(s, c1, 4, 'declined');
    // c3 booked again after their "remind me later" cancellation (in 3 days: outside the period, which ends today).
    await h.appointment(s, c3, 3 * DAY);

    const desk = await s.member('front_desk');
    await request(h.app).get(`${s.base}/insights/cancellations`).set(desk.auth).expect(403);
    const outsider = await h.person();
    await request(h.app).get(`${s.base}/insights/cancellations`).set(outsider.auth).expect(404);
    await request(h.app)
      .get(`${s.base}/insights/cancellations?from=2026-01-01&to=2027-06-01`)
      .set(s.owner.auth)
      .expect(400);

    const r = (await request(h.app).get(`${s.base}/insights/cancellations`).set(s.owner.auth).expect(200))
      .body.data;
    expect(r.totals).toMatchObject({
      booked: 7,
      completed: 2,
      upcoming: 0,
      cancelledByCustomer: 2,
      lateCancellations: 1,
      cancelledByBusiness: 1,
      declined: 1,
      noShows: 1,
    });
    expect(r.rates).toEqual({
      customerCancellation: 28.6,
      lateCancellation: 14.3,
      noShow: 33.3,
      businessCancellation: 14.3,
    });
    expect(r.reasons).toEqual(
      expect.arrayContaining([
        { reason: 'schedule_conflict', count: 1 },
        { reason: 'illness', count: 1 },
      ]),
    );
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byWeekday.reduce((n: number, d: { noShows: number }) => n + d.noShows, 0)).toBe(1);
    expect(r.byService[0]).toMatchObject({ name: 'Haircut', booked: 7, cancellations: 2, noShows: 1 });
    expect(r.rebookLater).toEqual({ asked: 1, bookedAgain: 1, rate: 100 });
  });
});
