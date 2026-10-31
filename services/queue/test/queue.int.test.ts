import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createEvent, TOPICS, type EventEnvelope } from '@buku/kafka';
import { givePlan, withBilling } from '../../../packages/database/test/services-world.js';
import { queueEventHandler } from '../src/events/handlers.js';
import { useQueueHarness, type Person, type Shop, type ShopOptions } from './harness.js';

/**
 * The virtual queue on database v2 (D3e): sessions and tickets on the business's shard, each
 * person's one ticket on their own shard, PostGIS distances, and the one-ticket rule.
 */

const h = useQueueHarness();
const app = () => h.queue.app;

// A customer 1.3 km from the shop; someone in Karachi.
const NEAR = { lat: 31.531, lng: 74.364 };
const KARACHI = { lat: 24.8607, lng: 67.0011 };

/** A shop with today's queue opened by its owner (unless `open: false`). */
async function shop(opts: ShopOptions & { open?: boolean } = {}) {
  const s = await h.shop(opts);
  if (opts.open !== false)
    expect((await request(app()).post(`${s.base}/open`).set(s.owner.auth)).status).toBe(200);
  return s;
}
const person = (...args: Parameters<typeof h.person>) => h.person(...args);
const join = (who: Person, s: Shop, where = NEAR) =>
  request(app())
    .post('/v1/queue/join')
    .set(who.auth)
    .send({ businessId: s.b.publicId, ...where });
const desk = (s: Shop, path: string, body: object = {}) =>
  request(app()).post(`${s.base}${path}`).set(s.owner.auth).send(body);
const myRow = async (p: Person) =>
  (await h.shardOf(p)).userActiveTicket.findUnique({ where: { userId: p.id } });
const bigints = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);
const handle = (event: EventEnvelope) =>
  queueEventHandler({ queue: h.queue.queue })(event, {
    topic: event.type,
    partition: 0,
    offset: '0',
    key: null,
    attempt: 1,
  });

describe('Joining', () => {
  it('a nearby customer gets a ticket (A-001), with position and estimated wait', async () => {
    const s = await shop();
    const first = await join(await person(), s);
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      ticket: 'A-001',
      qr: 'A-001',
      status: 'waiting',
      ahead: 0,
      estimatedWaitMinutes: 0,
    });
    const second = await join(await person(), s);
    expect(second.body.data).toMatchObject({ ticket: 'A-002', ahead: 1, estimatedWaitMinutes: 5 });

    const pub = await request(app()).get(`/v1/queue/public/${s.b.slug}`);
    expect(pub.body.data).toMatchObject({
      status: 'open',
      waiting: 2,
      called: [],
      serving: [],
      estimatedWaitMinutes: 10,
    });
    expect(JSON.stringify(pub.body.data)).not.toMatch(/Customer/);
  });

  it('only within the business’s distance (default 5 km), and only where the business has a location', async () => {
    const s = await shop();
    const far = await join(await person(), s, KARACHI);
    expect(far.status).toBe(422);
    expect(far.body.error).toMatchObject({ code: 'QUEUE_TOO_FAR', details: { maxMeters: 5000 } });
    expect(far.body.error.details.distanceMeters).toBeGreaterThan(900_000);

    const noLocation = await shop({ location: false });
    expect((await join(await person(), noLocation)).body.error.code).toBe('QUEUE_TOO_FAR');
  });

  it('one live ticket per customer, in any queue — even when both joins are sent at once', async () => {
    const [a, b] = [await shop(), await shop()];
    const me = await person();
    const results = await Promise.all([join(me, a), join(me, b)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.code).toBe('QUEUE_ALREADY_JOINED');

    const mine = await request(app()).get('/v1/queue/my-ticket').set(me.auth);
    const left = await request(app()).post(`/v1/queue/tickets/${mine.body.data.id}/leave`).set(me.auth);
    expect(left.body.data.status).toBe('left');
    const other = mine.body.data.business.id === a.b.publicId ? b : a;
    expect((await join(me, other)).status).toBe(201);
  });

  it('ten people joining at once get ten different tickets', async () => {
    const s = await shop();
    const people = await Promise.all(Array.from({ length: 10 }, () => person()));
    const results = await Promise.all(people.map((p) => join(p, s)));
    const tickets = results.map((r) => r.body.data.ticket as string).sort();
    expect(tickets).toEqual(Array.from({ length: 10 }, (_, i) => `A-${String(i + 1).padStart(3, '0')}`));
  });

  it('refuses a closed, paused or full queue; walk-ins are still possible while paused', async () => {
    const closed = await shop({ open: false });
    expect((await join(await person(), closed)).body.error.code).toBe('QUEUE_CLOSED');

    const s = await shop({ settings: { maxQueueSize: 2 } });
    await desk(s, '/pause');
    expect((await join(await person(), s)).body.error.code).toBe('QUEUE_PAUSED');
    expect((await desk(s, '/walk-ins', { name: 'Uncle Rashid', priority: true })).status).toBe(201);
    await desk(s, '/resume');
    expect((await join(await person(), s)).status).toBe(201);
    const refused = await person();
    expect((await join(refused, s)).body.error.code).toBe('QUEUE_FULL');
    // The claim on the person's own shard is given back: they can join elsewhere straight away.
    expect(await myRow(refused)).toBeNull();
  });

  it('employee accounts can’t join; a ticket is only visible to its owner', async () => {
    const s = await shop();
    expect((await join(await person('staff'), s)).status).toBe(403);
    const me = await person();
    const t = await join(me, s);
    expect(
      (
        await request(app())
          .get(`/v1/queue/tickets/${t.body.data.id}`)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
    expect((await request(app()).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth)).status).toBe(200);
  });
});

describe('Serving the line', () => {
  it('calls the priority lane first, then by ticket; serve and complete update the day’s average', async () => {
    const s = await shop();
    const [a, b] = [await join(await person(), s), await join(await person(), s)];
    const elder = await desk(s, '/walk-ins', { name: 'Elder', priority: true });

    const first = await desk(s, '/call-next');
    expect(first.body.data).toMatchObject({
      id: elder.body.data.id,
      status: 'called',
      comeBy: expect.any(String),
    });
    expect((await desk(s, '/call-next')).body.data.id).toBe(a.body.data.id);

    expect((await desk(s, `/entries/${a.body.data.id}/serve`)).body.data.status).toBe('serving');
    const done = await desk(s, `/entries/${a.body.data.id}/complete`);
    expect(done.body.data.status).toBe('completed');
    const board = await request(app()).get(s.base).set(s.owner.auth);
    expect(board.body.data.session).toMatchObject({ totalServed: 1, lastCalled: a.body.data.ticket });
    expect(board.body.data.called.map((e: { name: string }) => e.name)).toEqual(['Elder']);
    expect(board.body.data.waiting.map((e: { ticket: string }) => e.ticket)).toEqual([b.body.data.ticket]);
    expect((await h.events(s, a.body.data.id)).map((e) => e.topic)).toEqual([
      'queue.entry.joined',
      'queue.position.updated',
      'queue.entry.called',
      'queue.entry.served',
      'queue.entry.completed',
    ]);
  });

  it('a no-show only after the grace period (default 5 minutes)', async () => {
    const s = await shop();
    const t = await join(await person(), s);
    await desk(s, '/call-next');
    const early = await desk(s, `/entries/${t.body.data.id}/no-show`);
    expect([early.status, early.body.error.message]).toEqual([
      409,
      expect.stringContaining('5 minutes after calling'),
    ]);

    const quick = await shop({ settings: { gracePeriodSeconds: 0 } });
    const u = await join(await person(), quick);
    await desk(quick, '/call-next');
    expect((await desk(quick, `/entries/${u.body.data.id}/no-show`)).body.data.status).toBe('no_show');
  });

  it('alerts at 10 ahead, 5 ahead, then every step — as people are actually called', async () => {
    const s = await shop();
    const people = await Promise.all(Array.from({ length: 12 }, () => person()));
    const tickets = [];
    for (const p of people) tickets.push((await join(p, s)).body.data.id as string);
    const last = tickets.at(-1)!; // 11 ahead: no alert yet
    const alertsFor = async (id: string) =>
      (await h.events(s, id))
        .filter((e) => e.topic === 'queue.position.updated')
        .map((e) => (e.payload as { data: { ahead: number } }).data.ahead);
    expect(await alertsFor(last)).toEqual([]);
    for (let i = 0; i < 11; i++) await desk(s, '/call-next');
    expect(await alertsFor(last)).toEqual([10, 5, 4, 3, 2, 1, 0]);
    // Events carry the ticket and ids, never names.
    expect(JSON.stringify(await h.events(s, last), bigints)).not.toContain(people.at(-1)!.name);
  });

  it('closing an account gives up its place in line (the people behind move up), once', async () => {
    const s = await shop();
    const leaving = await person();
    const t = await join(leaving, s);
    const behind = await person();
    const next = await join(behind, s);
    expect(next.body.data.ahead).toBe(1);

    const event = createEvent({
      type: TOPICS.USERS_DELETED,
      source: 'auth-service',
      subject: leaving.id.toString(),
      data: {
        userId: leaving.id.toString(),
        purgeAfter: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
    });
    await handle(event);
    await handle(event); // delivered twice: nothing more happens

    const gone = await h.inShop(s, (tx) =>
      tx.queueTicket.findFirstOrThrow({ where: { id: BigInt(t.body.data.id) } }),
    );
    expect([gone.status, gone.leftAt]).toEqual(['left', expect.any(Date)]);
    const left = (await h.events(s, t.body.data.id)).filter((e) => e.topic === 'queue.entry.left');
    expect(left).toHaveLength(1);
    expect((left[0]!.payload as { data: { reason: string } }).data.reason).toBe('account_closed');
    const mine = await request(app()).get(`/v1/queue/tickets/${next.body.data.id}`).set(behind.auth);
    expect(mine.body.data.ahead).toBe(0);
  });

  it('closing the queue tells everyone still waiting', async () => {
    const s = await shop();
    const me = await person();
    const t = await join(me, s);
    await desk(s, '/close');
    const mine = await request(app()).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth);
    expect(mine.body.data.status).toBe('left');
    const left = (await h.events(s, t.body.data.id)).find((e) => e.topic === 'queue.entry.left');
    expect((left!.payload as { data: { reason: string } }).data.reason).toBe('queue_closed');
    expect((await join(await person(), s)).body.error.code).toBe('QUEUE_CLOSED');
  });
});

describe('One queue at a time, kept on the person’s own shard (D3e)', () => {
  it('a finished ticket stays readable and frees the person; a new join replaces it', async () => {
    const [a, b] = [await shop(), await shop()];
    const me = await person();
    const t = await join(me, a);
    expect(await myRow(me)).toMatchObject({ ticketId: BigInt(t.body.data.id), businessId: a.b.id });
    await desk(a, '/call-next');
    await desk(a, `/entries/${t.body.data.id}/serve`);
    await desk(a, `/entries/${t.body.data.id}/complete`);

    expect((await request(app()).get('/v1/queue/my-ticket').set(me.auth)).body.data).toBeNull();
    const finished = await request(app()).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth);
    expect(finished.body.data).toMatchObject({
      status: 'completed',
      business: { id: a.b.publicId, name: a.b.name, slug: a.b.slug },
    });

    const next = await join(me, b);
    expect(next.status).toBe(201);
    expect(await myRow(me)).toMatchObject({ ticketId: BigInt(next.body.data.id), businessId: b.b.id });
    // Only the current or latest ticket is the person's to see.
    expect((await request(app()).get(`/v1/queue/tickets/${t.body.data.id}`).set(me.auth)).status).toBe(404);
  });

  it('a claim whose join never happened blocks for 2 minutes, then gives way', async () => {
    const s = await shop();
    const me = await person();
    const session = await h.inShop(s, (tx) =>
      tx.queueSession.findFirstOrThrow({ where: { businessId: s.b.id } }),
    );
    const db = await h.shardOf(me);
    await db.userActiveTicket.create({
      data: {
        userId: me.id,
        ticketId: h.world.id(),
        ticketSessionDate: session.sessionDate,
        businessId: s.b.id,
        sessionId: session.id,
      },
    });
    // Maybe still being written (a join sent twice): the second one waits its turn.
    expect((await join(me, s)).body.error.code).toBe('QUEUE_ALREADY_JOINED');
    await db.userActiveTicket.update({
      where: { userId: me.id },
      data: { createdAt: new Date(Date.now() - 3 * 60_000) },
    });
    expect((await join(me, s)).status).toBe(201);
  });

  it('someone still being served when the queue closed can join another queue', async () => {
    const [a, b] = [await shop(), await shop()];
    const me = await person();
    const t = await join(me, a);
    await desk(a, '/call-next');
    await desk(a, `/entries/${t.body.data.id}/serve`);
    expect((await join(me, b)).body.error.code).toBe('QUEUE_ALREADY_JOINED');
    await desk(a, '/close');
    expect((await join(me, b)).status).toBe(201);
  });

  it('how a ticket ended goes into the person’s reliability, once — walk-ins and leaving record nothing', async () => {
    const s = await shop({ settings: { gracePeriodSeconds: 0 } });
    const [served, absent, leaving] = [await person(), await person(), await person()];
    const st = await join(served, s);
    const ab = await join(absent, s);
    const lv = await join(leaving, s);
    const walkIn = await desk(s, '/walk-ins', { name: 'Uncle Rashid' });
    await desk(s, '/call-next');
    await desk(s, `/entries/${st.body.data.id}/serve`);
    await desk(s, `/entries/${st.body.data.id}/complete`);
    await desk(s, '/call-next');
    await desk(s, `/entries/${ab.body.data.id}/no-show`);
    await request(app()).post(`/v1/queue/tickets/${lv.body.data.id}/leave`).set(leaving.auth);
    await desk(s, '/call-next');
    await desk(s, `/entries/${walkIn.body.data.id}/serve`);
    await desk(s, `/entries/${walkIn.body.data.id}/complete`);

    const outcomes = async (p: Person) =>
      (await h.shardOf(p)).userVisitOutcome.findMany({ where: { userId: p.id } });
    expect(await outcomes(served)).toEqual([
      expect.objectContaining({
        refId: BigInt(st.body.data.id),
        businessId: s.b.id,
        kind: 'visit',
        source: 'queue',
      }),
    ]);
    expect(await outcomes(absent)).toEqual([
      expect.objectContaining({ refId: BigInt(ab.body.data.id), kind: 'no_show', source: 'queue' }),
    ]);
    expect(await outcomes(leaving)).toEqual([]);

    // The event repairs a lost step, and changes nothing the second time.
    await (await h.shardOf(served)).userVisitOutcome.deleteMany({ where: { userId: served.id } });
    const [completed] = (await h.events(s, st.body.data.id)).filter(
      (e) => e.topic === 'queue.entry.completed',
    );
    for (let i = 0; i < 2; i++) await handle(completed!.payload as unknown as EventEnvelope);
    expect(await outcomes(served)).toHaveLength(1);
  });
});

describe('Front desk access and settings', () => {
  it('owner, manager and front desk operate; staff only watch; outsiders get 404; names only', async () => {
    const s = await shop();
    await join(await person('user', 'Ayesha Khan'), s);
    const staff = await s.member('staff');
    expect((await request(app()).post(`${s.base}/call-next`).set(staff.auth)).status).toBe(403);
    const board = await request(app()).get(s.base).set(staff.auth);
    expect(board.body.data.waiting[0]).toMatchObject({
      name: 'Ayesha Khan',
      walkIn: false,
      joinedRemotely: true,
      // A label only ("Shows up 95%" / "New customer"), never the customer's history.
      reliability: { label: 'New customer', showsUpPercent: null },
    });
    expect(JSON.stringify(board.body.data)).not.toMatch(/email|phone|avatar|noShows/i);
    expect(
      (
        await request(app())
          .post(`${s.base}/call-next`)
          .set((await s.member('front_desk')).auth)
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app())
          .get(s.base)
          .set((await person()).auth)
      ).status,
    ).toBe(404);
  });

  it('settings: defaults, owner/manager changes within limits, applied from the next opening', async () => {
    const s = await shop({ open: false });
    const get = await request(app()).get(`${s.base}/settings`).set(s.owner.auth);
    expect(get.body.data).toEqual({
      remoteJoinRadiusMeters: 5000,
      maxQueueSize: 200,
      gracePeriodSeconds: 300,
      ticketPrefix: 'A',
      avgServiceSeconds: 300,
    });
    const put = await request(app())
      .put(`${s.base}/settings`)
      .set(s.owner.auth)
      .send({ ticketPrefix: 'p', remoteJoinRadiusMeters: 2000 });
    expect(put.body.data).toMatchObject({ ticketPrefix: 'P', remoteJoinRadiusMeters: 2000 });
    // Search lists businesses that run a queue (D3h): the change is announced.
    const announced = await h.inShop(s, (tx) =>
      tx.outboxEvent.findMany({ where: { aggregateId: s.b.id, topic: 'queue.settings.updated' } }),
    );
    expect(announced.map((e) => e.payload)).toEqual([
      expect.objectContaining({ data: { businessId: s.b.id.toString() } }),
    ]);
    for (const bad of [{ ticketPrefix: 'A1' }, { remoteJoinRadiusMeters: 10 }, {}]) {
      expect((await request(app()).put(`${s.base}/settings`).set(s.owner.auth).send(bad)).status).toBe(400);
    }
    expect(
      (
        await request(app())
          .put(`${s.base}/settings`)
          .set((await s.member('front_desk')).auth)
          .send({ maxQueueSize: 5 })
      ).status,
    ).toBe(403);
    await desk(s, '/open');
    expect((await join(await person(), s)).body.data.ticket).toBe('P-001');
  });
});

describe('Plans (billing on)', () => {
  it('the virtual queue needs a plan that includes it (Starter doesn’t)', async () => {
    await withBilling(h.world, 'business', async () => {
      const s = await shop({ open: false });
      const refused = await desk(s, '/open');
      expect([refused.status, refused.body.error.code]).toEqual([403, 'PLAN_FEATURE_UNAVAILABLE']);
      await givePlan(h.world, s.b.id, 'business_essential');
      expect((await desk(s, '/open')).status).toBe(200);
    });
  });

  it('customers join queues for free and as often as they like (D-101), one queue at a time', async () => {
    await withBilling(h.world, 'user', async () => {
      const [s, other] = [await shop(), await shop()];
      const me = await person();
      for (let visit = 0; visit < 3; visit++) {
        const ticket = await join(me, s);
        expect(ticket.status).toBe(201);
        // Already waiting here: another queue has to wait until this visit is over.
        expect((await join(me, other)).body.error?.code).toBe('QUEUE_ALREADY_JOINED');
        await desk(s, '/call-next');
        await desk(s, `/entries/${ticket.body.data.id}/serve`);
        await desk(s, `/entries/${ticket.body.data.id}/complete`);
      }
      expect((await join(me, other)).status).toBe(201);
    });
  });
});
