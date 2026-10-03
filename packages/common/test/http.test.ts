import { generateKeyPairSync } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  authenticate,
  createHttpApp,
  createJwtSigner,
  createJwtVerifier,
  createLogger,
  rateLimit,
  Readiness,
  requireAuth,
  requireRole,
  sendSuccess,
  validated,
  zBody,
  zEmail,
  zUuid,
  type JwtSigner,
} from '../src/index.js';

const logger = createLogger({ service: 'test', level: 'silent' });

function buildApp(readiness = new Readiness(), extra?: (app: Express) => void): Express {
  return createHttpApp({
    service: 'test-service',
    logger,
    readiness,
    trustProxyHops: 1,
    bodyLimit: '1kb',
    routes: (app) => {
      app.post(
        '/things/:id',
        validated(
          {
            params: z.object({ id: zUuid }),
            body: zBody({ email: zEmail, name: z.string().min(1).max(50) }),
          },
          ({ params, body }, _req, res) => sendSuccess(res, { id: params.id, email: body.email }),
        ),
      );
      app.get('/boom', () => {
        throw new Error('database password is hunter2');
      });
      app.get('/async-boom', async () => {
        await Promise.resolve();
        throw new Error('async internal detail');
      });
      app.get('/conflict', () => {
        throw AppError.conflict('Slot taken', 'SLOT_UNAVAILABLE');
      });
      extra?.(app);
    },
  });
}

describe('createHttpApp baseline', () => {
  const app = buildApp();

  it('serves liveness without dependencies', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'test-service' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toBe("default-src 'none';frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('propagates a safe upstream request id and replaces an unsafe one', async () => {
    const good = await request(app).get('/health').set('X-Request-ID', 'kong-1234-abcd');
    expect(good.headers['x-request-id']).toBe('kong-1234-abcd');
    for (const unsafe of ['<script>alert(1)</script>', 'a'.repeat(500), 'short']) {
      const bad = await request(app).get('/health').set('X-Request-ID', unsafe);
      expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('returns the standard 404 envelope with request id', async () => {
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('exposes Prometheus metrics', async () => {
    await request(app).get('/nope');
    const res = await request(app).get('/metrics');
    expect(res.status).toBe(200);
    expect(res.text).toContain('http_request_duration_seconds');
    expect(res.text).toContain('nodejs_eventloop_lag_seconds');
  });
});

describe('error handling', () => {
  const app = buildApp();

  it('hides internal error details (sync and async)', async () => {
    for (const path of ['/boom', '/async-boom']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', message: 'Internal server error' });
      expect(JSON.stringify(res.body)).not.toMatch(/hunter2|internal detail|at .*\.ts/);
    }
  });

  it('passes AppErrors through with their status and code', async () => {
    const res = await request(app).get('/conflict');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('maps malformed JSON to 400 and oversized bodies to 413', async () => {
    const id = crypto.randomUUID();
    const bad = await request(app)
      .post(`/things/${id}`)
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_JSON');

    const big = await request(app)
      .post(`/things/${id}`)
      .send({ email: 'a@b.co', name: 'x'.repeat(5000) });
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
});

describe('validated()', () => {
  const app = buildApp();
  const id = '8f14e45f-ceea-4e7a-8f3b-2c1d5e9a7b10';

  it('passes parsed, normalized input to the handler', async () => {
    const res = await request(app)
      .post(`/things/${id}`)
      .send({ email: '  Alice@Example.com ', name: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id, email: 'alice@example.com' });
  });

  it('rejects unknown fields (mass-assignment protection)', async () => {
    const res = await request(app)
      .post(`/things/${id}`)
      .send({ email: 'a@b.co', name: 'A', role: 'super_admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reports every invalid field with its location', async () => {
    const res = await request(app).post('/things/not-a-uuid').send({ email: 'nope', name: '' });
    expect(res.status).toBe(400);
    const paths = (res.body.error.details as { path: string }[]).map((d) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['params.id', 'body.email', 'body.name']));
  });

  it('treats SQL-injection-shaped input as plain invalid input (400, never 500)', async () => {
    const res = await request(app)
      .post(`/things/${encodeURIComponent("1' OR '1'='1")}`)
      .send({ email: "' OR 1=1 --", name: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('readiness', () => {
  it('is 200 when all checks pass and 503 with details when one fails', async () => {
    const readiness = new Readiness(200)
      .add('db', () => Promise.resolve())
      .add('cache', () => Promise.reject(new Error('ECONNREFUSED 10.0.0.1:6379')));
    const res = await request(buildApp(readiness)).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.db.status).toBe('up');
    expect(res.body.checks.cache).toMatchObject({ status: 'down', error: 'ECONNREFUSED 10.0.0.1:6379' });
  });

  it('times out hanging checks', async () => {
    const readiness = new Readiness(50).add('slow', () => new Promise(() => undefined));
    const res = await request(buildApp(readiness)).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.checks.slow.error).toMatch(/timed out/);
  });

  it('reports shutting_down so load balancers drain the instance', async () => {
    const readiness = new Readiness().add('db', () => Promise.resolve());
    readiness.markShuttingDown();
    const res = await request(buildApp(readiness)).get('/ready');
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('shutting_down');
  });
});

describe('authentication and RBAC', () => {
  let signer: JwtSigner;
  let app: Express;

  beforeAll(async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const settings = { issuer: 'iss', audience: 'aud' };
    signer = await createJwtSigner({
      ...settings,
      keyId: 'k1',
      privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });
    const verifier = await createJwtVerifier({
      ...settings,
      keys: [{ keyId: 'k1', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString() }],
    });
    const revoked = new Set<string>();
    app = buildApp(new Readiness(), (a) => {
      const auth = authenticate({
        verifier,
        isRevoked: (t) => Promise.resolve(revoked.has(t.jti) ? 'logged_out' : false),
      });
      a.get('/me', auth, (req, res) => sendSuccess(res, requireAuth(req)));
      a.get('/admin', auth, requireRole('super_admin'), (_req, res) => sendSuccess(res, { ok: true }));
      a.post('/revoke', auth, (req, res) => {
        revoked.add(requireAuth(req).tokenId);
        sendSuccess(res, { ok: true });
      });
    });
  });

  it('401 without a token, or with a malformed one', async () => {
    expect((await request(app).get('/me')).status).toBe(401);
    expect((await request(app).get('/me').set('Authorization', 'Bearer garbage')).body.error.code).toBe(
      'TOKEN_INVALID',
    );
    expect((await request(app).get('/me').set('Authorization', 'Basic abc')).status).toBe(401);
  });

  it('exposes the verified identity to handlers', async () => {
    const { token } = await signer.sign({ sub: 'user-42', role: 'user' });
    const res = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ userId: 'user-42', role: 'user' });
  });

  it('403 when the role is insufficient, 200 when it is', async () => {
    const user = (await signer.sign({ sub: 'u', role: 'user' })).token;
    const admin = (await signer.sign({ sub: 'a', role: 'super_admin', mfa: true })).token;
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${user}`)).status).toBe(403);
    expect((await request(app).get('/admin').set('Authorization', `Bearer ${admin}`)).status).toBe(200);
  });

  it('an admin session without two-step sign-in is refused (D-081); the claim survives verification', async () => {
    const noMfa = (await signer.sign({ sub: 'a', role: 'super_admin' })).token;
    const res = await request(app).get('/admin').set('Authorization', `Bearer ${noMfa}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MFA_REQUIRED');
    const me = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${(await signer.sign({ sub: 'u', role: 'user', mfa: true })).token}`);
    expect(me.body.data).toMatchObject({ mfa: true });
  });

  it('honors the revocation hook and tells the client why', async () => {
    const { token } = await signer.sign({ sub: 'u', role: 'user' });
    const h = { Authorization: `Bearer ${token}` };
    expect((await request(app).post('/revoke').set(h)).status).toBe(200);
    const res = await request(app).get('/me').set(h);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'SESSION_REVOKED', details: { reason: 'logged_out' } });
  });
});

describe('rate limiting', () => {
  it('allows N requests, blocks N+1 with 429 and Retry-After', async () => {
    const app = buildApp(new Readiness(), (a) => {
      a.get('/limited', rateLimit({ keyPrefix: 'rl:test', points: 3, durationSeconds: 60 }), (_req, res) =>
        sendSuccess(res, { ok: true }),
      );
    });
    for (let i = 0; i < 3; i++) expect((await request(app).get('/limited')).status).toBe(200);
    const blocked = await request(app).get('/limited');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('keys by the real client IP behind one proxy, ignoring spoofed extra hops', async () => {
    const app = buildApp(new Readiness(), (a) => {
      a.get('/ip', (req, res) => sendSuccess(res, { ip: req.ip }));
    });
    const res = await request(app).get('/ip').set('X-Forwarded-For', '6.6.6.6, 203.0.113.9');
    expect(res.body.data.ip).toBe('203.0.113.9');
  });
});
