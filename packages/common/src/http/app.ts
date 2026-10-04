import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingMessage, ServerResponse } from 'node:http';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { rateLimit, type RateLimitInfo } from 'express-rate-limit';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import { createServiceMetrics } from './metrics.js';
import { errorHandler, notFoundHandler } from './middleware.js';
import type { Readiness } from './readiness.js';

/**
 * Builds the Express app every BUKU service runs, with the same security
 * baseline and operational endpoints everywhere. A service only supplies its
 * routes via `routes(app)`.
 *
 * Order matters:
 *   request id + logging → security headers → metrics → ops endpoints
 *   → JSON body parsing → service routes → 404 → error handler
 */

export interface HttpAppOptions {
  service: string;
  logger: Logger;
  readiness: Readiness;
  /** Proxy hops in front of this service (see TRUST_PROXY_HOPS). */
  trustProxyHops: number;
  /** Max JSON body size, e.g. "100kb". */
  bodyLimit?: string;
  /**
   * Keep the exact bytes of JSON bodies on `req.rawBody` — needed to verify
   * webhook signatures, which are computed over the raw body.
   */
  keepRawBody?: boolean;
  /**
   * Requests per minute one address may make to this process (D-086). Well above
   * the gateway's own limits, so it never touches normal use; it still holds if
   * the service is ever reached without the gateway. 0 turns it off.
   */
  baselineRequestsPerMinute?: number;
  routes: (app: Express) => void;
}

// Accept an upstream request id (Kong's correlation-id) only if it is short
// and boring; anything else is replaced, so ids can't be used to inject into logs.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function createHttpApp(options: HttpAppOptions): Express {
  const app = express();
  const metrics = createServiceMetrics(options.service);

  app.disable('x-powered-by');
  app.set('trust proxy', options.trustProxyHops);
  // "simple" = node:querystring: no nested objects/arrays from `?a[b]=c`,
  // which closes a whole class of prototype-pollution and type-confusion bugs.
  app.set('query parser', 'simple');
  app.set('etag', false);

  // Behind the gateway the visitor's address arrives in X-BUKU-Client-IP, which
  // Kong always sets itself (D-084) — for calls the web app makes on a visitor's
  // behalf it is the visitor, not the web server. It becomes req.ip, which rate
  // limits and audit entries use.
  if (options.trustProxyHops > 0) {
    app.use((req, _res, next) => {
      const ip = req.headers['x-buku-client-ip'];
      if (typeof ip === 'string' && isIP(ip)) req.headers['x-forwarded-for'] = ip;
      next();
    });
  }

  app.use(
    pinoHttp({
      logger: options.logger,
      genReqId(req, res) {
        const incoming = req.headers['x-request-id'];
        const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-ID', id);
        return id;
      },
      autoLogging: {
        ignore: (req) => req.url === '/health' || req.url === '/ready' || req.url === '/metrics',
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Log method + path only: query strings can carry tokens or PII.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  // JSON API: no HTML is ever served, so the strictest CSP applies.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
      },
      frameguard: { action: 'deny' },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(metrics.httpMiddleware);

  // ── Operational endpoints (not routed by the gateway) ──
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: options.service, uptimeSeconds: Math.round(process.uptime()) });
  });
  app.get('/ready', async (_req, res) => {
    const report = await options.readiness.evaluate();
    res.status(report.status === 'ready' ? 200 : 503).json({ service: options.service, ...report });
  });
  app.get('/metrics', async (_req, res) => {
    res.setHeader('Content-Type', metrics.registry.contentType);
    res.send(await metrics.registry.metrics());
  });

  // A ceiling per address on every route, in each process (D-086): the gateway's
  // limits are the real ones; this one holds even if a request arrives without it.
  // (express-rate-limit, which code scanning recognises; IPv6 addresses count by /56.)
  const perMinute = options.baselineRequestsPerMinute ?? 3000;
  if (perMinute > 0) {
    app.use(
      rateLimit({
        windowMs: 60_000,
        limit: perMinute,
        standardHeaders: false,
        legacyHeaders: false,
        handler: (req, _res, next) => {
          const info = (req as typeof req & { rateLimit?: RateLimitInfo }).rateLimit;
          const resetAt = info?.resetTime?.getTime() ?? Date.now() + 60_000;
          next(AppError.rateLimited(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000))));
        },
      }),
    );
  }
  app.use(
    express.json({
      limit: options.bodyLimit ?? '100kb',
      strict: true,
      type: 'application/json',
      ...(options.keepRawBody && {
        verify: (req: IncomingMessage, _res: ServerResponse, buf: Buffer) => {
          (req as express.Request).rawBody = buf;
        },
      }),
    }),
  );

  options.routes(app);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
