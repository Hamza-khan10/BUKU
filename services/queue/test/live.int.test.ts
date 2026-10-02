import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  createRedisClient,
  createRevocationStore,
  Readiness,
  type JwtSigner,
} from '@buku/common';
import { createDatabaseClient, type Database } from '@buku/database';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testEnv } from '../../../packages/database/test/int-env.js';
import { buildQueueApp } from '../src/app.js';
import type { LiveHub } from '../src/live/live-hub.js';

/**
 * Live queue screens over real HTTP. Two copies of the service run side by
 * side (like two replicas behind the gateway): a change made through one
 * must reach viewers connected to the other, through Valkey.
 */

let db: Database;
let signer: JwtSigner;
const redisClients: Redis[] = [];
const servers: Server[] = [];
type Replica = { url: string; live: LiveHub };
let replicaA: Replica;
let replicaB: Replica;
let limited: Replica;

async function replica(live: Record<string, number> = {}): Promise<Replica> {
  const [redis, subscriber] = [0, 1].map((i) =>
    createRedisClient({ url: testEnv.redisUrl, connectionName: `queue-live-test-${i}` }),
  ) as [Redis, Redis];
  redisClients.push(redis, subscriber);
  const verifier = await createJwtVerifier({
    issuer: 'https://auth.test',
    audience: 'buku-api',
    keys: [{ keyId: 'k1', publicKeyPem }],
  });
  const built = buildQueueApp({
    db,
    redis,
    subscriber,
    verifier,
    revocations: createRevocationStore(redis),
    live: { debounceMs: 50, ...live },
    http: {
      service: 'queue-live-test',
      logger: createLogger({ service: 'queue-live-test', level: 'silent' }),
      readiness: new Readiness(),
      trustProxyHops: 1,
    },
  });
  await built.live.start();
  const server = built.app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, live: built.live };
}

let publicKeyPem: string;

beforeAll(async () => {
  db = createDatabaseClient({ url: testEnv.appUrl, applicationName: 'queue-live-test', maxConnections: 10 });
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  signer = await createJwtSigner({
    issuer: 'https://auth.test',
    audience: 'buku-api',
    keyId: 'k1',
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  });
  [replicaA, replicaB, limited] = [
    await replica(),
    await replica(),
    await replica({ maxPerClient: 2, heartbeatMs: 50 }),
  ];
});

afterAll(async () => {
  for (const r of [replicaA, replicaB, limited]) await r.live.close();
  for (const s of servers) await new Promise((r) => s.close(r));
  for (const c of redisClients) await c.quit();
  await db.$disconnect();
});

async function person(name = `Customer ${randomUUID().slice(0, 6)}`) {
  const user = await db.user.create({ data: { name, emailHash: randomBytes(32).toString('hex') } });
  const { token } = await signer.sign({ sub: user.id, role: 'user', sid: randomUUID() });
  return { id: user.id, name, token };
}

/** A business in Lahore with today's queue open. */
async function shop() {
  const owner = await person();
  const suffix = randomUUID().slice(-12);
  const category = await db.category.create({ data: { name: `Cat ${suffix}`, slug: `cat-${suffix}` } });
  const b = await db.business.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      name: `Clinic ${suffix}`,
      slug: `clinic-${suffix}`,
      city: 'Lahore',
      country: 'PK',
      timezone: 'Asia/Karachi',
      currency: 'PKR',
      lat: 31.5204,
      lng: 74.3587,
    },
  });
  const res = await call(replicaA, 'POST', `/v1/businesses/${b.id}/queue/open`, owner.token);
  expect(res.status).toBe(200);
  return { owner, b };
}

function call(r: Replica, method: string, path: string, token?: string, body?: object) {
  return fetch(`${r.url}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Forwarded-For': `10.9.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254) + 1}`,
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    ...(body && { body: JSON.stringify(body) }),
  });
}

const join = (r: Replica, token: string, businessId: string) =>
  call(r, 'POST', '/v1/queue/join', token, { businessId, lat: 31.531, lng: 74.364 });

interface SseEvent {
  event?: string;
  data?: string;
  id?: string;
  retry?: string;
  comment?: string;
}

/** A Server-Sent Events client that collects events and lets a test wait for one. */
async function stream(r: Replica, slugOrId: string, client = '10.20.30.40') {
  const abort = new AbortController();
  const res = await fetch(`${r.url}/v1/queue/public/${slugOrId}/stream`, {
    headers: { 'X-Forwarded-For': client },
    signal: abort.signal,
  });
  const events: SseEvent[] = [];
  let ended = false;
  let buffer = '';
  const waiters: (() => void)[] = [];
  const reader = res.body?.getReader();
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader!.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        let cut;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const ev: SseEvent = {};
          for (const line of block.split('\n')) {
            if (line.startsWith(':')) ev.comment = line.slice(1).trim();
            else {
              const i = line.indexOf(':');
              (ev as Record<string, string>)[line.slice(0, i)] = line.slice(i + 1).trimStart();
            }
          }
          events.push(ev);
        }
        waiters.splice(0).forEach((w) => w());
      }
    } catch {
      /* aborted */
    }
    ended = true;
    waiters.splice(0).forEach((w) => w());
  })();
  const states = () =>
    events.filter((e) => e.event === 'state').map((e) => JSON.parse(e.data!) as Record<string, unknown>);
  return {
    res,
    events,
    states,
    get ended() {
      return ended;
    },
    /** Resolves when `check()` holds, or fails after `ms`. */
    async until(check: () => boolean, ms = 3_000) {
      const deadline = Date.now() + ms;
      while (!check()) {
        if (Date.now() > deadline) throw new Error(`timed out; events so far: ${JSON.stringify(events)}`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    },
    close: () => abort.abort(),
  };
}

describe('Live queue screens', () => {
  it('a phone watching replica B sees a ticket taken on replica A — ticket numbers only', async () => {
    const { b } = await shop();
    const s = await stream(replicaB, b.slug);
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(s.res.headers.get('x-accel-buffering')).toBe('no');
    await s.until(() => s.states().length === 1);
    expect(s.events[0]).toEqual({ retry: '5000' });
    expect(s.states()[0]).toMatchObject({ status: 'open', waiting: 0, line: [] });

    const ayesha = await person('Ayesha Khan');
    const joined = await join(replicaA, ayesha.token, b.id);
    expect(joined.status).toBe(201);
    await s.until(() => s.states().at(-1)!.waiting === 1);
    expect(s.states().at(-1)).toMatchObject({
      line: ['A-001'],
      called: [],
      avgServiceSeconds: 300,
      staffOnShift: 0,
    });
    expect(JSON.stringify(s.events)).not.toContain('Ayesha');

    // The front desk calls it on replica A; the display on B shows it.
    await call(replicaA, 'POST', `/v1/businesses/${b.id}/queue/call-next`, (await ownerOf(b.id)).token);
    await s.until(() => (s.states().at(-1)!.called as string[]).includes('A-001'));
    s.close();
  });

  it('a burst of changes arrives as fewer updates, ending in the right state', async () => {
    const { b } = await shop();
    const s = await stream(replicaA, b.id);
    await s.until(() => s.states().length === 1);
    const people = await Promise.all(Array.from({ length: 6 }, () => person()));
    await Promise.all(people.map((p) => join(replicaB, p.token, b.id)));
    await s.until(() => s.states().at(-1)!.waiting === 6);
    expect(s.states().length - 1).toBeLessThan(6);
    s.close();
  });

  it('a refused change (rolled back) sends nothing', async () => {
    const { b } = await shop();
    await db.queueSession.updateMany({ where: { businessId: b.id }, data: { maxQueueSize: 1 } });
    await join(replicaA, (await person()).token, b.id);
    const s = await stream(replicaA, b.id);
    await s.until(() => s.states().length === 1);
    expect((await join(replicaA, (await person()).token, b.id)).status).toBe(409); // full
    await new Promise((r) => setTimeout(r, 300));
    expect(s.states()).toHaveLength(1);
    s.close();
  });

  it('heartbeats keep quiet streams open; per-address limit; unknown business is a normal 404', async () => {
    const { b } = await shop();
    const [one, two] = [await stream(limited, b.id, '10.1.1.1'), await stream(limited, b.id, '10.1.1.1')];
    await one.until(() => one.events.some((e) => e.comment === 'ping'));
    const third = await stream(limited, b.id, '10.1.1.1');
    expect(third.res.status).toBe(429);
    expect(third.res.headers.get('retry-after')).toBe('30');
    expect((await stream(limited, b.id, '10.1.1.2')).res.status).toBe(200); // another address is fine

    const missing = await stream(limited, 'no-such-business');
    expect(missing.res.status).toBe(404);
    expect(missing.res.headers.get('content-type')).toContain('application/json');
    one.close();
    two.close();
  });

  it('shutting down ends every stream (viewers reconnect to another replica)', async () => {
    const { b } = await shop();
    const extra = await replica();
    const s = await stream(extra, b.id);
    await s.until(() => s.states().length === 1);
    expect(extra.live.viewerCount).toBe(1);
    await extra.live.close();
    await s.until(() => s.ended);
    expect(extra.live.viewerCount).toBe(0);
    expect((await stream(extra, b.id)).res.status).toBe(503);
  });
});

async function ownerOf(businessId: string) {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { ownerId: true } });
  const { token } = await signer.sign({ sub: b.ownerId, role: 'user', sid: randomUUID() });
  return { token };
}
