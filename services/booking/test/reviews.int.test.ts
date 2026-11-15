import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { maskContacts, reviewerName } from '../src/reviews/review-service.js';
import { useBookingHarness, type Person, type Salon } from './harness.js';

/**
 * Reviews against database v2 (each business's own shard, D3d): who may review what and when, what the
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
  await h.update(
    s,
    a,
    how === 'completed'
      ? { status: 'completed' }
      : { checkedInAt: new Date(Date.now() - minutesAgo * 60_000) },
  );
  return a;
}

/** The rating the database keeps on the business's row. */
const rating = (s: Salon) =>
  h.inSalon(s, (tx) =>
    tx.business.findUniqueOrThrow({ where: { id: s.b.id }, select: { avgRating: true, reviewCount: true } }),
  );

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
    await h.update(s, noShow, { status: 'no_show' });
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
    const startAt = (
      await h.inSalon(s, (tx) => tx.appointment.findFirstOrThrow({ where: { id: a.internalId } }))
    ).startAt;
    const attach = (businessId: bigint, userId: bigint) =>
      h.world.inBusiness(businessId, (tx) =>
        tx.review.create({
          data: {
            id: h.world.id(),
            appointmentId: a.internalId,
            appointmentStartAt: startAt,
            userId,
            businessId,
            overallRating: 5,
          },
        }),
      );
    // Not at another business, and not by someone else.
    await expect(attach(other.b.id, c.id)).rejects.toThrow(/does not match its appointment/);
    await expect(attach(s.b.id, (await h.person()).id)).rejects.toThrow(/does not match its appointment/);
  });

  it('can be changed for 7 days and deleted any time; the business rating follows', async () => {
    const s = await h.salon();
    const c = await h.person();
    const a = await visit(s, c, HOUR);
    const posted = await review(c, a.id, { overall: 2 }).expect(201);
    expect((await rating(s)).avgRating.toNumber()).toBe(2);
    // Each review names its visit by the visit's public ID, as every customer route does (DB-042).
    expect(posted.body.data.appointmentId).toBe(a.id);
    const listed = await request(h.app).get('/v1/appointments/reviews').set(c.auth).expect(200);
    expect(listed.body.data.map((r: { appointmentId: string }) => r.appointmentId)).toEqual([a.id]);

    const edited = await request(h.app)
      .patch(`/v1/appointments/${a.id}/review`)
      .set(c.auth)
      .send({ overall: 4, comment: 'Better than I first said' })
      .expect(200);
    expect(edited.body.data).toMatchObject({ rating: { overall: 4 }, edited: true });
    expect((await rating(s)).avgRating.toNumber()).toBe(4);

    await h.inSalon(s, (tx) =>
      tx.review.updateMany({
        where: { appointmentId: a.internalId },
        data: { createdAt: new Date(Date.now() - 8 * DAY * 60_000) },
      }),
    );
    const locked = await request(h.app)
      .patch(`/v1/appointments/${a.id}/review`)
      .set(c.auth)
      .send({ overall: 1 });
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('REVIEW_LOCKED');

    await request(h.app).delete(`/v1/appointments/${a.id}/review`).set(c.auth).expect(204);
    expect(await rating(s)).toMatchObject({ reviewCount: 0 });

    const mine = await request(h.app).get('/v1/appointments/reviews').set(c.auth).expect(200);
    expect(mine.body.data).toEqual([]);
    // The rating search shows follows each change (D3h): written, edited, deleted.
    expect(await h.announced(s.b)).toEqual(['rating', 'rating', 'rating']);
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

    const best = await request(h.app).get(
      `/v1/businesses/${s.b.publicId}/reviews?sort=highest&withComment=true`,
    );
    expect(best.body.data.map((r: { comment: string }) => r.comment)).toEqual(['Excellent', 'Waited long']);
    const fours = await request(h.app).get(`/v1/businesses/${s.b.publicId}/reviews?rating=4`);
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

    const events = await h.inSalon(s, (tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: BigInt(id), topic: 'reviews.responded' } }),
    );
    expect(events).toHaveLength(1); // the reviewer is told once, not on every edit

    await request(h.app).delete(`${s.base}/reviews/${id}/response`).set(manager.auth).expect(204);
    const pub = await request(h.app).get(`/v1/businesses/${s.b.publicId}/reviews`);
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
    expect(await rating(s)).toMatchObject({ reviewCount: 1 });
    expect((await rating(s)).avgRating.toNumber()).toBe(5);
    const pub = await request(h.app).get(`/v1/businesses/${s.b.publicId}/reviews`);
    expect(pub.body.data.map((r: { id: string }) => r.id)).not.toContain(fake);
    expect(
      await h.inSalon(s, (tx) =>
        tx.auditLog.count({
          where: { resourceId: BigInt(fake), action: { in: ['review.reported', 'review.hidden'] } },
        }),
      ),
    ).toBe(2);

    // Hidden: no longer reported, but listed under hidden (to be found and put back), and the step
    // is on the admin's own record too, for the console's audit log (D-132).
    const reported = await request(h.app).get('/v1/admin/reviews').set(admin.auth).expect(200);
    expect(reported.body.data.map((r: { id: string }) => r.id)).not.toContain(fake);
    const hidden = await request(h.app).get('/v1/admin/reviews?status=hidden').set(admin.auth).expect(200);
    expect(hidden.body.data.find((r: { id: string }) => r.id === fake)).toMatchObject({
      visible: false,
      hidden: { reason: 'Not a real visit' },
    });
    await request(h.app).get('/v1/admin/reviews?status=everything').set(admin.auth).expect(400);
    const trail = await (
      await h.world.user(admin.id)
    ).auditLog.findMany({ where: { userId: admin.id, resourceId: BigInt(fake) } });
    expect(trail.map((e) => e.action)).toEqual(['admin.review_hidden']);
    expect(trail[0]!.newValues).toMatchObject({ reason: 'Not a real visit' });

    await request(h.app)
      .post(`/v1/admin/reviews/${fake}/decision`)
      .set(admin.auth)
      .send({ action: 'restore' })
      .expect(204);
    expect(await rating(s)).toMatchObject({ reviewCount: 2 });
    // Two reviews, then hidden and restored: each moves the rating search shows (D3h).
    expect(await h.announced(s.b)).toEqual(['rating', 'rating', 'rating', 'rating']);
  });
});

describe('The business’s own view of its reviews (3.5i)', () => {
  it('every review with what the team did and what BUKU hid; filters and counts; owners and managers only', async () => {
    const s = await h.salon();
    const admin = await h.person('super_admin');
    const [c1, c2, c3] = [await h.person(), await h.person(), await h.person()];
    const fake = (await review(c1, (await visit(s, c1, HOUR)).id, { overall: 1, comment: 'Never went' })).body
      .data.id as string;
    const good = (await review(c2, (await visit(s, c2, HOUR)).id, { overall: 5, comment: 'Lovely' })).body
      .data.id as string;
    const meh = (await review(c3, (await visit(s, c3, HOUR)).id, { overall: 3 })).body.data.id as string;
    await request(h.app)
      .put(`${s.base}/reviews/${good}/response`)
      .set(s.owner.auth)
      .send({ text: 'Thank you!' })
      .expect(200);
    await request(h.app)
      .post(`${s.base}/reviews/${fake}/report`)
      .set(s.owner.auth)
      .send({ reason: 'fake' })
      .expect(204);
    await request(h.app)
      .post(`/v1/admin/reviews/${meh}/decision`)
      .set(admin.auth)
      .send({ action: 'hide', reason: 'test: hidden' })
      .expect(204);

    const list = (filter: string) =>
      request(h.app).get(`${s.base}/reviews/manage`).query({ filter }).set(s.owner.auth).expect(200);
    const all = await list('all');
    expect(all.body.data.map((r: { id: string }) => r.id).sort()).toEqual([fake, good, meh].sort());
    expect(all.body.meta.counts).toEqual({ unanswered: 1, reported: 1, hidden: 1 });
    const byId = new Map(all.body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId.get(fake)).toMatchObject({ visible: true, reported: { reason: 'fake' }, response: null });
    expect(byId.get(good)).toMatchObject({ reported: null, response: { text: 'Thank you!' } });
    expect(byId.get(meh)).toMatchObject({ visible: false, hiddenAt: expect.any(String) });
    expect(JSON.stringify(byId.get(meh))).not.toContain('test: hidden'); // BUKU's reason stays BUKU's

    expect((await list('unanswered')).body.data.map((r: { id: string }) => r.id)).toEqual([fake]);
    expect((await list('reported')).body.data.map((r: { id: string }) => r.id)).toEqual([fake]);
    expect((await list('hidden')).body.data.map((r: { id: string }) => r.id)).toEqual([meh]);
    const fives = await request(h.app).get(`${s.base}/reviews/manage`).query({ rating: 5 }).set(s.owner.auth);
    expect(fives.body.data.map((r: { id: string }) => r.id)).toEqual([good]);

    const manager = await s.member('manager');
    await request(h.app).get(`${s.base}/reviews/manage`).set(manager.auth).expect(200);
    const desk = await s.member('front_desk');
    await request(h.app).get(`${s.base}/reviews/manage`).set(desk.auth).expect(403);
    await request(h.app).get(`${s.base}/reviews/manage`).set(c1.auth).expect(404);
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
