import { AppError, can, ErrorCodes, uuidv7 } from '@buku/common';
import {
  businessRoleOf,
  recordAudit,
  requireBusinessPermission,
  type Database,
  type Transaction,
} from '@buku/database';
import {
  PUBLIC_PICTURE_CACHE,
  type CleanImage,
  type MediaLinks,
  type ObjectStorage,
  type PhotoType,
  type PictureUploads,
} from '@buku/media';
import { auditCtx, type RequestContext } from '../http/context.js';

/**
 * Everything a business shows as pictures (D-051, D-055):
 *
 *  • gallery photos (the first becomes the cover) and a logo;
 *  • employee photos — optional, the business's choice, and only with the
 *    employee's consent (confirmed by whoever uploads). The employee can
 *    remove their own photo at any time, and it is removed automatically
 *    when they leave the team (event `businesses.member_removed`).
 *
 * All pictures go through `PictureUploads`: originals stay private and are
 * deleted; only the cleaned copy (no GPS or other metadata) is published.
 * Owner or manager (`business.media`) manage them.
 */

const MAX_PHOTOS = 20;

export class PictureService {
  constructor(
    private readonly db: Database,
    private readonly storage: ObjectStorage,
    private readonly uploads: PictureUploads,
    private readonly links: MediaLinks,
  ) {}

  // ── Gallery photos ───────────────────────────────────────────────────────

  async requestPhotoUpload(
    businessId: string,
    userId: string,
    input: { contentType: PhotoType; sizeBytes: number; altText?: string | undefined },
  ) {
    await this.authorize(businessId, userId);
    await this.assertPhotoRoom(businessId);
    return this.uploads.request('business_photo', businessId, input, { altText: input.altText ?? null });
  }

  async completePhotoUpload(businessId: string, uploadId: string, userId: string, ctx: RequestContext) {
    await this.authorize(businessId, userId);
    const { meta, image } = await this.uploads.complete<{ altText: string | null }>(
      'business_photo',
      businessId,
      uploadId,
      'photo',
    );
    await this.assertPhotoRoom(businessId);
    const id = uuidv7();
    await this.publish(`businesses/${businessId}/photos/${id}.webp`, image, async (storageKey) => {
      await this.db.$transaction(async (tx) => {
        const last = await tx.businessPhoto.aggregate({ where: { businessId }, _max: { sortOrder: true } });
        const hasCover = await tx.businessPhoto.count({ where: { businessId, isPrimary: true } });
        await tx.businessPhoto.create({
          data: {
            id,
            businessId,
            storageKey,
            contentType: image.contentType,
            sizeBytes: image.data.length,
            altText: meta.altText,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
            isPrimary: hasCover === 0, // the first photo becomes the cover
            uploadedAt: new Date(),
          },
        });
        await this.audit(tx, userId, 'business.photo_uploaded', 'business_photo', id, ctx);
      });
    });
    return this.listPhotos(businessId);
  }

  async setPrimaryPhoto(businessId: string, photoId: string, userId: string) {
    await this.authorize(businessId, userId);
    const photo = await this.db.businessPhoto.findFirst({ where: { id: photoId, businessId } });
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
    await this.authorize(businessId, userId);
    const photo = await this.db.businessPhoto.findFirst({ where: { id: photoId, businessId } });
    if (!photo) throw AppError.notFound('Photo');
    await this.storage.delete(this.links.mediaBucket, photo.storageKey);
    await this.db.$transaction(async (tx) => {
      await tx.businessPhoto.delete({ where: { id: photo.id } });
      if (photo.isPrimary) {
        const next = await tx.businessPhoto.findFirst({
          where: { businessId },
          orderBy: { sortOrder: 'asc' },
        });
        if (next) await tx.businessPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit(tx, userId, 'business.photo_deleted', 'business_photo', photo.id, ctx);
    });
    return this.listPhotos(businessId);
  }

  /** Public gallery, cover first. */
  async listPhotos(businessId: string) {
    const photos = await this.db.businessPhoto.findMany({
      where: { businessId, uploadedAt: { not: null } },
      orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
    });
    return Promise.all(
      photos.map(async (p) => ({
        id: p.id,
        url: await this.links.publicUrl(p.storageKey),
        altText: p.altText,
        isPrimary: p.isPrimary,
      })),
    );
  }

  // ── Logo ─────────────────────────────────────────────────────────────────

  async requestLogoUpload(
    businessId: string,
    userId: string,
    input: { contentType: PhotoType; sizeBytes: number },
  ) {
    await this.authorize(businessId, userId);
    return this.uploads.request('business_logo', businessId, input, {});
  }

  async completeLogoUpload(businessId: string, uploadId: string, userId: string, ctx: RequestContext) {
    await this.authorize(businessId, userId);
    const { image } = await this.uploads.complete('business_logo', businessId, uploadId, 'logo');
    const previous = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { logoStorageKey: true },
    });
    const key = `businesses/${businessId}/logo/${uuidv7()}.webp`;
    await this.publish(key, image, async (storageKey) => {
      await this.db.$transaction(async (tx) => {
        await tx.business.update({ where: { id: businessId }, data: { logoStorageKey: storageKey } });
        await this.audit(tx, userId, 'business.logo_uploaded', 'business', businessId, ctx);
      });
    });
    if (previous.logoStorageKey) await this.storage.delete(this.links.mediaBucket, previous.logoStorageKey);
    return { logoUrl: await this.links.publicUrl(key) };
  }

  async deleteLogo(businessId: string, userId: string, ctx: RequestContext): Promise<void> {
    await this.authorize(businessId, userId);
    const business = await this.db.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { logoStorageKey: true },
    });
    if (!business.logoStorageKey) return;
    await this.storage.delete(this.links.mediaBucket, business.logoStorageKey);
    await this.db.$transaction(async (tx) => {
      await tx.business.update({ where: { id: businessId }, data: { logoStorageKey: null } });
      await this.audit(tx, userId, 'business.logo_deleted', 'business', businessId, ctx);
    });
  }

  logoUrl(storageKey: string | null): Promise<string | null> {
    return storageKey ? this.links.publicUrl(storageKey) : Promise.resolve(null);
  }

  // ── Employee photos ──────────────────────────────────────────────────────

  async requestStaffPhotoUpload(
    businessId: string,
    staffId: string,
    userId: string,
    input: { contentType: PhotoType; sizeBytes: number; consentConfirmed: true },
  ) {
    await this.authorize(businessId, userId);
    await this.findStaff(businessId, staffId);
    return this.uploads.request('staff_photo', businessId, input, {
      staffId,
      consentConfirmedById: userId,
      consentConfirmedAt: new Date().toISOString(),
    });
  }

  async completeStaffPhotoUpload(
    businessId: string,
    staffId: string,
    uploadId: string,
    userId: string,
    ctx: RequestContext,
  ) {
    await this.authorize(businessId, userId);
    const { meta, image } = await this.uploads.complete<{
      staffId: string;
      consentConfirmedById: string;
      consentConfirmedAt: string;
    }>('staff_photo', businessId, uploadId, 'portrait');
    // The upload was requested for exactly this employee.
    if (meta.staffId !== staffId) throw AppError.notFound('Upload', ErrorCodes.UPLOAD_NOT_FOUND);
    await this.findStaff(businessId, staffId);

    const previous = await this.db.staffPhoto.findUnique({
      where: { staffId_businessId: { staffId, businessId } },
    });
    const key = `businesses/${businessId}/staff/${staffId}/${uuidv7()}.webp`;
    await this.publish(key, image, async (storageKey) => {
      const data = {
        storageKey,
        sizeBytes: image.data.length,
        consentConfirmedById: meta.consentConfirmedById,
        consentConfirmedAt: new Date(meta.consentConfirmedAt),
      };
      await this.db.$transaction(async (tx) => {
        await tx.staffPhoto.upsert({
          where: { staffId_businessId: { staffId, businessId } },
          create: { businessId, staffId, ...data },
          update: data,
        });
        await this.audit(tx, userId, 'business.staff_photo_uploaded', 'staff', staffId, ctx, {
          consentConfirmed: true,
        });
      });
    });
    if (previous) await this.storage.delete(this.links.mediaBucket, previous.storageKey);
    return { staffId, photoUrl: await this.links.publicUrl(key) };
  }

  /** Owner/manager, or the employee themself — their face, their choice. */
  async deleteStaffPhoto(businessId: string, staffId: string, userId: string, ctx: RequestContext) {
    const role = await businessRoleOf(this.db, businessId, userId);
    if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
    const staff = await this.findStaff(businessId, staffId);
    if (!can(role, 'business.media') && staff.userId !== userId) throw AppError.forbidden();
    const removed = await this.removeStaffPhoto(businessId, staffId);
    if (removed) {
      await this.audit(this.db, userId, 'business.staff_photo_deleted', 'staff', staffId, ctx, {
        bySelf: staff.userId === userId,
      });
    }
  }

  /** The employee left the team: their photo goes too. Idempotent. */
  async removePhotosOfMember(businessId: string, userId: string): Promise<number> {
    const staff = await this.db.staff.findMany({ where: { businessId, userId }, select: { id: true } });
    let removed = 0;
    for (const s of staff) if (await this.removeStaffPhoto(businessId, s.id)) removed++;
    return removed;
  }

  /** "Meet the team" on the public profile: active employees, with a photo if the business added one. */
  async team(businessId: string) {
    const staff = await this.db.staff.findMany({
      where: { businessId, isActive: true },
      orderBy: { displayName: 'asc' },
      select: { id: true, displayName: true, photo: { select: { storageKey: true } } },
    });
    return Promise.all(
      staff.map(async (s) => ({
        id: s.id,
        displayName: s.displayName,
        photoUrl: s.photo ? await this.links.publicUrl(s.photo.storageKey) : null,
      })),
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async removeStaffPhoto(businessId: string, staffId: string): Promise<boolean> {
    const photo = await this.db.staffPhoto.findUnique({
      where: { staffId_businessId: { staffId, businessId } },
    });
    if (!photo) return false;
    // File first: if the row delete then fails, a retry finds the row and tries again.
    await this.storage.delete(this.links.mediaBucket, photo.storageKey);
    await this.db.staffPhoto.deleteMany({ where: { id: photo.id } });
    return true;
  }

  /** Store a cleaned picture, then record it; if recording fails, the file is removed again. */
  private async publish(key: string, image: CleanImage, record: (key: string) => Promise<void>) {
    await this.storage.put(this.links.mediaBucket, key, image.data, image.contentType, PUBLIC_PICTURE_CACHE);
    try {
      await record(key);
    } catch (err) {
      await this.storage.delete(this.links.mediaBucket, key);
      throw err;
    }
  }

  private async findStaff(businessId: string, staffId: string) {
    const staff = await this.db.staff.findFirst({
      where: { id: staffId, businessId },
      select: { id: true, userId: true },
    });
    if (!staff) throw AppError.notFound('Staff member');
    return staff;
  }

  private async assertPhotoRoom(businessId: string) {
    const count = await this.db.businessPhoto.count({ where: { businessId } });
    if (count >= MAX_PHOTOS) {
      throw new AppError(`A business can have at most ${MAX_PHOTOS} photos`, ErrorCodes.LIMIT_REACHED, 409);
    }
  }

  /** `business.media` in a business that is not suspended. */
  private async authorize(businessId: string, userId: string) {
    await requireBusinessPermission(this.db, businessId, userId, 'business.media');
    const b = await this.db.business.findFirst({ where: { id: businessId }, select: { status: true } });
    if (b?.status === 'suspended') {
      throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
    }
  }

  private audit(
    db: Database | Transaction,
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    ctx: RequestContext,
    newValues?: Record<string, string | boolean>,
  ) {
    return recordAudit(db, {
      userId,
      action,
      resourceType,
      resourceId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}
