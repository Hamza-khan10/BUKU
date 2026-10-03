import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { maskContacts, reviewerName } from '../src/reviews/review-service.js';
import { useBookingHarness, type Person, type Salon } from './harness.js';

/**
 * Reviews against the real database: who may review what and when, what the
 * public sees, the business's reply and reports, admin moderation, and the
 * rating the database keeps in step.
 */

const h = useBookingHarness();
const HOUR = 60;
const DAY = 24 * HOUR;

/** A visit that happened `minutesAgo` ago: completed (default) or checked in. */
async function visit(
  s: Salon,
  customer: Person,
  minutesAgo: number,
  how: 'completed' | 'checked_in' = 'completed',
) {
  const a = await h.appointment(s, customer, -minutesAgo);
  await h.db.appointment.update({
    where: { id: a.id },
    data:
      how === 'completed'
        ? { status: 'completed' }
        : { checkedInAt: new Date(Date.now() - minutesAgo * 60_000) },
  });
  return a;
}

const review = (customer: Person, appointmentId: string, body: Record<string, unknown>) =>
  request(h.app).post(`/v1/appointments/${appointmentId}/review`).set(customer.auth).send(body);

describe('Writing a review', () => {
  it('only for your own visit that happened, within 30 days, once', async () => {
    const s = await h.salon();
    const ayesha = await h.person('user', 'Ayesha Noor Khan');
    const other = await h.person();

    const done = await visit(s, ayesha, 2 * HOUR);
    const res = await review(ayesha, done.id, {
      overall: 5,
      staff: 5,
      value: 4,
      comment: 'Great fade, call me on 0300-1234567 or ayesha@example.com',
    }).expect(201);
    expect(res.body.data).toMatchObject({
      rating: { overall: 5, staff: 5, value: 4, waitTime: null, cleanliness: null },
      author: 'Ayesha K.',
      service: 'Haircut',
      staff: 'Stylist 1',
      comment: 'Great fade, call me on [contact removed] or [contact removed]',
      canEdit: true,
      response: null,
    });
    await review(ayesha, done.id, { overall: 1 }).expect(409); // once
    await review(other, done.id, { overall: 1 }).expect(404); // not theirs: looks missing

    const checkedIn = await visit(s, ayesha, 3 * HOUR, 'checked_in');
    await review(ayesha, checkedIn.id, { overall: 4 }).expect(201);

    const upcoming = await h.appointment(s, ayesha, 2 * DAY);
    const r1 = await review(ayesha, upcoming.id, { overall: 5 }).expect(422);
    expect(r1.body.error.code).toBe('REVIEW_NOT_ALLOWED');
    const noShow = await h.appointment(s, ayesha, -5 * HOUR);
    await h.db.appointment.update({ where: { id: noShow.id }, data: { status: 'no_show' } });
    await review(ayesha, noShow.id, { overall: 1 }).expect(422);
    const old = await visit(s, ayesha, 31 * DAY);
    await review(ayesha, old.id, { overall: 3 }).expect(422);

    await review(ayesha, (await visit(s, ayesha, 4 * DAY)).id, { overall: 6 }).expect(400);
    await review(ayesha, (await visit(s, ayesha, 5 * DAY)).id, {
      overall: 3,
      comment: 'x'.repeat(2001),
    }).expect(400);
  });

  it('the database refuses a review that doesn’t match its appointment', async () => {
    const s = await h.salon();
    const other = await h.salon();
    const c = await h.person();
    const a = await visit(s, c, HOUR);
    await expect(
      h.db.review.create({
        data: { appointmentId: a.id, userId: c.id, businessId: other.b.id, overallRating: 5 },
      }),
    ).rejects.toThrow(/does not match its appointment/);
  });

  it('can be changed for 7 days and deleted any time; the business rating follows', async () => {
    const s = await h.salon();
    const c = await h.person();
    const a = await visit(s, c, HOUR);
    await review(c, a.id, { overall: 2 }).expect(201);
    expect((await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).avgRating.toNumber()).toBe(2);

    const edited = await request(h.app)
      .patch(`/v1/appointments/${a.id}/review`)
      .set(c.auth)
      .send({ overall: 4, comment: 'Better than I first said' })
      .expect(200);
    expect(edited.body.data).toMatchObject({ rating: { overall: 4 }, edited: true });
    expect((await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).avgRating.toNumber()).toBe(4);

    await h.db.review.updateMany({
      where: { appointmentId: a.id },
      data: { createdAt: new Date(Date.now() - 8 * DAY * 60_000) },
    });
    const locked = await request(h.app)
      .patch(`/v1/appointments/${a.id}/review`)
      .set(c.auth)
      .send({ overall: 1 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('REVIEW_LOCKED');

    await request(h.app).delete(`/v1/appointments/${a.id}/review`).set(c.auth).expect(204);
    expect(await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).toMatchObject({
      reviewCount: 0,
    });

    const mine = await request(h.app).get('/v1/appointments/reviews').set(c.auth).expect(200);
    expect(mine.body.data).toEqual([]);
  });
});

describe('Reading reviews', () => {
  it('public: newest first, with the summary; no user ids; sort and filter', async () => {
    const s = await h.salon();
    for (const [overall, comment] of [
      [5, 'Excellent'],
      [4, null],
      [2, 'Waited long'],
    ] as const) {
      const c = await h.person('user', 'Bilal Ahmed');
      const a = await visit(s, c, 2 * HOUR);
      await review(c, a.id, { overall, waitTime: overall, ...(comment && { comment }) }).expect(201);
    }
    const res = await request(h.app).get(`/v1/businesses/${s.b.slug}/reviews`).expect(200);
    expect(res.body.data.map((r: { rating: { overall: number } }) => r.rating.overall)).toEqual([2, 4, 5]);
    expect(res.body.meta.summary).toMatchObject({
      average: 3.67,
      count: 3,
      stars: { 5: 1, 4: 1, 3: 0, 2: 1, 1: 0 },
      details: { waitTime: 3.7, staff: null },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/userId|"user"|Bilal Ahmed/);
    expect(res.body.data[0]).toMatchObject({
      author: 'Bilal A.',
      visitedIn: expect.stringMatching(/^\d{4}-\d{2}$/),
    });

    const best = await request(h.app).get(`/v1/businesses/${s.b.id}/reviews?sort=highest&withComment=true`);
    expect(best.body.data.map((r: { comment: string }) => r.comment)).toEqual(['Excellent', 'Waited long']);
    const fours = await request(h.app).get(`/v1/businesses/${s.b.id}/reviews?rating=4`);
    expect(fours.body.meta.total).toBe(1);
  });
});

describe('The business: reply and report', () => {
  it('owner and managers reply (once shown, edits replace); others can’t; other businesses’ reviews look missing', async () => {
    const s = await h.salon();
    const other = await h.salon();
    const desk = await s.member('front_desk');
    const manager = await s.member('manager');
    const c = await h.person();
    const a = await visit(s, c, HOUR);
    const id = (await review(c, a.id, { overall: 3 })).body.data.id as string;
    const reply = (who: Person, base = s.base) =>
      request(h.app).put(`${base}/reviews/${id}/response`).set(who.auth);

    await reply(desk).send({ text: 'Thanks!' }).expect(403);
    await reply(other.owner, other.base).send({ text: 'Thanks!' }).expect(404);
    const res = await reply(s.owner).send({ text: 'Sorry about the wait — call 03001234567' }).expect(200);
    expect(res.body.data.response.text).toBe('Sorry about the wait — call [contact removed]');
    await reply(manager).send({ text: 'Thanks for coming back.' }).expect(200);

    const events = await h.db.outboxEvent.findMany({
      where: { aggregateId: id, topic: 'reviews.responded' },
    });
    expect(events).toHaveLength(1); // the reviewer is told once, not on every edit

    await request(h.app).delete(`${s.base}/reviews/${id}/response`).set(manager.auth).expect(204);
    const pub = await request(h.app).get(`/v1/businesses/${s.b.id}/reviews`);
    expect(pub.body.data[0].response).toBeNull();
  });

  it('report → admin hides (stops counting) or keeps; customers and other businesses can’t', async () => {
    const s = await h.salon();
    const admin = await h.person('super_admin');
    const [c1, c2] = [await h.person(), await h.person()];
    const fake = (await review(c1, (await visit(s, c1, HOUR)).id, { overall: 1, comment: 'Scam!!' })).body
      .data.id as string;
    await review(c2, (await visit(s, c2, HOUR)).id, { overall: 5 }).expect(201);

    await request(h.app)
      .post(`${s.base}/reviews/${fake}/report`)
      .set(c1.auth)
      .send({ reason: 'fake' })
      .expect(404); // not on the team: the business's tools look missing
    await request(h.app)
      .post(`${s.base}/reviews/${fake}/report`)
      .set(s.owner.auth)
      .send({ reason: 'fake', note: 'No such booking at that time' })
      .expect(204);
    await request(h.app)
      .post(`${s.base}/reviews/${fake}/report`)
      .set(s.owner.auth)
      .send({ reason: 'fake' })
      .expect(409);

    await request(h.app).get('/v1/admin/reviews').set(s.owner.auth).expect(403);
    const queue = await request(h.app).get('/v1/admin/reviews').set(admin.auth).expect(200);
    const item = queue.body.data.find((r: { id: string }) => r.id === fake);
    expect(item).toMatchObject({ report: { reason: 'fake: No such booking at that time' }, visible: true });

    await request(h.app)
      .post(`/v1/admin/reviews/${fake}/decision`)
      .set(admin.auth)
      .send({ action: 'hide', reason: 'Not a real visit' })
      .expect(204);
    expect(await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).toMatchObject({
      reviewCount: 1,
    });
    expect((await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).avgRating.toNumber()).toBe(5);
    const pub = await request(h.app).get(`/v1/businesses/${s.b.id}/reviews`);
    expect(pub.body.data.map((r: { id: string }) => r.id)).not.toContain(fake);
    expect(
      await h.db.auditLog.count({
        where: { resourceId: fake, action: { in: ['review.reported', 'review.hidden'] } },
      }),
    ).toBe(2);

    await request(h.app)
      .post(`/v1/admin/reviews/${fake}/decision`)
      .set(admin.auth)
      .send({ action: 'restore' })
      .expect(204);
    expect(await h.db.business.findUniqueOrThrow({ where: { id: s.b.id } })).toMatchObject({
      reviewCount: 2,
    });
  });
});

describe('Helpers', () => {
  it('mask contact details but not prices or times', () => {
    expect(maskContacts('Rs 1500, 10:30, open 9-5')).toBe('Rs 1500, 10:30, open 9-5');
    expect(maskContacts('WhatsApp +92 300 123 4567!')).toBe('WhatsApp [contact removed]!');
    expect(maskContacts('a.b+c@mail.co.uk')).toBe('[contact removed]');
  });
  it('reviewers are shown by first name and initial; deleted accounts as “A customer”', () => {
    expect(reviewerName('Ayesha Noor Khan', false)).toBe('Ayesha K.');
    expect(reviewerName('Sana', false)).toBe('Sana');
    expect(reviewerName('Ayesha Khan', true)).toBe('A customer');
  });
});
