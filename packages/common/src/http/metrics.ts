import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { collectDefaultMetrics, Counter, Histogram, Registry } from '@prometheus-io/client';

/**
 * Prometheus metrics. Each service gets its own registry with Node.js runtime
 * metrics (event-loop lag, heap, GC) plus an HTTP latency histogram.
 *
 * /metrics is served on the service port but is NOT routed by the API
 * gateway, so it is only reachable from inside the private network.
 */
export interface ServiceMetrics {
  registry: Registry;
  httpMiddleware: RequestHandler;
}

export function createServiceMetrics(service: string): ServiceMetrics {
  const registry = new Registry();
  registry.setDefaultLabels({ service });
  collectDefaultMetrics({ register: registry });

  const httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route template and status',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const httpMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics' || req.path === '/health' || req.path === '/ready') return next();
    const end = httpDuration.startTimer({ method: req.method });
    res.on('finish', () => {
      // Label with the route TEMPLATE (/v1/appointments/:id), never the raw URL:
      // raw URLs contain ids and would create unbounded metric cardinality.
      const routePath = (req.route as { path?: unknown } | undefined)?.path;
      const route = typeof routePath === 'string' ? `${req.baseUrl}${routePath}` : 'unmatched';
      end({ route, status_code: String(res.statusCode) });
    });
    next();
  };

  securityEvents = new Counter({
    name: 'security_events_total',
    help: 'Security-relevant events, by kind (alerting rules: infrastructure/monitoring)',
    labelNames: ['event'] as const,
    registers: [registry],
  });

  return { registry, httpMiddleware };
}

/**
 * Events worth alerting on (D-082): someone reusing a stolen refresh token, wrong
 * two-step codes, accounts locked, admins without two-step sign-in, forged webhooks.
 * The audit log has the details; this counts them so alerts can fire.
 */
export type SecurityEvent =
  | 'refresh_token_reuse'
  | 'mfa_failed'
  | 'mfa_locked'
  | 'admin_without_mfa'
  | 'member_locked_out'
  | 'webhook_signature_invalid';

let securityEvents: Counter<'event'> | null = null;

export function recordSecurityEvent(event: SecurityEvent): void {
  securityEvents?.inc({ event });
}
