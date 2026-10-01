import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { useBookingHarness } from './harness.js';

/** At the venue: customers checking in, visits completed, no-shows, and employee shifts. */

const h = useBookingHarness();
const post = (path: string, auth: Record<string, string>, body: object = {}) =>
  request(h.app).post(path).set(auth).send(body);

describe('Customers checking in', () => {
  it('front desk scans the receipt (code, any case); twice is fine; the customer can no longer cancel', async () => {
    const s = await h.salon();
    const desk = await s.member('front_desk');
    const me = await h.person();
    const appt = await h.appointment(s, me, 30);

    const first = await post(`${s.base}/check-in`, desk.auth, { code: appt.code.toLowerCase() });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({
      id: appt.id,
      status: 'confirmed',
      checkedInAt: expect.any(String),
    });
    const again = await post(`${s.base}/check-in`, desk.auth, { code: appt.code });
    expect(again.body.data.checkedInAt).toBe(first.body.data.checkedInAt);

    const receipt = await request(h.app).get(`/v1/appointments/${appt.id}`).set(me.auth);
    expect(receipt.body.data).toMatchObject({
      checkedInAt: first.body.data.checkedInAt,
      policy: { canCancel: false },
    });
    const cancel = await post(`/v1/appointments/${appt.id}/cancel`, me.auth, { reasonCode: 'other' });
    expect([cancel.status, cancel.body.error.code]).toEqual([409, 'INVALID_TRANSITION']);
    // Nor can the business cancel a visit that has started.
    expect(
      (await post(`${s.base}/appointments/${appt.id}/cancel`, s.owner.auth, { reason: 'Oops' })).status,
    ).toBe(409);
  });

  it('works from the list too (customer without a phone)', async () => {
    const s = await h.salon();
    const appt = await h.appointment(s, await h.person(), 10);
    const res = await post(`${s.base}/appointments/${appt.id}/check-in`, s.owner.auth);
    expect(res.body.data.checkedInAt).not.toBeNull();
  });

  it('opens 2 hours before the start and closes when the appointment ends', async () => {
    const s = await h.salon();
    const early = await h.appointment(s, await h.person(), 180);
    const over = await h.appointment(s, await h.person(), -60);
    const tooEarly = await post(`${s.base}/check-in`, s.owner.auth, { code: early.code });
    expect([tooEarly.status, tooEarly.body.error.message]).toEqual([
      409,
      expect.stringContaining('opens 2 hours before'),
    ]);
    expect((await post(`${s.base}/check-in`, s.owner.auth, { code: over.code })).body.error.message).toMatch(
      /ended/,
    );
  });

  it('a code from another business is not found; malformed codes are refused', async () => {
    const [a, b] = [await h.salon(), await h.salon()];
    const appt = await h.appointment(a, await h.person(), 10);
    expect((await post(`${b.base}/check-in`, b.owner.auth, { code: appt.code })).status).toBe(404);
    expect((await post(`${a.base}/check-in`, (await h.person()).auth, { code: appt.code })).status).toBe(404);
    expect((await post(`${a.base}/check-in`, a.owner.auth, { code: 'BK-0O1IL!' })).status).toBe(400);
  });

  it('an employee checks in their own customers only; front desk approves a pending request on arrival', async () => {
    const s = await h.salon({ staffCount: 2 });
    const stylist = await s.member('staff', 0);
    const mine = await h.appointment(s, await h.person(), 10, { staffIndex: 0 });
    const colleagues = await h.appointment(s, await h.person(), 10, { staffIndex: 1 });
    expect((await post(`${s.base}/check-in`, stylist.auth, { code: mine.code })).status).toBe(200);
    expect((await post(`${s.base}/check-in`, stylist.auth, { code: colleagues.code })).status).toBe(404);

    // Their own pending request, later that hour (the same stylist can't have overlapping bookings).
    const request_ = await h.appointment(s, await h.person(), 60, { status: 'pending', staffIndex: 0 });
    expect((await post(`${s.base}/check-in`, stylist.auth, { code: request_.code })).status).toBe(403);
    const desk = await s.member('front_desk');
    const res = await post(`${s.base}/check-in`, desk.auth, { code: request_.code });
    expect(res.body.data.status).toBe('confirmed');
    const history = await h.db.appointmentStatusHistory.findMany({ where: { appointmentId: request_.id } });
    expect(history.map((x) => [x.fromStatus, x.toStatus, x.reason])).toEqual([
      ['pending', 'confirmed', 'approved on arrival'],
    ]);
  });
});

describe('Completing visits and no-shows', () => {
  it('completes from the start time on, and tells other services', async () => {
    const s = await h.salon();
    const future = await h.appointment(s, await h.person(), 60);
    expect((await post(`${s.base}/appointments/${future.id}/complete`, s.owner.auth)).status).toBe(409);
    const now = await h.appointment(s, await h.person(), -5);
    const done = await post(`${s.base}/appointments/${now.id}/complete`, s.owner.auth);
    expect(done.body.data.status).toBe('completed');
    const events = await h.db.outboxEvent.findMany({ where: { aggregateId: now.id } });
    expect(events.map((e) => e.topic)).toEqual(['bookings.completed']);
  });

  it('a no-show only after the grace period, and never for someone who checked in', async () => {
    const s = await h.salon({ staffCount: 3, settings: { noShowGraceMinutes: 15 } });
    const tooSoon = await h.appointment(s, await h.person(), -5, { staffIndex: 0 });
    const res = await post(`${s.base}/appointments/${tooSoon.id}/no-show`, s.owner.auth);
    expect([res.status, res.body.error.message]).toEqual([
      409,
      expect.stringContaining('15 minutes after the start'),
    ]);

    const late = await h.appointment(s, await h.person(), -20, { staffIndex: 1 });
    const noShow = await post(`${s.base}/appointments/${late.id}/no-show`, s.owner.auth);
    expect(noShow.body.data.status).toBe('no_show');
    expect(
      (await h.db.outboxEvent.findMany({ where: { aggregateId: late.id } })).map((e) => e.topic),
    ).toEqual(['bookings.no_show']);

    const arrived = await h.appointment(s, await h.person(), -20, { minutes: 60, staffIndex: 2 });
    await post(`${s.base}/appointments/${arrived.id}/check-in`, s.owner.auth);
    expect((await post(`${s.base}/appointments/${arrived.id}/no-show`, s.owner.auth)).status).toBe(409);
  });
});

describe('Employee shifts', () => {
  it('employees clock themselves in and out, but not a colleague', async () => {
    const s = await h.salon({ staffCount: 2 });
    const ali = await s.member('staff', 0);
    const path = (i: number, action: string) => `${s.base}/staff/${s.staff[i]!.id}/attendance/${action}`;
    const inRes = await post(path(0, 'check-in'), ali.auth, { note: 'Morning shift' });
    expect(inRes.status).toBe(201);
    expect(inRes.body.data).toMatchObject({ open: true, note: 'Morning shift' });
    expect((await post(path(0, 'check-in'), ali.auth)).status).toBe(409);
    expect((await post(path(1, 'check-in'), ali.auth)).status).toBe(403);
    const out = await post(path(0, 'check-out'), ali.auth);
    expect(out.body.data).toMatchObject({ open: false, minutes: 0 });
    expect((await post(path(0, 'check-out'), ali.auth)).status).toBe(409);
  });

  it('the front-desk tablet clocks anyone; two devices at once still make one open shift', async () => {
    const s = await h.salon();
    const desk = await s.member('front_desk');
    const path = `${s.base}/staff/${s.staff[0]!.id}/attendance/check-in`;
    const results = await Promise.all([
      post(path, desk.auth),
      post(path, desk.auth),
      post(path, s.owner.auth),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const present = await request(h.app).get(`${s.base}/attendance/present`).set(desk.auth);
    expect(present.body.data).toEqual([
      { staffId: s.staff[0]!.id, displayName: 'Stylist 1', since: expect.any(String) },
    ]);
  });

  it('employees see their own shifts; managers see all and correct mistakes (audited)', async () => {
    const s = await h.salon({ staffCount: 2 });
    const ali = await s.member('staff', 0);
    await post(`${s.base}/staff/${s.staff[0]!.id}/attendance/check-in`, ali.auth);
    await post(`${s.base}/staff/${s.staff[1]!.id}/attendance/check-in`, s.owner.auth);

    expect((await request(h.app).get(`${s.base}/attendance`).set(ali.auth)).body.data.items).toHaveLength(1);
    const all = await request(h.app).get(`${s.base}/attendance`).set(s.owner.auth);
    expect(all.body.data.items.map((x: { displayName: string }) => x.displayName).sort()).toEqual([
      'Stylist 1',
      'Stylist 2',
    ]);

    const shift = all.body.data.items[0];
    const start = new Date(Date.now() - 3 * 3_600_000).toISOString();
    const end = new Date(Date.now() - 3_600_000).toISOString();
    expect(
      (await request(h.app).patch(`${s.base}/attendance/${shift.id}`).set(ali.auth).send({ checkOutAt: end }))
        .status,
    ).toBe(403);
    const fixed = await request(h.app)
      .patch(`${s.base}/attendance/${shift.id}`)
      .set(s.owner.auth)
      .send({ checkInAt: start, checkOutAt: end, note: 'Forgot to clock out' });
    expect(fixed.body.data).toMatchObject({ open: false, minutes: 120, note: 'Forgot to clock out' });
    const audit = await h.db.auditLog.findFirstOrThrow({
      where: { action: 'booking.attendance_corrected', resourceId: shift.id },
    });
    expect(audit.oldValues).toMatchObject({ checkOutAt: null });

    const backwards = await request(h.app)
      .patch(`${s.base}/attendance/${shift.id}`)
      .set(s.owner.auth)
      .send({ checkInAt: end, checkOutAt: start });
    expect(backwards.status).toBe(400);
  });
});
