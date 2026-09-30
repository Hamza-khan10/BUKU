import {
  authenticate,
  rateLimit,
  requireAuth,
  requireRole,
  sendCreated,
  sendSuccess,
  validated,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import type { Redis } from 'ioredis';
import type { AdminService } from '../businesses/admin-service.js';
import type { BusinessService } from '../businesses/business-service.js';
import { requestContext } from '../http/context.js';
import {
  AdminListQuery,
  CreateBusinessBody,
  IdOrSlugParams,
  IdParams,
  ReasonBody,
  ReportBody,
  ReportListQuery,
  ResolveReportBody,
  SetHoursBody,
  UpdateBusinessBody,
} from './schemas.js';

export interface RouteDeps {
  businesses: BusinessService;
  admin: AdminService;
  verifier: JwtVerifier;
  revocations: RevocationStore;
  redis: Redis;
}

export function registerRoutes(app: Express, deps: RouteDeps): void {
  const auth = authenticate({ verifier: deps.verifier, isRevoked: (t) => deps.revocations.isRevoked(t) });
  const createLimit = rateLimit({
    keyPrefix: 'rl:biz:create',
    points: 5,
    durationSeconds: 3600,
    redis: deps.redis,
  });
  const writeLimit = rateLimit({
    keyPrefix: 'rl:biz:write',
    points: 60,
    durationSeconds: 60,
    redis: deps.redis,
  });
  const reportLimit = rateLimit({
    keyPrefix: 'rl:biz:report',
    points: 10,
    durationSeconds: 3600,
    redis: deps.redis,
  });

  // ── Owner & team ─────────────────────────────────────────────────────────
  const r = Router();

  r.post(
    '/',
    auth,
    createLimit,
    validated({ body: CreateBusinessBody }, async ({ body }, req, res) => {
      sendCreated(res, await deps.businesses.create(requireAuth(req).userId, body, requestContext(req)));
    }),
  );

  r.get('/mine', auth, async (req, res) => {
    sendSuccess(res, await deps.businesses.listMine(requireAuth(req).userId));
  });

  r.get(
    '/:id/manage',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.businesses.getManaged(params.id, requireAuth(req).userId));
    }),
  );

  r.patch(
    '/:id',
    auth,
    writeLimit,
    validated({ params: IdParams, body: UpdateBusinessBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.businesses.update(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );

  r.put(
    '/:id/hours',
    auth,
    writeLimit,
    validated({ params: IdParams, body: SetHoursBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.businesses.setHours(params.id, requireAuth(req).userId, body.hours, requestContext(req)),
      );
    }),
  );

  r.post(
    '/:id/reports',
    auth,
    reportLimit,
    validated({ params: IdParams, body: ReportBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.businesses.report(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );

  // Public profile — registered LAST so /mine etc. are matched first.
  r.get(
    '/:idOrSlug',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      res.setHeader('Cache-Control', 'public, max-age=60');
      sendSuccess(res, await deps.businesses.getPublic(params.idOrSlug));
    }),
  );

  app.use('/v1/businesses', r);

  // ── Platform admin ───────────────────────────────────────────────────────
  const admin = Router();
  admin.use(auth, requireRole('super_admin'), writeLimit);

  admin.get(
    '/businesses',
    validated({ query: AdminListQuery }, async ({ query }, _req, res) => {
      const { items, meta } = await deps.admin.list(query.status, query);
      sendSuccess(res, items, 200, meta);
    }),
  );
  admin.post(
    '/businesses/:id/verify',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.admin.verify(params.id, requireAuth(req).userId, requestContext(req)));
    }),
  );
  admin.post(
    '/businesses/:id/reject',
    validated({ params: IdParams, body: ReasonBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.reject(params.id, requireAuth(req).userId, body.reason, requestContext(req)),
      );
    }),
  );
  admin.post(
    '/businesses/:id/suspend',
    validated({ params: IdParams, body: ReasonBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.suspend(params.id, requireAuth(req).userId, body.reason, requestContext(req)),
      );
    }),
  );
  admin.post(
    '/businesses/:id/reinstate',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.admin.reinstate(params.id, requireAuth(req).userId, requestContext(req)));
    }),
  );
  admin.get(
    '/business-reports',
    validated({ query: ReportListQuery }, async ({ query }, _req, res) => {
      const { items, meta } = await deps.admin.listReports(query.status, query);
      sendSuccess(res, items, 200, meta);
    }),
  );
  admin.post(
    '/business-reports/:id/resolve',
    validated({ params: IdParams, body: ResolveReportBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.resolveReport(params.id, requireAuth(req).userId, body.status, requestContext(req)),
      );
    }),
  );

  app.use('/v1/admin', admin);
}
