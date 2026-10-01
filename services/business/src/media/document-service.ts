import { AppError, ErrorCodes, uuidv7 } from '@buku/common';
import { recordAudit, requireBusinessPermission, type Database, type DocumentType } from '@buku/database';
import { auditCtx, type RequestContext } from '../http/context.js';
import {
  matchesSignature,
  MAX_DOCUMENT_BYTES,
  SIGNATURE_BYTES,
  type AllowedContentType,
  type ObjectStorage,
} from '@buku/media';

/**
 * Verification documents (PRIVATE), uploaded directly to object storage in
 * three steps (pictures have their own pipeline: picture-service.ts):
 *
 *   1. request   → we create a row and return a presigned PUT link valid for
 *                  10 minutes, for exactly this key, type and size
 *   2. upload    → the client PUTs the file straight to storage
 *   3. complete  → we check what actually arrived (exists, exact size, real
 *                  file signature). Anything wrong is deleted and refused.
 *
 * Owner only ('business.legal'); viewed by admins through 5-minute links.
 * Documents are kept exactly as uploaded: they are evidence.
 */

const UPLOAD_LINK_SECONDS = 10 * 60;
const ADMIN_VIEW_LINK_SECONDS = 5 * 60;
const MAX_DOCUMENTS = 20;
/** Unfinished uploads older than this don't count toward limits. */
const STALE_UPLOAD_MS = 60 * 60 * 1000;

export interface DocumentSettings {
  documentsBucket: string;
}

export class DocumentService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly settings: DocumentSettings,
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

  // ── helpers ──────────────────────────────────────────────────────────────

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
