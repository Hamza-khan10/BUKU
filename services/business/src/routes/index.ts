import {
  AppError,
  authenticate,
  rateLimit,
  requireActor,
  requireRole,
  sendCreated,
  sendSuccess,
  validated,
  ErrorCodes,
  type JwtVerifier,
  type RevocationStore,
} from '@buku/common';
import { Router, type Express } from 'express';
import { requireBusinessPermissionOnShard, type DataPlane } from '@buku/database';
import type { Redis } from 'ioredis';
import type { AdminService } from '../businesses/admin-service.js';
import type { BusinessService } from '../businesses/business-service.js';
import type { CategoryService } from '../categories/category-service.js';
import type { LegalService } from '../legal/legal-service.js';
import type { DocumentService } from '../media/document-service.js';
import type { PictureService } from '../media/picture-service.js';
import { verificationChecklist } from '../verification/checklist.js';
import { requestContext } from '../http/context.js';
import {
  CategorySuggestionBody,
  AdminListQuery,
  CreateBusinessBody,
  DocumentParams,
  DocumentUploadBody,
  ExportBody,
  LegalProfileBody,
  PhotoParams,
  PhotoUploadBody,
  PictureUploadBody,
  StaffParams,
  StaffPhotoUploadBody,
  StaffUploadParams,
  UploadParams,
  ReviewDocumentBody,
  IdOrSlugParams,
  IdParams,
  RowIdParams,
  ReasonBody,
  ReportBody,
  ReportListQuery,
  ResolveReportBody,
  SetHoursBody,
  UpdateBusinessBody,
} from './schemas.js';

export interface RouteDeps {
  businesses: BusinessService;
  categories: CategoryService;
  legal: LegalService;
  documents: DocumentService;
  pictures: PictureService;
  admin: AdminService;
  plane: DataPlane;
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
  /** Adding kinds of business to the shared list: a few a day per person is plenty. */
  const suggestLimit = rateLimit({
    keyPrefix: 'rl:biz:category',
    points: 10,
    durationSeconds: 86_400,
    redis: deps.redis,
  });
  /** The team's own views read several tables and sign picture links: generous, but bounded. */
  const readLimit = rateLimit({
    keyPrefix: 'rl:biz:read',
    points: 300,
    durationSeconds: 60,
    redis: deps.redis,
  });

  // ── Owner & team ─────────────────────────────────────────────────────────
  const r = Router();

  /** The business in the URL, by its public ID (DB-042): unknown is "not found". */
  const businessOf = async (publicId: string) => {
    const id = await deps.plane.idOfPublic('business', publicId);
    if (id === null) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    return id;
  };

  /**
   * What the team sees of its business: like the public profile, the logo as a link and the
   * gallery, never the storage key behind them (links depend on storage settings).
   */
  const withPictures = async <B extends { id: string; logoStorageKey: string | null }>({
    logoStorageKey,
    ...business
  }: B) => {
    const [logoUrl, photos] = await Promise.all([
      deps.pictures.logoUrl(logoStorageKey),
      deps.pictures.listPhotos(await businessOf(business.id)),
    ]);
    return { ...business, logoUrl, photos };
  };

  r.post(
    '/',
    auth,
    createLimit,
    validated({ body: CreateBusinessBody }, async ({ body }, req, res) => {
      const actor = requireActor(req);
      // Employee accounts (platform role `staff`) exist only inside the business that made them.
      if (actor.role === 'staff') throw AppError.forbidden('Employee accounts cannot register a business');
      sendCreated(res, await withPictures(await deps.businesses.create(actor, body, requestContext(req))));
    }),
  );

  // A kind of business BUKU doesn't list yet (D-098): checked, never a copy, reviewed later.
  r.post(
    '/category-suggestions',
    auth,
    suggestLimit,
    validated({ body: CategorySuggestionBody }, async ({ body }, req, res) => {
      const actor = requireActor(req);
      if (actor.role === 'staff') throw AppError.forbidden('Employee accounts cannot add kinds of business');
      const result = await deps.categories.suggest(actor, body, requestContext(req));
      if (result.existing) sendSuccess(res, result);
      else sendCreated(res, result);
    }),
  );

  r.get('/mine', auth, readLimit, async (req, res) => {
    const mine = await deps.businesses.listMine(requireActor(req));
    sendSuccess(res, await Promise.all(mine.map(withPictures)));
  });

  r.get(
    '/:id/manage',
    auth,
    readLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await withPictures(await deps.businesses.getManaged(await businessOf(params.id), requireActor(req))),
      );
    }),
  );

  r.patch(
    '/:id',
    auth,
    writeLimit,
    validated({ params: IdParams, body: UpdateBusinessBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await withPictures(
          await deps.businesses.update(
            await businessOf(params.id),
            requireActor(req),
            body,
            requestContext(req),
          ),
        ),
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
        await withPictures(
          await deps.businesses.setHours(
            await businessOf(params.id),
            requireActor(req),
            body.hours,
            requestContext(req),
          ),
        ),
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
        await deps.businesses.report(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
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
      const id = await businessOf(params.id);
      const actor = requireActor(req);
      sendSuccess(
        res,
        await deps.plane.inBusiness(id, async (tx) => {
          await requireBusinessPermissionOnShard(tx, id, actor, 'business.view_private');
          return verificationChecklist(tx, deps.plane.directory, id);
        }),
      );
    }),
  );

  r.get(
    '/:id/legal-profile',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.legal.getOwn(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.put(
    '/:id/legal-profile',
    auth,
    writeLimit,
    validated({ params: IdParams, body: LegalProfileBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.legal.upsert(await businessOf(params.id), requireActor(req), body, requestContext(req)),
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
        await deps.documents.requestDocumentUpload(
          await businessOf(params.id),
          requireActor(req),
          body,
          requestContext(req),
        ),
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
        await deps.documents.completeDocumentUpload(
          await businessOf(params.id),
          params.documentId,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  r.get(
    '/:id/documents',
    auth,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(res, await deps.documents.listDocuments(await businessOf(params.id), requireActor(req)));
    }),
  );
  r.delete(
    '/:id/documents/:documentId',
    auth,
    writeLimit,
    validated({ params: DocumentParams }, async ({ params }, req, res) => {
      await deps.documents.deleteDocument(
        await businessOf(params.id),
        params.documentId,
        requireActor(req),
        requestContext(req),
      );
      res.status(204).end();
    }),
  );

  // ── Pictures: gallery, logo, employee photos (cleaned before publishing) ──
  r.post(
    '/:id/photos/uploads',
    auth,
    uploadLimit,
    validated({ params: IdParams, body: PhotoUploadBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.pictures.requestPhotoUpload(await businessOf(params.id), requireActor(req), body),
      );
    }),
  );
  r.post(
    '/:id/photos/uploads/:uploadId/complete',
    auth,
    writeLimit,
    validated({ params: UploadParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.pictures.completePhotoUpload(
          await businessOf(params.id),
          params.uploadId,
          requireActor(req),
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
      sendSuccess(
        res,
        await deps.pictures.setPrimaryPhoto(await businessOf(params.id), params.photoId, requireActor(req)),
      );
    }),
  );
  r.delete(
    '/:id/photos/:photoId',
    auth,
    writeLimit,
    validated({ params: PhotoParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.pictures.deletePhoto(
          await businessOf(params.id),
          params.photoId,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );

  r.post(
    '/:id/logo/uploads',
    auth,
    uploadLimit,
    validated({ params: IdParams, body: PictureUploadBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.pictures.requestLogoUpload(await businessOf(params.id), requireActor(req), body),
      );
    }),
  );
  r.post(
    '/:id/logo/uploads/:uploadId/complete',
    auth,
    writeLimit,
    validated({ params: UploadParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.pictures.completeLogoUpload(
          await businessOf(params.id),
          params.uploadId,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/logo',
    auth,
    writeLimit,
    validated({ params: IdParams }, async ({ params }, req, res) => {
      await deps.pictures.deleteLogo(await businessOf(params.id), requireActor(req), requestContext(req));
      res.status(204).end();
    }),
  );

  r.post(
    '/:id/staff/:staffId/photo/uploads',
    auth,
    uploadLimit,
    validated({ params: StaffParams, body: StaffPhotoUploadBody }, async ({ params, body }, req, res) => {
      sendCreated(
        res,
        await deps.pictures.requestStaffPhotoUpload(
          await businessOf(params.id),
          params.staffId,
          requireActor(req),
          body,
        ),
      );
    }),
  );
  r.post(
    '/:id/staff/:staffId/photo/uploads/:uploadId/complete',
    auth,
    writeLimit,
    validated({ params: StaffUploadParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.pictures.completeStaffPhotoUpload(
          await businessOf(params.id),
          params.staffId,
          params.uploadId,
          requireActor(req),
          requestContext(req),
        ),
      );
    }),
  );
  r.delete(
    '/:id/staff/:staffId/photo',
    auth,
    writeLimit,
    validated({ params: StaffParams }, async ({ params }, req, res) => {
      await deps.pictures.deleteStaffPhoto(
        await businessOf(params.id),
        params.staffId,
        requireActor(req),
        requestContext(req),
      );
      res.status(204).end();
    }),
  );

  // Public profile — registered LAST so /mine etc. are matched first.
  r.get(
    '/:idOrSlug',
    validated({ params: IdOrSlugParams }, async ({ params }, _req, res) => {
      const { logoStorageKey, internalId, ...business } = await deps.businesses.getPublic(params.idOrSlug);
      const [logoUrl, photos, team] = await Promise.all([
        deps.pictures.logoUrl(logoStorageKey),
        deps.pictures.listPhotos(internalId),
        deps.pictures.team(internalId),
      ]);
      res.setHeader('Cache-Control', 'public, max-age=60');
      sendSuccess(res, { ...business, logoUrl, photos, team });
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
      sendSuccess(
        res,
        await deps.admin.verify(await businessOf(params.id), requireActor(req).id, requestContext(req)),
      );
    }),
  );
  admin.post(
    '/businesses/:id/reject',
    validated({ params: IdParams, body: ReasonBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.reject(
          await businessOf(params.id),
          requireActor(req).id,
          body.reason,
          requestContext(req),
        ),
      );
    }),
  );
  admin.post(
    '/businesses/:id/suspend',
    validated({ params: IdParams, body: ReasonBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.suspend(
          await businessOf(params.id),
          requireActor(req).id,
          body.reason,
          requestContext(req),
        ),
      );
    }),
  );
  admin.post(
    '/businesses/:id/reinstate',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.reinstate(await businessOf(params.id), requireActor(req).id, requestContext(req)),
      );
    }),
  );
  admin.get(
    '/businesses/:id/review',
    validated({ params: IdParams }, async ({ params }, req, res) => {
      const adminId = requireActor(req).id;
      const id = await businessOf(params.id);
      const ctx = requestContext(req);
      const [checklist, legal, documents] = await Promise.all([
        deps.plane.inBusiness(id, (tx) => verificationChecklist(tx, deps.plane.directory, id)),
        deps.legal.getForAdmin(id, adminId, ctx),
        deps.documents.documentsForAdmin(id, adminId, ctx),
      ]);
      sendSuccess(res, { checklist, legal, documents });
    }),
  );
  admin.post(
    '/business-documents/:id/review',
    validated({ params: RowIdParams, body: ReviewDocumentBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.documents.reviewDocument(
          params.id,
          requireActor(req).id,
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
        requireActor(req).id,
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
    validated({ params: RowIdParams, body: ResolveReportBody }, async ({ params, body }, req, res) => {
      sendSuccess(
        res,
        await deps.admin.resolveReport(params.id, requireActor(req).id, body.status, requestContext(req)),
      );
    }),
  );

  app.use('/v1/admin', admin);
}
