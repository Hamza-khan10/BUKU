import {
  assertBusinessLimitOnShard,
  assertFeature,
  assertWithinLimit,
  businessEntitlementsOnShard,
} from '@buku/billing';
import { AppError, can, ErrorCodes, type Actor } from '@buku/common';
import {
  businessRoleOfActor,
  recordShardAudit,
  requireBusinessPermissionOnShard,
  type BusinessTx,
  type DataPlane,
} from '@buku/database';
import { createEvent, enqueueShardEvent, TOPICS } from '@buku/kafka';
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
 * deleted; only the cleaned copy (no GPS or other metadata) is published, under the business's
 * public ID (DB-042). Owner or manager (`business.media`) manage them. Plan limits are read on the
 * business's shard (D3).
 */

/** Platform safety cap; the business's plan decides the real number. */
const PLATFORM_MAX_PHOTOS = 100;

export class PictureService {
  constructor(
    private readonly plane: DataPlane,
    private readonly storage: ObjectStorage,
    private readonly uploads: PictureUploads,
    private readonly links: MediaLinks,
  ) {}

  // ── Gallery photos ───────────────────────────────────────────────────────

  async requestPhotoUpload(
    businessId: bigint,
    actor: Actor,
    input: { contentType: PhotoType; sizeBytes: number; altText?: string | undefined },
  ) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      await assertPhotoRoom(tx, businessId);
    });
    return this.uploads.request('business_photo', businessId.toString(), input, {
      altText: input.altText ?? null,
    });
  }

  async completePhotoUpload(businessId: bigint, uploadId: string, actor: Actor, ctx: RequestContext) {
    const { plane } = this;
    const { publicId } = await plane.inBusiness(businessId, (tx) => authorize(tx, businessId, actor));
    const { meta, image } = await this.uploads.complete<{ altText: string | null }>(
      'business_photo',
      businessId.toString(),
      uploadId,
      'photo',
    );
    await plane.inBusiness(businessId, (tx) => assertPhotoRoom(tx, businessId));
    const id = plane.id();
    await this.publish(`businesses/${publicId}/photos/${id}.webp`, image, (storageKey) =>
      plane.inBusiness(businessId, async (tx) => {
        await assertBusinessLimitOnShard(tx, businessId, 'photos', () =>
          tx.businessPhoto.count({ where: { businessId } }),
        );
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
        await this.audit(tx, actor.id, 'business.photo_uploaded', 'business_photo', id, ctx);
        await this.announce(tx, businessId, 'photos', ctx);
      }),
    );
    return this.listPhotos(businessId);
  }

  async setPrimaryPhoto(businessId: bigint, photoId: bigint, actor: Actor) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      const photo = await tx.businessPhoto.findFirst({ where: { id: photoId, businessId } });
      if (!photo) throw AppError.notFound('Photo');
      await tx.businessPhoto.updateMany({
        where: { businessId, isPrimary: true },
        data: { isPrimary: false },
      });
      await tx.businessPhoto.update({ where: { id: photoId }, data: { isPrimary: true } });
      await this.announce(tx, businessId, 'photos');
    });
    return this.listPhotos(businessId);
  }

  async deletePhoto(businessId: bigint, photoId: bigint, actor: Actor, ctx: RequestContext) {
    const { plane } = this;
    const photo = await plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      return tx.businessPhoto.findFirst({ where: { id: photoId, businessId } });
    });
    if (!photo) throw AppError.notFound('Photo');
    await this.storage.delete(this.links.mediaBucket, photo.storageKey);
    await plane.inBusiness(businessId, async (tx) => {
      await tx.businessPhoto.deleteMany({ where: { id: photo.id } });
      if (photo.isPrimary) {
        const next = await tx.businessPhoto.findFirst({
          where: { businessId },
          orderBy: { sortOrder: 'asc' },
        });
        if (next) await tx.businessPhoto.update({ where: { id: next.id }, data: { isPrimary: true } });
      }
      await this.audit(tx, actor.id, 'business.photo_deleted', 'business_photo', photo.id, ctx);
      await this.announce(tx, businessId, 'photos', ctx);
    });
    return this.listPhotos(businessId);
  }

  /** Public gallery, cover first. */
  async listPhotos(businessId: bigint) {
    const photos = await this.plane.inBusiness(businessId, (tx) =>
      tx.businessPhoto.findMany({
        where: { businessId, uploadedAt: { not: null } },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      }),
    );
    return Promise.all(
      photos.map(async (p) => ({
        id: p.id.toString(),
        url: await this.links.publicUrl(p.storageKey),
        altText: p.altText,
        isPrimary: p.isPrimary,
      })),
    );
  }

  // ── Logo ─────────────────────────────────────────────────────────────────

  async requestLogoUpload(
    businessId: bigint,
    actor: Actor,
    input: { contentType: PhotoType; sizeBytes: number },
  ) {
    await this.plane.inBusiness(businessId, (tx) => authorize(tx, businessId, actor));
    return this.uploads.request('business_logo', businessId.toString(), input, {});
  }

  async completeLogoUpload(businessId: bigint, uploadId: string, actor: Actor, ctx: RequestContext) {
    const { plane } = this;
    const previous = await plane.inBusiness(businessId, (tx) => authorize(tx, businessId, actor));
    const { image } = await this.uploads.complete('business_logo', businessId.toString(), uploadId, 'logo');
    const key = `businesses/${previous.publicId}/logo/${plane.id()}.webp`;
    await this.publish(key, image, (storageKey) =>
      plane.inBusiness(businessId, async (tx) => {
        await tx.business.update({ where: { id: businessId }, data: { logoStorageKey: storageKey } });
        await this.audit(tx, actor.id, 'business.logo_uploaded', 'business', businessId, ctx);
        await this.announce(tx, businessId, 'logo', ctx);
      }),
    );
    if (previous.logoStorageKey) await this.storage.delete(this.links.mediaBucket, previous.logoStorageKey);
    return { logoUrl: await this.links.publicUrl(key) };
  }

  async deleteLogo(businessId: bigint, actor: Actor, ctx: RequestContext): Promise<void> {
    const { plane } = this;
    const business = await plane.inBusiness(businessId, (tx) => authorize(tx, businessId, actor));
    if (!business.logoStorageKey) return;
    await this.storage.delete(this.links.mediaBucket, business.logoStorageKey);
    await plane.inBusiness(businessId, async (tx) => {
      await tx.business.update({ where: { id: businessId }, data: { logoStorageKey: null } });
      await this.audit(tx, actor.id, 'business.logo_deleted', 'business', businessId, ctx);
      await this.announce(tx, businessId, 'logo', ctx);
    });
  }

  logoUrl(storageKey: string | null): Promise<string | null> {
    return storageKey ? this.links.publicUrl(storageKey) : Promise.resolve(null);
  }

  // ── Employee photos ──────────────────────────────────────────────────────

  async requestStaffPhotoUpload(
    businessId: bigint,
    staffId: bigint,
    actor: Actor,
    input: { contentType: PhotoType; sizeBytes: number; consentConfirmed: true },
  ) {
    await this.plane.inBusiness(businessId, async (tx) => {
      await authorize(tx, businessId, actor);
      await findStaff(tx, businessId, staffId);
      assertFeature(await businessEntitlementsOnShard(tx, businessId), 'staff_photos');
    });
    return this.uploads.request('staff_photo', businessId.toString(), input, {
      staffId: staffId.toString(),
      consentConfirmedById: actor.id.toString(),
      consentConfirmedAt: new Date().toISOString(),
    });
  }

  async completeStaffPhotoUpload(
    businessId: bigint,
    staffId: bigint,
    uploadId: string,
    actor: Actor,
    ctx: RequestContext,
  ) {
    const { plane } = this;
    const { publicId } = await plane.inBusiness(businessId, (tx) => authorize(tx, businessId, actor));
    const { meta, image } = await this.uploads.complete<{
      staffId: string;
      consentConfirmedById: string;
      consentConfirmedAt: string;
    }>('staff_photo', businessId.toString(), uploadId, 'portrait');
    // The upload was requested for exactly this employee.
    if (meta.staffId !== staffId.toString()) throw AppError.notFound('Upload', ErrorCodes.UPLOAD_NOT_FOUND);

    const previous = await plane.inBusiness(businessId, async (tx) => {
      await findStaff(tx, businessId, staffId);
      return tx.staffPhoto.findUnique({ where: { staffId_businessId: { staffId, businessId } } });
    });
    const key = `businesses/${publicId}/staff/${staffId}/${plane.id()}.webp`;
    await this.publish(key, image, (storageKey) =>
      plane.inBusiness(businessId, async (tx) => {
        const data = {
          storageKey,
          sizeBytes: image.data.length,
          consentConfirmedById: BigInt(meta.consentConfirmedById),
          consentConfirmedAt: new Date(meta.consentConfirmedAt),
        };
        await tx.staffPhoto.upsert({
          where: { staffId_businessId: { staffId, businessId } },
          create: { id: plane.id(), businessId, staffId, ...data },
          update: data,
        });
        await this.audit(tx, actor.id, 'business.staff_photo_uploaded', 'staff', staffId, ctx, {
          consentConfirmed: true,
        });
      }),
    );
    if (previous) await this.storage.delete(this.links.mediaBucket, previous.storageKey);
    return { staffId: staffId.toString(), photoUrl: await this.links.publicUrl(key) };
  }

  /** Owner/manager, or the employee themself — their face, their choice. */
  async deleteStaffPhoto(businessId: bigint, staffId: bigint, actor: Actor, ctx: RequestContext) {
    const { plane } = this;
    const staff = await plane.inBusiness(businessId, async (tx) => {
      const role = await businessRoleOfActor(tx, businessId, actor);
      if (!role) throw AppError.notFound('Business', ErrorCodes.BUSINESS_NOT_FOUND);
      const staff = await findStaff(tx, businessId, staffId);
      if (!can(role, 'business.media') && staff.userId !== actor.id) throw AppError.forbidden();
      return staff;
    });
    if (await this.removeStaffPhoto(businessId, staffId)) {
      await plane.inBusiness(businessId, (tx) =>
        this.audit(tx, actor.id, 'business.staff_photo_deleted', 'staff', staffId, ctx, {
          bySelf: staff.userId === actor.id,
        }),
      );
    }
  }

  /** The employee left the team: their photo goes too. Idempotent. */
  async removePhotosOfMember(businessId: bigint, userId: bigint): Promise<number> {
    const staff = await this.plane.inBusiness(businessId, (tx) =>
      tx.staff.findMany({ where: { businessId, userId }, select: { id: true } }),
    );
    let removed = 0;
    for (const s of staff) if (await this.removeStaffPhoto(businessId, s.id)) removed++;
    return removed;
  }

  /** "Meet the team" on the public profile: active employees, with a photo if the business added one. */
  async team(businessId: bigint) {
    const staff = await this.plane.inBusiness(businessId, (tx) =>
      tx.staff.findMany({
        where: { businessId, isActive: true },
        orderBy: { displayName: 'asc' },
        select: { id: true, displayName: true, photo: { select: { storageKey: true } } },
      }),
    );
    return Promise.all(
      staff.map(async (s) => ({
        id: s.id.toString(),
        displayName: s.displayName,
        photoUrl: s.photo ? await this.links.publicUrl(s.photo.storageKey) : null,
      })),
    );
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async removeStaffPhoto(businessId: bigint, staffId: bigint): Promise<boolean> {
    const photo = await this.plane.inBusiness(businessId, (tx) =>
      tx.staffPhoto.findUnique({ where: { staffId_businessId: { staffId, businessId } } }),
    );
    if (!photo) return false;
    // File first: if the row delete then fails, a retry finds the row and tries again.
    await this.storage.delete(this.links.mediaBucket, photo.storageKey);
    await this.plane.inBusiness(businessId, (tx) => tx.staffPhoto.deleteMany({ where: { id: photo.id } }));
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

  /**
   * The gallery (and so the cover) or the logo changed: search shows them on every card, so the
   * change is announced like any other (DB-041, D3h).
   */
  private async announce(tx: BusinessTx, businessId: bigint, field: 'photos' | 'logo', ctx?: RequestContext) {
    const { status } = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { status: true },
    });
    await enqueueShardEvent(
      tx,
      this.plane.id(),
      createEvent({
        type: TOPICS.BUSINESSES_UPDATED,
        source: 'business-service',
        subject: businessId.toString(),
        data: {
          businessId: businessId.toString(),
          changedFields: [field],
          reverificationRequired: false,
          status,
        },
        ...(ctx?.requestId && { correlationId: ctx.requestId }),
      }),
      'business',
    );
  }

  private audit(
    tx: BusinessTx,
    userId: bigint,
    action: string,
    resourceType: string,
    resourceId: bigint,
    ctx: RequestContext,
    newValues?: Record<string, string | boolean>,
  ) {
    return recordShardAudit(tx, this.plane.id(), {
      userId,
      action,
      resourceType,
      resourceId,
      ...(newValues && { newValues }),
      ...auditCtx(ctx),
    });
  }
}

/** `business.media` in a business that is not suspended; the business's own fields for the caller. */
async function authorize(tx: BusinessTx, businessId: bigint, actor: Actor) {
  await requireBusinessPermissionOnShard(tx, businessId, actor, 'business.media');
  const b = await tx.business.findFirstOrThrow({
    where: { id: businessId },
    select: { status: true, publicId: true, logoStorageKey: true },
  });
  if (b.status === 'suspended') {
    throw new AppError('This business is suspended; contact support', ErrorCodes.BUSINESS_SUSPENDED, 403);
  }
  return b;
}

async function findStaff(tx: BusinessTx, businessId: bigint, staffId: bigint) {
  const staff = await tx.staff.findFirst({
    where: { id: staffId, businessId },
    select: { id: true, userId: true },
  });
  if (!staff) throw AppError.notFound('Staff member');
  return staff;
}

/** Early check before an upload starts (the locked check runs when the photo is saved). */
async function assertPhotoRoom(tx: BusinessTx, businessId: bigint) {
  const count = await tx.businessPhoto.count({ where: { businessId } });
  if (count >= PLATFORM_MAX_PHOTOS) {
    throw new AppError(
      `A business can have at most ${PLATFORM_MAX_PHOTOS} photos`,
      ErrorCodes.LIMIT_REACHED,
      409,
    );
  }
  assertWithinLimit(await businessEntitlementsOnShard(tx, businessId), 'photos', count);
}
