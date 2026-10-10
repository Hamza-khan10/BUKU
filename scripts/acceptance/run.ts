/**
 * Phase 2 acceptance (BUILD_GUIDE 2.9), against the running development stack
 * through the gateway — the same path the apps use:
 *
 *   1. Journeys: sign in → phone → booking request → business confirms →
 *      reminder → check in → complete → review; free plan's one visit → trial
 *      → second booking; queue join (distance and one-queue rules) → called →
 *      served. Each step checks the messages people receive.
 *   2. Races: many requests at the same moment for one slot, one review, the
 *      next queue ticket, and cancel-versus-check-in.
 *   3. Authorization: every route the services expose (read from the real
 *      route setup), without a token, as an unrelated customer on another
 *      business's routes, and as a customer on admin routes.
 *
 * Run: `pnpm acceptance` (needs `pnpm dev`). Creates its own businesses and
 * people (suffixed with the run id); restores the billing switch it flips.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { call, data, eventually, signIn, sql, type Person, type Res } from './client.js';
import { allRoutes, type Route } from './routes.js';

const RUN = randomUUID().slice(0, 8);
const results: { name: string; ok: boolean; detail?: string }[] = [];
const started = Date.now();

async function step(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail });
    console.log(`  \x1b[31m✘\x1b[0m ${name}\n      ${detail}`);
  }
}

function expect(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}
const show = (r: Res) => `${r.status} ${JSON.stringify(r.body).slice(0, 300)}`;
const is = (r: Res, status: number, what: string) =>
  expect(r.status === status, `${what}: expected ${status}, got ${show(r)}`);

/** Lahore, and the same place moved `km` north. */
const HOME = { lat: 31.5204, lng: 74.3587 };
const north = (km: number) => ({ lat: HOME.lat + km / 111.2, lng: HOME.lng });
/**
 * The test shops' timezone: one where it's daytime now, so night-time quiet hours (which
 * correctly hold back reminders) never decide whether a run passes.
 */
const tz =
  [
    'Asia/Karachi',
    'Europe/London',
    'America/New_York',
    'Asia/Tokyo',
    'America/Los_Angeles',
    'Australia/Sydney',
    'Asia/Dubai',
  ].find((zone) => {
    const h = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(
        new Date(),
      ),
    );
    return h >= 10 && h < 17;
  }) ?? 'Asia/Karachi';
const localDate = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);

interface Shop {
  id: string;
  slug: string;
  serviceId: string;
  staffId: string;
  owner: Person;
}

async function inbox(p: Person): Promise<{ id: string; title: string; type: string }[]> {
  return data<{ id: string; title: string; type: string }[]>(
    await call('GET', '/v1/notifications?limit=50', { token: p.token }),
  );
}
const hasMessage = (p: Person, title: RegExp) => async () =>
  (await inbox(p)).find((n) => title.test(n.title));

/** A business ready to take bookings and run a queue, set up through the API like an owner would. */
async function openShop(
  owner: Person,
  name: string,
  at: { lat: number; lng: number },
  categoryId: string,
): Promise<Shop> {
  const created = await call('POST', '/v1/businesses', {
    token: owner.token,
    body: {
      name,
      categoryId,
      address: '12 Acceptance Road',
      city: 'Lahore',
      country: 'PK',
      lat: at.lat,
      lng: at.lng,
      timezone: tz,
      currency: 'PKR',
      acceptedBusinessTermsVersion: '1.0',
    },
  });
  is(created, 201, 'create business');
  const b = data<{ id: string; slug: string }>(created);
  const base = `/v1/businesses/${b.id}`;
  const allDay = [0, 1, 2, 3, 4, 5, 6];
  is(
    await call('PUT', `${base}/hours`, {
      token: owner.token,
      body: { hours: allDay.map((d) => ({ dayOfWeek: d, openTime: '00:00', closeTime: '23:59' })) },
    }),
    200,
    'opening hours',
  );
  const service = await call('POST', `${base}/services`, {
    token: owner.token,
    body: { name: 'Haircut', durationMinutes: 30, price: 800 },
  });
  is(service, 201, 'add service');
  const serviceId = data<{ id: string }>(service).id;
  const staff = await call('POST', `${base}/staff`, {
    token: owner.token,
    body: { displayName: 'Ali', serviceIds: [serviceId] },
  });
  is(staff, 201, 'add staff');
  const staffId = data<{ id: string }>(staff).id;
  is(
    await call('PUT', `${base}/staff/${staffId}/hours`, {
      token: owner.token,
      body: { days: allDay.map((d) => ({ dayOfWeek: d, ranges: [{ start: '00:00', end: '23:59' }] })) },
    }),
    200,
    'staff hours',
  );
  is(
    await call('PUT', `${base}/queue/settings`, {
      token: owner.token,
      body: { remoteJoinRadiusMeters: 2000 },
    }),
    200,
    'queue settings',
  );
  return { id: b.id, slug: b.slug, serviceId, staffId, owner };
}

async function slots(shop: Shop, daysAhead = 1): Promise<string[]> {
  const date = localDate(new Date(Date.now() + daysAhead * 86_400_000));
  const r = await call(
    'GET',
    `/v1/businesses/${shop.id}/availability?serviceId=${shop.serviceId}&date=${date}&days=2`,
  );
  is(r, 200, 'availability');
  return data<{ days: { slots: { startAt: string }[] }[] }>(r).days.flatMap((d) =>
    d.slots.map((s) => s.startAt),
  );
}

const book = (p: Person, shop: Shop, startAt: string) =>
  call('POST', '/v1/appointments', {
    token: p.token,
    body: { businessId: shop.id, serviceId: shop.serviceId, startAt },
  });

/** Simulated time: the visit starts in `minutes` (negative: started that long ago). */
function moveVisit(appointmentId: string, minutes: number, bookedDaysAgo = 3) {
  sql(`UPDATE appointments SET
         start_at = now() + interval '${minutes} minutes',
         end_at = now() + interval '${minutes + 30} minutes',
         blocked_until = now() + interval '${minutes + 30} minutes',
         created_at = now() - interval '${bookedDaysAgo} days'
       WHERE id = '${appointmentId}'`);
}

async function main() {
  console.log(
    `\nBUKU Phase 2 acceptance — run ${RUN} against ${process.env.ACCEPTANCE_API ?? 'http://localhost:8000'} (shops in ${tz})\n`,
  );

  // ── People and places ──────────────────────────────────────────────────────
  const admin = await signIn(`acceptance-admin@buku.dev`, 'super_admin', 'Acceptance Admin');
  const owner = await signIn(`acc-owner-${RUN}@buku.dev`, 'business_owner', 'Owner Acceptance');
  const owner2 = await signIn(`acc-owner2-${RUN}@buku.dev`, 'business_owner', 'Second Owner');
  const ayesha = await signIn(`acc-ayesha-${RUN}@example.com`, 'user', 'Ayesha Noor');
  const bilal = await signIn(`acc-bilal-${RUN}@example.com`, 'user', 'Bilal Ahmed');
  const sample = data<{ slug: string }[]>(await call('GET', '/v1/businesses/search?q=haircut&limit=1'))[0];
  expect(sample, 'no seeded business to borrow a category from (run pnpm db:seed)');
  const categoryId = data<{ category: { id: string } }>(await call('GET', `/v1/businesses/${sample.slug}`))
    .category.id;
  const shop = await openShop(owner, `Acceptance Cuts ${RUN}`, HOME, categoryId);
  const shop2 = await openShop(owner2, `Acceptance Fades ${RUN}`, north(1), categoryId);

  console.log('Journey 1 — booking, confirmation, reminder, visit, review');
  let appointmentId = '';
  let code = '';
  await step('customer signs in and adds a phone number (with WhatsApp consent)', async () => {
    is(await call('GET', '/v1/auth/me', { token: ayesha.token }), 200, '/me');
    const r = await call('PUT', '/v1/auth/me/phone', {
      token: ayesha.token,
      body: { phone: '+923001112233', whatsappOptIn: true },
    });
    is(r, 200, 'add phone');
    expect(data<{ whatsappOptIn: boolean }>(r).whatsappOptIn === true, 'consent not recorded');
  });
  await step('business asks to approve bookings; the request reaches owner and customer', async () => {
    is(
      await call('PUT', `/v1/businesses/${shop.id}/booking-settings`, {
        token: owner.token,
        body: { confirmationMode: 'manual' },
      }),
      200,
      'manual approval',
    );
    const r = await book(ayesha, shop, (await slots(shop))[4]!);
    is(r, 201, 'book');
    const a = data<{ id: string; status: string; code: string }>(r);
    expect(a.status === 'pending', `expected pending, got ${a.status}`);
    appointmentId = a.id;
    code = a.code;
    await eventually('customer: "Request sent"', hasMessage(ayesha, /^Request sent$/));
    await eventually('owner: "New booking request"', hasMessage(owner, /^New booking request$/));
  });
  await step('business confirms; the customer is told, with the code', async () => {
    is(
      await call('POST', `/v1/businesses/${shop.id}/appointments/${appointmentId}/confirm`, {
        token: owner.token,
      }),
      200,
      'confirm',
    );
    await eventually('customer: "Booking confirmed"', hasMessage(ayesha, /^Booking confirmed$/));
  });
  await step('reminder before the visit (simulated time: 100 min away, booked 3 days ago)', async () => {
    moveVisit(appointmentId, 100);
    await eventually(
      'customer: "Soon: Haircut at …"',
      hasMessage(ayesha, /^Soon: Haircut at \d\d:\d\d$/),
      90_000,
    );
  });
  await step('someone else can’t see, cancel or review the booking (looks missing)', async () => {
    is(await call('GET', `/v1/appointments/${appointmentId}`, { token: bilal.token }), 404, 'view');
    is(
      await call('POST', `/v1/appointments/${appointmentId}/cancel`, {
        token: bilal.token,
        body: { reasonCode: 'schedule_conflict' },
      }),
      404,
      'cancel',
    );
    is(
      await call('POST', `/v1/appointments/${appointmentId}/review`, {
        token: bilal.token,
        body: { overall: 1 },
      }),
      404,
      'review',
    );
    const note = (await inbox(ayesha))[0]!;
    is(
      await call('POST', `/v1/notifications/${note.id}/read`, { token: bilal.token }),
      404,
      'someone else’s message',
    );
  });
  await step('the visit: front desk scans the code, then completes it', async () => {
    moveVisit(appointmentId, -5);
    is(
      await call('POST', `/v1/businesses/${shop.id}/check-in`, { token: owner.token, body: { code } }),
      200,
      'check in',
    );
    is(
      await call('POST', `/v1/businesses/${shop.id}/appointments/${appointmentId}/complete`, {
        token: owner.token,
      }),
      200,
      'complete',
    );
  });
  await step(
    'review: five taps at once make exactly one review; owner hears; public list shows it',
    async () => {
      const tries = await Promise.all(
        Array.from({ length: 5 }, () =>
          call('POST', `/v1/appointments/${appointmentId}/review`, {
            token: ayesha.token,
            body: { overall: 5, comment: 'Quick and friendly' },
            paced: false,
          }),
        ),
      );
      const created = tries.filter((t) => t.status === 201).length;
      const refused = tries.filter((t) => t.status === 409).length;
      expect(
        created === 1 && refused === 4,
        `expected 1 created + 4 refused, got ${tries.map((t) => t.status).join(',')}`,
      );
      await eventually('owner: "New 5★ review"', hasMessage(owner, /^New 5★ review$/));
      const list = data<{ author: string; comment: string }[]>(
        await call('GET', `/v1/businesses/${shop.slug}/reviews`),
      );
      expect(
        list[0]?.author === 'Ayesha N.' && list[0].comment === 'Quick and friendly',
        `public list: ${JSON.stringify(list[0])}`,
      );
    },
  );

  console.log('Journey 2 — free plan, trial, second booking');
  const userBilling = data<{ audience: string; enabled: boolean }[]>(
    await call('GET', '/v1/admin/billing/settings', { token: admin.token }),
  ).find((x) => x.audience === 'user');
  expect(userBilling, 'no billing settings for users');
  try {
    await step(
      'with billing on, the free plan’s one visit is used, then the trial unlocks a second',
      async () => {
        is(
          await call('PUT', '/v1/admin/billing/settings/user', {
            token: admin.token,
            body: { enabled: true },
          }),
          200,
          'billing on',
        );
        is(
          await call('PUT', `/v1/businesses/${shop2.id}/booking-settings`, {
            token: owner2.token,
            body: { confirmationMode: 'automatic' },
          }),
          200,
          'automatic',
        );
        const free = await signIn(`acc-free-${RUN}@example.com`, 'user', 'Free Person');
        const times = await slots(shop2, 2);
        const first = await book(free, shop2, times[2]!);
        is(first, 201, 'first booking (the free visit)');
        const second = await book(free, shop2, times[10]!);
        expect(
          second.status >= 400 && /PLAN/.test(second.body.error?.code ?? ''),
          `second should need a plan: ${show(second)}`,
        );
        is(await call('POST', '/v1/billing/me/trial', { token: free.token }), 200, 'start trial');
        is(await book(free, shop2, times[10]!), 201, 'second booking on the trial');
      },
    );
  } finally {
    await call('PUT', '/v1/admin/billing/settings/user', {
      token: admin.token,
      body: { enabled: userBilling.enabled },
    });
  }

  console.log('Journey 3 — the queue');
  let ticketId = '';
  await step('queue opens; a customer nearby joins; too far is refused; one queue at a time', async () => {
    for (const s of [shop, shop2])
      is(
        await call('POST', `/v1/businesses/${s.id}/queue/open`, { token: s.owner.token }),
        200,
        'open queue',
      );
    const near = await call('POST', '/v1/queue/join', {
      token: bilal.token,
      body: { businessId: shop.id, ...north(0.3) },
    });
    is(near, 201, 'join nearby');
    ticketId = data<{ id: string }>(near).id;
    const far = await call('POST', '/v1/queue/join', {
      token: (await signIn(`acc-far-${RUN}@example.com`)).token,
      body: { businessId: shop.id, ...north(40) },
    });
    expect(far.body.error?.code === 'QUEUE_TOO_FAR', `far join: ${show(far)}`);
    const second = await call('POST', '/v1/queue/join', {
      token: bilal.token,
      body: { businessId: shop2.id, ...north(1) },
    });
    expect(second.body.error?.code === 'QUEUE_ALREADY_JOINED', `second queue: ${show(second)}`);
  });
  await step('called (“It’s your turn”), served, done', async () => {
    const called = await call('POST', `/v1/businesses/${shop.id}/queue/call-next`, { token: owner.token });
    is(called, 200, 'call next');
    await eventually('customer: "It’s your turn"', hasMessage(bilal, /^It’s your turn — /));
    is(
      await call('POST', `/v1/businesses/${shop.id}/queue/entries/${ticketId}/serve`, { token: owner.token }),
      200,
      'serve',
    );
    is(
      await call('POST', `/v1/businesses/${shop.id}/queue/entries/${ticketId}/complete`, {
        token: owner.token,
      }),
      200,
      'complete',
    );
    const t = data<{ status: string }>(
      await call('GET', `/v1/queue/tickets/${ticketId}`, { token: bilal.token }),
    );
    expect(t.status === 'completed', `ticket ${t.status}`);
    is(
      await call('GET', `/v1/queue/tickets/${ticketId}`, { token: ayesha.token }),
      404,
      'someone else’s ticket',
    );
  });

  console.log('Races — many requests at the same moment');
  const crowd: Person[] = [];
  for (let i = 0; i < 8; i++) crowd.push(await signIn(`acc-crowd${i}-${RUN}@example.com`));
  await step('eight people book the same slot at once: exactly one gets it', async () => {
    is(
      await call('PUT', `/v1/businesses/${shop.id}/booking-settings`, {
        token: owner.token,
        body: { confirmationMode: 'automatic' },
      }),
      200,
      'automatic',
    );
    const slot = (await slots(shop, 3))[6]!;
    const tries = await Promise.all(crowd.map((p) => book(p, shop, slot)));
    const won = tries.filter((t) => t.status === 201).length;
    expect(won === 1, `winners: ${won} (${tries.map((t) => t.status).join(',')})`);
    expect(
      tries.every((t) => t.status === 201 || t.status === 409),
      `unexpected: ${tries.map((t) => t.status).join(',')}`,
    );
  });
  await step(
    'two front-desk tablets press "call next" at once: two different people are called',
    async () => {
      const deskTablet = owner;
      for (const p of crowd.slice(0, 3))
        is(
          await call('POST', '/v1/queue/join', {
            token: p.token,
            body: { businessId: shop.id, ...north(0.2) },
          }),
          201,
          'join',
        );
      const calls = await Promise.all(
        [deskTablet, deskTablet].map((p) =>
          call('POST', `/v1/businesses/${shop.id}/queue/call-next`, { token: p.token, paced: false }),
        ),
      );
      expect(
        calls.every((c) => c.status === 200),
        `calls: ${calls.map(show).join(' | ')}`,
      );
      const tickets = calls.map((c) => data<{ ticket: string }>(c).ticket);
      expect(tickets[0] !== tickets[1], `both tablets called ${tickets[0]}`);
    },
  );
  await step('customer cancels while the front desk checks them in: one wins, never both', async () => {
    const p = crowd[7]!;
    const r = await book(p, shop, (await slots(shop, 4))[8]!);
    is(r, 201, 'book');
    const a = data<{ id: string; code: string }>(r);
    moveVisit(a.id, 60);
    sql(`UPDATE booking_settings SET cancellation_window_hours = 0 WHERE business_id = '${shop.id}'`);
    const [cancel, checkIn] = await Promise.all([
      call('POST', `/v1/appointments/${a.id}/cancel`, {
        token: p.token,
        body: { reasonCode: 'schedule_conflict' },
        paced: false,
      }),
      call('POST', `/v1/businesses/${shop.id}/check-in`, {
        token: owner.token,
        body: { code: a.code },
        paced: false,
      }),
    ]);
    const final = sql(
      `SELECT status || ',' || (checked_in_at IS NOT NULL) FROM appointments WHERE id = '${a.id}'`,
    );
    const winners = [cancel, checkIn].filter((x) => x.status === 200).length;
    expect(winners === 1, `both or neither succeeded: cancel ${show(cancel)} | check-in ${show(checkIn)}`);
    expect(final === 'cancelled,false' || final === 'confirmed,true', `inconsistent final state: ${final}`);
  });

  console.log('Authorization — every route');
  await authorizationScan({ shop, stranger: bilal, customer: ayesha });

  // Tidy up: the test shops leave search and stop taking bookings (kept for inspection).
  for (const s of [shop, shop2])
    await call('POST', `/v1/admin/businesses/${s.id}/suspend`, {
      token: admin.token,
      body: { reason: `Acceptance run ${RUN} finished` },
    });

  // ── Report ─────────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  const secs = Math.round((Date.now() - started) / 1000);
  console.log(
    `\n${failed.length ? '\x1b[31mFAILED' : '\x1b[32mPASSED'}\x1b[0m — ${results.length - failed.length}/${results.length} checks in ${secs}s (run ${RUN})\n`,
  );
  process.exit(failed.length ? 1 : 0);
}

// ── Authorization scan ───────────────────────────────────────────────────────

/** Routes anyone may call without signing in — on purpose. Anything else must answer 401. */
const PUBLIC: [Route['method'], string][] = [
  ['POST', '/v1/auth/oauth/google'],
  ['POST', '/v1/auth/oauth/apple'],
  ['POST', '/v1/auth/business-login'],
  ['POST', '/v1/auth/dev/login'],
  ['POST', '/v1/auth/refresh'],
  /** Signs out the refresh token sent in the body (works even after the access token expired). */
  ['POST', '/v1/auth/logout'],
  /** Second step of sign-in: the challenge token from the first step is the proof (D-081). */
  ['POST', '/v1/auth/mfa/verify'],
  ['GET', '/v1/billing/plans'],
  ['POST', '/v1/billing/webhooks/paddle'],
  ['GET', '/v1/businesses/:idOrSlug'],
  ['GET', '/v1/businesses/:idOrSlug/services'],
  ['GET', '/v1/businesses/:idOrSlug/staff'],
  ['GET', '/v1/businesses/:idOrSlug/reviews'],
  ['GET', '/v1/businesses/:idOrSlug/availability'],
  ['GET', '/v1/notifications/unsubscribe'],
  ['POST', '/v1/notifications/unsubscribe'],
  ['GET', '/v1/webhooks/whatsapp'],
  ['POST', '/v1/webhooks/whatsapp'],
  ['GET', '/v1/queue/public/:idOrSlug'],
  ['GET', '/v1/queue/public/:idOrSlug/stream'],
  ['GET', '/v1/businesses/search'],
  ['GET', '/v1/businesses/nearby'],
  ['GET', '/v1/businesses/autocomplete'],
  ['GET', '/v1/businesses/featured'],
  ['GET', '/v1/businesses/trending'],
  ['GET', '/v1/categories'],
  ['GET', '/v1/categories/:slug'],
  ['GET', '/v1/categories/:slug/businesses'],
  ['GET', '/v1/cities'],
];
/** Signed-in actions any customer may take on a business (not team tools). */
const CUSTOMER_ACTIONS: [Route['method'], string][] = [
  ['POST', '/v1/businesses'],
  ['GET', '/v1/businesses/mine'],
  ['POST', '/v1/businesses/:id/reports'],
];

const isIn = (list: [string, string][], r: Route) => list.some(([m, p]) => m === r.method && p === r.path);

function fill(path: string, shop: Shop): string {
  return path.replace(/:(\w+)/g, (_m, name: string) => {
    if (name === 'idOrSlug') return shop.slug;
    if ((name === 'id' || name === 'businessId') && path.startsWith('/v1/businesses/')) return shop.id;
    if (name === 'slug') return 'barbershop';
    if (name === 'code') return 'business_essential';
    if (name === 'audience') return 'user';
    if (name === 'channel') return 'web';
    return randomUUID();
  });
}

async function authorizationScan(ctx: { shop: Shop; stranger: Person; customer: Person }) {
  const routes = allRoutes();
  const teamRoutes = routes
    .filter(
      (r) => /^\/v1\/businesses\/:(id|businessId)\//.test(r.path) || /^\/v1\/businesses\/:id$/.test(r.path),
    )
    .filter((r) => !isIn(PUBLIC, r) && !isIn(CUSTOMER_ACTIONS, r));
  const adminRoutes = routes.filter((r) => r.path.startsWith('/v1/admin/'));
  const noTokenProblems: string[] = [];
  const strangerProblems: string[] = [];
  const adminProblems: string[] = [];

  for (const r of routes) {
    const path = fill(r.path, ctx.shop);
    if (r.path.endsWith('/stream')) continue; // a live stream: checked by the queue tests
    const res = await call(r.method, path, r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} });
    const pub = isIn(PUBLIC, r);
    // A public route may say "not set up yet" (503, e.g. Paddle in development), never crash.
    if (pub && res.status >= 500 && res.body.error?.code !== 'FEATURE_DISABLED')
      noTokenProblems.push(`${r.method} ${r.path} → ${res.status}`);
    if (!pub && res.status !== 401)
      noTokenProblems.push(`${r.method} ${r.path} → ${res.status} (expected 401)`);
  }
  await step(`no token: all ${routes.length} routes refuse, except the ${PUBLIC.length} public ones`, () => {
    expect(!noTokenProblems.length, noTokenProblems.join('\n      '));
  });

  // Defence in depth: the same, straight to each service inside the network (no gateway).
  await step('no token, bypassing the gateway: every service refuses on its own', () => {
    const problems = directScan(
      routes
        .filter((r) => !isIn(PUBLIC, r) && !r.path.endsWith('/stream'))
        .map((r) => ({
          ...r,
          path: fill(r.path, ctx.shop),
        })),
    );
    expect(!problems.length, problems.join('\n      '));
  });

  for (const r of teamRoutes) {
    const res = await call(r.method, fill(r.path, ctx.shop), {
      token: ctx.stranger.token,
      ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} }),
    });
    const refused =
      r.method === 'GET' ? [403, 404].includes(res.status) : res.status >= 400 && res.status < 500;
    if (!refused) strangerProblems.push(`${r.method} ${r.path} → ${show(res)}`);
  }
  await step(`a customer outside the business: all ${teamRoutes.length} team routes refuse`, () => {
    expect(!strangerProblems.length, strangerProblems.join('\n      '));
  });

  for (const r of adminRoutes) {
    const res = await call(r.method, fill(r.path, ctx.shop), {
      token: ctx.customer.token,
      ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} }),
    });
    if (res.status !== 403) adminProblems.push(`${r.method} ${r.path} → ${show(res)}`);
  }
  await step(`a customer on all ${adminRoutes.length} admin routes: 403`, () => {
    expect(!adminProblems.length, adminProblems.join('\n      '));
  });

  // D-091: admin routes answer only the admin app's server. Without its key they don't exist,
  // whoever is signed in — so a session stolen from anywhere else can't reach them.
  const keylessProblems: string[] = [];
  for (const r of adminRoutes) {
    const res = await call(r.method, fill(r.path, ctx.shop), {
      token: ctx.customer.token,
      asAdminApp: false,
      ...(r.method === 'GET' || r.method === 'DELETE' ? {} : { body: {} }),
    });
    if (res.status !== 404) keylessProblems.push(`${r.method} ${r.path} → ${show(res)}`);
  }
  await step(`without the admin app's key: all ${adminRoutes.length} admin routes are unknown (404)`, () => {
    expect(!keylessProblems.length, keylessProblems.join('\n      '));
  });

  // D-092: a service that is taken over can't reach the others, the gateway's admin API, or (for
  // services that never call outside) the internet — only the gateway's public routes.
  await step(
    'services are walled off from each other, from the gateway admin API and from the internet',
    () => {
      const fromSearch = reach('search', [
        'http://booking-service:3002/health',
        'http://auth-service:3001/health',
        'http://kong:8001/status',
        'https://example.com/',
        'http://kong:8000/v1/categories',
      ]);
      const fromBooking = reach('booking', ['http://queue-service:3003/health', 'https://example.com/']);
      const problems = Object.entries({ ...fromSearch, ...fromBooking })
        .filter(([url, answer]) => (url === 'http://kong:8000/v1/categories') !== (answer === 'reached'))
        .map(([url, answer]) => `${url} → ${answer}`);
      expect(!problems.length, problems.join('\n      '));
    },
  );

  // D-092: each service signs in to Kafka as itself, publishes only its own events and sees only
  // the topics it uses; without its password nothing connects.
  await step('Kafka: a service can’t forge another’s events or read its topics, and must sign in', () => {
    const answers = {
      search: kafkaProbe('search', {
        own: 'analytics.search',
        other: 'users.deleted',
        forge: 'bookings.created',
      }),
      booking: kafkaProbe('booking', {
        own: 'bookings.created',
        other: 'payments.completed',
        forge: 'users.deleted',
      }),
    };
    const problems = Object.entries(answers).flatMap(([service, r]) =>
      Object.entries(r)
        .filter(([what, answer]) => (what === 'sees its own topic') !== (answer === 'allowed'))
        .map(([what, answer]) => `${service} ${what} → ${answer}`),
    );
    expect(!problems.length, problems.join('\n      '));
  });
}

const PORTS: Record<string, number> = {
  auth: 3001,
  booking: 3002,
  queue: 3003,
  notification: 3004,
  search: 3005,
  business: 3008,
  billing: 3009,
};

/** Runs a small script inside a container (Node is in every service image); returns its last line. */
function inside(container: string, script: string): string {
  const out = execFileSync('docker', ['exec', '-i', container, 'node', '--input-type=module', '-'], {
    input: script,
    encoding: 'utf8',
  });
  return out.trim().split('\n').at(-1)!;
}

/**
 * Calls each service on its own port from inside its own container (services
 * can't reach each other, D-092); returns what didn't answer 401.
 */
function directScan(routes: Route[]): string[] {
  const bad: string[] = [];
  for (const service of [...new Set(routes.map((r) => r.service))]) {
    const targets = routes
      .filter((r) => r.service === service)
      .map((r) => ({
        label: `${r.method} ${r.path} (${r.service})`,
        method: r.method,
        url: `http://localhost:${PORTS[r.service]}${r.path}`,
      }));
    const script = `
      const targets = ${JSON.stringify(targets)};
      const bad = [];
      for (const t of targets) {
        const res = await fetch(t.url, {
          method: t.method,
          headers: { 'content-type': 'application/json' },
          body: t.method === 'GET' || t.method === 'DELETE' ? undefined : '{}',
        });
        if (res.status !== 401) bad.push(t.label + ' -> ' + res.status);
        await res.body?.cancel();
      }
      console.log(JSON.stringify(bad));`;
    bad.push(...(JSON.parse(inside(`buku-${service}-service-1`, script)) as string[]));
  }
  return bad;
}

/**
 * From inside a service, what it can reach (D-092): another service's port, the
 * gateway's admin API, the internet. Each answer is "reached" or the error code.
 */
function reach(fromService: string, urls: string[]): Record<string, string> {
  const script = `
    const urls = ${JSON.stringify(urls)};
    const out = {};
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
        await res.body?.cancel();
        out[url] = 'reached';
      } catch (err) {
        out[url] = err?.cause?.code ?? err?.name ?? 'failed';
      }
    }
    console.log(JSON.stringify(out));`;
  return JSON.parse(inside(`buku-${fromService}-service-1`, script)) as Record<string, string>;
}

/**
 * From inside a service, with its own Kafka user (D-092): can it see its own topic, see another's,
 * publish another's event, or connect with a wrong password or none? Each answer is "allowed" or
 * the refusal. Nothing is ever published: the one publish tried is one that must be refused.
 */
function kafkaProbe(
  fromService: string,
  topics: { own: string; other: string; forge: string },
): Record<string, string> {
  const script = `
    import { createRequire } from 'node:module';
    const { KafkaJS } = createRequire('/app/packages/kafka/package.json')('@confluentinc/kafka-javascript');
    const topics = ${JSON.stringify(topics)};
    const user = { username: process.env.KAFKA_SASL_USERNAME, password: process.env.KAFKA_SASL_PASSWORD };
    const kafka = (sasl) =>
      new KafkaJS.Kafka({
        kafkaJS: {
          brokers: [process.env.KAFKA_BROKERS],
          clientId: 'acceptance-isolation',
          ...(sasl ? { sasl: { mechanism: 'scram-sha-512', ...sasl } } : {}),
          connectionTimeout: 4000,
          requestTimeout: 6000,
          retry: { retries: 0 },
          logLevel: KafkaJS.logLevel.NOTHING,
        },
        'message.timeout.ms': 6000,
      });
    const out = {};
    const attempt = async (label, fn) => {
      try {
        await fn();
        out[label] = 'allowed';
      } catch (err) {
        out[label] = String(err?.message ?? err).slice(0, 80);
      }
    };
    const see = (sasl, topic) => async () => {
      const admin = kafka(sasl).admin();
      await admin.connect();
      try {
        await admin.fetchTopicMetadata({ topics: [topic], timeout: 6000 });
      } finally {
        await admin.disconnect();
      }
    };
    const publish = (topic) => async () => {
      const producer = kafka(user).producer();
      await producer.connect();
      try {
        await producer.send({ topic, messages: [{ value: 'acceptance: must be refused' }] });
      } finally {
        await producer.disconnect();
      }
    };
    await attempt('sees its own topic', see(user, topics.own));
    await attempt('sees ' + topics.other, see(user, topics.other));
    await attempt('publishes ' + topics.forge, publish(topics.forge));
    await attempt('connects with a wrong password', see({ ...user, password: 'x'.repeat(48) }, topics.own));
    await attempt('connects without signing in', see(null, topics.own));
    console.log(JSON.stringify(out));`;
  return JSON.parse(inside(`buku-${fromService}-service-1`, script)) as Record<string, string>;
}

main().catch((err: unknown) => {
  // The message only: an error's other fields can carry API answers (tokens included).
  console.error(err instanceof Error ? err.message : 'acceptance run failed');
  process.exit(1);
});
