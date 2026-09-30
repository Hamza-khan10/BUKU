import { AppError, ErrorCodes, uuidv7 } from '@buku/common';
import { recordAudit, requireBusinessPermission, type Database, type DocumentType } from '@buku/database';
import { auditCtx, type RequestContext } from '../http/context.js';
import {
  matchesSignature,
  MAX_DOCUMENT_BYTES,
  MAX_PHOTO_BYTES,
  SIGNATURE_BYTES,
  type AllowedContentType,
} from '../storage/file-types.js';
import type { ObjectStorage } from '../storage/object-storage.js';

/**
 * Verification documents (PRIVATE) and profile photos (PUBLIC), uploaded
 * directly to object storage in three steps:
 *
 *   1. request   → we create a row and return a presigned PUT link valid for
 *                  10 minutes, for exactly this key, type and size
 *   2. upload    → the client PUTs the file straight to storage
 *   3. complete  → we check what actually arrived (exists, exact size, real
 *                  file signature). Anything wrong is deleted and refused.
 *
 * Documents: owner only ('business.legal'); viewed by admins through 5-minute
 * links. Photos: owner or manager ('business.media'); shown on the profile.
 */

const UPLOAD_LINK_SECONDS = 10 * 60;
const ADMIN_VIEW_LINK_SECONDS = 5 * 60;
const PUBLIC_PHOTO_LINK_SECONDS = 60 * 60;
const MAX_DOCUMENTS = 20;
const MAX_PHOTOS = 20;
/** Unfinished uploads older than this don't count toward limits. */
const STALE_UPLOAD_MS = 60 * 60 * 1000;

export interface MediaSettings {
  documentsBucket: string;
  mediaBucket: string;
  /** If set (CDN / public bucket in production), photo URLs are permanent; else presigned. */
  mediaPublicBaseUrl?: string | undefined;
}

export class MediaService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly settings: MediaSettings,
  ) {}

  // ── Documents ────────────────────────────────────────────────────────────

  async requestDocumentUpload(
    businessId: string,
    userId: string,
    input: { type: DocumentType; contentType: AllowedContentType; sizeBytes: number },
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    await this.assertNotSuspended(businessId);
    if (input.sizeBytes > MAX_DOCUMENT_BYTES) throw tooLarge(MAX_DOCUMENT_BYTES);
    const count = await this.db.businessDocument.count({ where: { businessId, ...liveUploads() } });
    if (count >= MAX_DOCUMENTS) throw limit(`A business can have at most ${MAX_DOCUMENTS} documents`);

    const id = uuidv7();
    const storageKey = `businesses/${businessId}/documents/${id}`;
    await this.db.businessDocument.create({
      data: {
        id,
        businessId,
        type: input.type,
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      },
    });
    const url = await this.storage.presignPut(
      this.settings.documentsBucket,
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_LINK_SECONDS,
    );
    await recordAudit(this.db, {
      userId,
      action: 'business.document_upload_requested',
      resourceType: 'business_document',
      resourceId: id,
      newValues: { type: input.type },
      ...auditCtx(ctx),
    });
    return { documentId: id, upload: uploadInstructions(url, input.contentType, input.sizeBytes) };
  }

  async completeDocumentUpload(businessId: string, documentId: string, userId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    const doc = await this.db.businessDocument.findFirst({ where: { id: documentId, businessId } });
    if (!doc) throw AppError.notFound('Document');
    if (doc.status !== 'awaiting_upload') return this.documentView(doc);
    await this.inspect(
      this.settings.documentsBucket,
      doc.storageKey,
      doc.contentType as AllowedContentType,
      doc.sizeBytes,
      async () => {
        await this.db.businessDocument.delete({ where: { id: doc.id } });
      },
    );
    const saved = await this.db.businessDocument.update({
      where: { id: doc.id },
      data: { uploadedAt: new Date(), status: 'pending' },
    });
    await recordAudit(this.db, {
      userId,
      action: 'business.document_uploaded',
      resourceType: 'business_document',
      resourceId: doc.id,
      ...auditCtx(ctx),
    });
    return this.documentView(saved);
  }

  async listDocuments(businessId: string, userId: string) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    const docs = await this.db.businessDocument.findMany({
      where: { businessId, status: { not: 'awaiting_upload' } },
      orderBy: { createdAt: 'desc' },
    });
    return docs.map((d) => this.documentView(d));
  }

  /** Approved documents are part of the verification record and can't be removed. */
  async deleteDocument(businessId: string, documentId: string, userId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.legal');
    const doc = await this.db.businessDocument.findFirst({ where: { id: documentId, businessId } });
    if (!doc) throw AppError.notFound('Document');
    if (doc.status === 'approved')
      throw AppError.conflict('Approved documents are kept as part of verification');
    await this.storage.delete(this.settings.documentsBucket, doc.storageKey);
    await this.db.businessDocument.delete({ where: { id: doc.id } });
    await recordAudit(this.db, {
      userId,
      action: 'business.document_deleted',
      resourceType: 'business_document',
      resourceId: doc.id,
      ...auditCtx(ctx),
    });
  }

  /** Admin: documents with 5-minute view links. Access is audited. */
  async documentsForAdmin(businessId: string, adminId: string, ctx: RequestContext) {
    const docs = await this.db.businessDocument.findMany({
      where: { businessId, status: { not: 'awaiting_upload' } },
      orderBy: { createdAt: 'desc' },
    });
    await recordAudit(this.db, {
      userId: adminId,
      action: 'admin.documents_viewed',
      resourceType: 'business',
      resourceId: businessId,
      ...auditCtx(ctx),
    });
    return Promise.all(
      docs.map(async (d) => ({
        ...this.documentView(d),
        viewUrl: await this.storage.presignGet(
          this.settings.documentsBucket,
          d.storageKey,
          ADMIN_VIEW_LINK_SECONDS,
        ),
        viewUrlExpiresInSeconds: ADMIN_VIEW_LINK_SECONDS,
      })),
    );
  }

  async reviewDocument(
    documentId: string,
    adminId: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
    ctx: RequestContext,
  ) {
    const { count } = await this.db.businessDocument.updateMany({
      where: { id: documentId, status: { in: ['pending', 'approved', 'rejected'] } },
      data: { status: decision, reviewedById: adminId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    if (count === 0) throw AppError.notFound('Uploaded document');
    await recordAudit(this.db, {
      userId: adminId,
      action: `admin.document_${decision}`,
      resourceType: 'business_document',
      resourceId: documentId,
      ...auditCtx(ctx),
    });
    return { id: documentId, status: decision };
  }

  // ── Photos ───────────────────────────────────────────────────────────────

  async requestPhotoUpload(
    businessId: string,
    userId: string,
    input: { contentType: AllowedContentType; sizeBytes: number; altText?: string | undefined },
    ctx: RequestContext,
  ) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.media');
    await this.assertNotSuspended(businessId);
    if (input.sizeBytes > MAX_PHOTO_BYTES) throw tooLarge(MAX_PHOTO_BYTES);
    const count = await this.db.businessPhoto.count({ where: { businessId, ...livePhotos() } });
    if (count >= MAX_PHOTOS) throw limit(`A business can have at most ${MAX_PHOTOS} photos`);

    const id = uuidv7();
    const storageKey = `businesses/${businessId}/photos/${id}`;
    const last = await this.db.businessPhoto.aggregate({ where: { businessId }, _max: { sortOrder: true } });
    await this.db.businessPhoto.create({
      data: {
        id,
        businessId,
        storageKey,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        altText: input.altText ?? null,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    const url = await this.storage.presignPut(
      this.settings.mediaBucket,
      storageKey,
      input.contentType,
      input.sizeBytes,
      UPLOAD_LINK_SECONDS,
    );
    await recordAudit(this.db, {
      userId,
      action: 'business.photo_upload_requested',
      resourceType: 'business_photo',
      resourceId: id,
      ...auditCtx(ctx),
    });
    return { photoId: id, upload: uploadInstructions(url, input.contentType, input.sizeBytes) };
  }

  async completePhotoUpload(businessId: string, photoId: string, userId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.media');
    const photo = await this.db.businessPhoto.findFirst({ where: { id: photoId, businessId } });
    if (!photo) throw AppError.notFound('Photo');
    if (!photo.uploadedAt) {
      await this.inspect(
        this.settings.mediaBucket,
        photo.storageKey,
        photo.contentType as AllowedContentType,
        photo.sizeBytes,
        async () => {
          await this.db.businessPhoto.delete({ where: { id: photo.id } });
        },
      );
      const hasPrimary = await this.db.businessPhoto.count({ where: { businessId, isPrimary: true } });
      await this.db.businessPhoto.update({
        where: { id: photo.id },
        data: { uploadedAt: new Date(), ...(hasPrimary === 0 && { isPrimary: true }) }, // first photo becomes the cover
      });
      await recordAudit(this.db, {
        userId,
        action: 'business.photo_uploaded',
        resourceType: 'business_photo',
        resourceId: photo.id,
        ...auditCtx(ctx),
      });
    }
    return this.listPhotos(businessId);
  }

  async setPrimaryPhoto(businessId: string, photoId: string, userId: string) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.media');
    const photo = await this.db.businessPhoto.findFirst({
      where: { id: photoId, businessId, uploadedAt: { not: null } },
    });
    if (!photo) throw AppError.notFound('Photo');
    await this.db.$transaction([
      this.db.businessPhoto.updateMany({
        where: { businessId, isPrimary: true },
        data: { isPrimary: false },
      }),
      this.db.businessPhoto.update({ where: { id: photoId }, data: { isPrimary: true } }),
    ]);
    return this.listPhotos(businessId);
  }

  async deletePhoto(businessId: string, photoId: string, userId: string, ctx: RequestContext) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.media');
    const photo = await this.db.businessPhoto.findFirst({ where: { id: photoId, businessId } });
    if (!photo) throw AppError.notFound('Photo');
    await this.storage.delete(this.settings.mediaBucket, photo.storageKey);
    await this.db.businessPhoto.delete({ where: { id: photo.id } });
    if (photo.isPrimary) {
      const next = await this.db.businessPhoto.findFirst({
        where: { businessId, uploadedAt: { not: null } },
        orderBy: { sortOrder: 'asc' },
      });
      if (next) await this.db.businessPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
    }
    await recordAudit(this.db, {
      userId,
      action: 'business.photo_deleted',
      resourceType: 'business_photo',
      resourceId: photo.id,
      ...auditCtx(ctx),
    });
    return this.listPhotos(businessId);
  }

  /** Public photo list (uploaded + verified only), cover first. */
  async listPhotos(businessId: string) {
    const photos = await this.db.businessPhoto.findMany({
      where: { businessId, uploadedAt: { not: null } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        url: await this.photoUrl(p.storageKey),
        altText: p.altText,
        isPrimary: p.isPrimary,
      })),
    );
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private photoUrl(key: string): Promise<string> {
    const base = this.settings.mediaPublicBaseUrl;
    return base
      ? Promise.resolve(`${base.replace(/\/$/, '')}/${key}`)
      : this.storage.presignGet(this.settings.mediaBucket, key, PUBLIC_PHOTO_LINK_SECONDS);
  }

  /** Verify an upload landed as declared; otherwise delete it (and its row) and refuse. */
  private async inspect(
    bucket: string,
    key: string,
    contentType: AllowedContentType,
    sizeBytes: number,
    discardRow: () => Promise<void>,
  ) {
    const head = await this.storage.head(bucket, key);
    if (!head) throw new AppError('The file has not been uploaded yet', ErrorCodes.UPLOAD_NOT_FOUND, 409);
    const discard = async () => {
      await this.storage.delete(bucket, key);
      await discardRow();
    };
    if (head.sizeBytes !== sizeBytes) {
      await discard();
      throw new AppError(
        'The uploaded file does not match the declared size',
        ErrorCodes.FILE_TYPE_NOT_ALLOWED,
        400,
      );
    }
    const prefix = await this.storage.readPrefix(bucket, key, SIGNATURE_BYTES);
    if (!matchesSignature(contentType, prefix)) {
      await discard();
      throw new AppError(`The file is not a valid ${contentType}`, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 400);
    }
  }

  private async assertNotSuspended(businessId: string) {
    const b = await this.db.business.findFirst({
      where: { id: businessId, deletedAt: null },
      select: { status: true },
    });
    if (b?.status === 'suspended')
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
  }

  private documentView(d: {
    id: string;
    type: DocumentType;
    status: string;
    contentType: string;
    sizeBytes: number;
    reviewNote: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
  }) {
    return {
      id: d.id,
      type: d.type,
      status: d.status,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      reviewNote: d.reviewNote,
      uploadedAt: d.createdAt.toISOString(),
      reviewedAt: d.reviewedAt?.toISOString() ?? null,
    };
  }
}

const liveUploads = () => ({
  OR: [
    { status: { not: 'awaiting_upload' as const } },
    { createdAt: { gt: new Date(Date.now() - STALE_UPLOAD_MS) } },
  ],
});
const livePhotos = () => ({
  OR: [{ uploadedAt: { not: null } }, { createdAt: { gt: new Date(Date.now() - STALE_UPLOAD_MS) } }],
});

function uploadInstructions(url: string, contentType: string, sizeBytes: number) {
  return {
    method: 'PUT' as const,
    url,
    // The client must send exactly these headers (they are part of the signature).
    headers: { 'Content-Type': contentType, 'Content-Length': String(sizeBytes) },
    expiresAt: new Date(Date.now() + UPLOAD_LINK_SECONDS * 1000).toISOString(),
  };
}

const tooLarge = (max: number) =>
  new AppError(`File is larger than ${Math.round(max / 1024 / 1024)} MB`, ErrorCodes.FILE_TOO_LARGE, 413);
const limit = (message: string) => new AppError(message, ErrorCodes.LIMIT_REACHED, 409);
