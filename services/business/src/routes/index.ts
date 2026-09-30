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
import type { Database } from '@buku/database';
import { requireBusinessPermission } from '@buku/database';
import type { Redis } from 'ioredis';
import type { AdminService } from '../businesses/admin-service.js';
import type { BusinessService } from '../businesses/business-service.js';
import type { LegalService } from '../legal/legal-service.js';
import type { MediaService } from '../media/media-service.js';
import { verificationChecklist } from '../verification/checklist.js';
import { requestContext } from '../http/context.js';
import {
  AdminListQuery,
  CreateBusinessBody,
  DocumentParams,
  DocumentUploadBody,
  ExportBody,
  LegalProfileBody,
  PhotoParams,
  PhotoUploadBody,
  ReviewDocumentBody,
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
  legal: LegalService;
  media: MediaService;
  admin: AdminService;
  db: Database;
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

  // ── Verification checklist, legal details, documents, photos ─────────────
  const uploadLimit = rateLimit({
    keyPrefix: 'rl:biz:upload',
    points: 30,
    durationSeconds: 3600,
    redis: deps.redis,
  });

  r.get(
    '/:id/verification',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      await requireBusinessPermission(deps.db, params.id, requireAuth(req).userId, 'business.view_private');
      sendSuccess(res, await verificationChecklist(deps.db, params.id));
    }),
  );

  r.get(
    '/:id/legal-profile',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.legal.getOwn(params.id, requireAuth(req).userId));
    }),
  );
  r.put(
    '/:id/legal-profile',
    auth,
    writeLimit,
    validated({ params: IdParams, body: LegalProfileBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.legal.upsert(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );

  r.post(
    '/:id/documents/uploads',
    auth,
    uploadLimit,
    validated({ params: IdParams, body: DocumentUploadBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.media.requestDocumentUpload(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.post(
    '/:id/documents/:documentId/complete',
    auth,
    writeLimit,
    validated({ params: DocumentParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.media.completeDocumentUpload(
          params.id,
          params.documentId,
          requireAuth(req).userId,
          requestContext(req),
        ),
      );
    }),
  );
  r.get(
    '/:id/documents',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.media.listDocuments(params.id, requireAuth(req).userId));
    }),
  );
  r.delete(
    '/:id/documents/:documentId',
    auth,
    writeLimit,
    validated({ params: DocumentParams }, async ({ params }, req, res) => {
      await deps.media.deleteDocument(
        params.id,
        params.documentId,
        requireAuth(req).userId,
        requestContext(req),
      );
      res.status(204).end();
    }),
  );

  r.post(
    '/:id/photos/uploads',
    auth,
    uploadLimit,
    validated({ params: IdParams, body: PhotoUploadBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.media.requestPhotoUpload(params.id, requireAuth(req).userId, body, requestContext(req)),
      );
    }),
  );
  r.post(
    '/:id/photos/:photoId/complete',
    auth,
    writeLimit,
    validated({ params: PhotoParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.media.completePhotoUpload(
          params.id,
          params.photoId,
          requireAuth(req).userId,
          requestContext(req),
        ),
      );
    }),
  );
  r.post(
    '/:id/photos/:photoId/primary',
    auth,
    writeLimit,
    validated({ params: PhotoParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.media.setPrimaryPhoto(params.id, params.photoId, requireAuth(req).userId));
    }),
  );
  r.delete(
    '/:id/photos/:photoId',
    auth,
    writeLimit,
    validated({ params: PhotoParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.media.deletePhoto(params.id, params.photoId, requireAuth(req).userId, requestContext(req)),
      );
    }),
  );

  // Public profile — registered LAST so /mine etc. are matched first.
  r.get(
    '/:idOrSlug',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      const business = await deps.businesses.getPublic(params.idOrSlug);
      res.setHeader('Cache-Control', 'public, max-age=60');
      sendSuccess(res, { ...business, photos: await deps.media.listPhotos(business.id) });
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
    '/businesses/:id/review',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      const { userId } = requireAuth(req);
      const ctx = requestContext(req);
      const [checklist, legal, documents] = await Promise.all([
        verificationChecklist(deps.db, params.id),
        deps.legal.getForAdmin(params.id, userId, ctx),
        deps.media.documentsForAdmin(params.id, userId, ctx),
      ]);
      sendSuccess(res, { checklist, legal, documents });
    }),
  );
  admin.post(
    '/business-documents/:id/review',
    validated({ params: IdParams, body: ReviewDocumentBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.media.reviewDocument(
          params.id,
          requireAuth(req).userId,
          body.decision,
          body.note,
          requestContext(req),
        ),
      );
    }),
  );
  admin.post(
    '/business-exports',
    rateLimit({ keyPrefix: 'rl:biz:export', points: 10, durationSeconds: 86_400, redis: deps.redis }),
    validated({ body: ExportBody }, async ({ body }, req, res) => {
      const data = await deps.admin.exportCountry(
        body.country,
        { reference: body.reference, legalBasis: body.legalBasis },
        requireAuth(req).userId,
        requestContext(req),
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="buku-businesses-${body.country}-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      sendSuccess(res, data);
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
