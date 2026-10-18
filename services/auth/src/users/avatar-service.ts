import { AppError, ErrorCodes, uuidv7 } from '@buku/common';
import { recordShardAudit, type DataPlane } from '@buku/database';
import {
  PRIVATE_PICTURE_CACHE,
  type MediaLinks,
  type ObjectStorage,
  type PhotoType,
  type PictureUploads,
} from '@buku/media';
import { auditCtx } from '../audit.js';
import type { RequestContext } from '../http/context.js';
import type { MeView, UserService } from './user-service.js';

/**
 * Customer profile pictures — PRIVATE (D-051): visible only to the person
 * themself. Stored cleaned (no GPS/camera data) in the private bucket and
 * handed out only through `/me` as a 1-hour signed link; no other endpoint
 * exposes them, and businesses don't see them. Deleted when the account is
 * purged; included in "my data" export.
 */
export class AvatarService {
  constructor(
    private readonly deps: {
      plane: DataPlane;
      storage: ObjectStorage;
      uploads: PictureUploads;
      links: MediaLinks;
      users: UserService;
    },
  ) {}

  requestUpload(userId: bigint, file: { contentType: PhotoType; sizeBytes: number }) {
    return this.deps.uploads.request('avatar', userId.toString(), file, {});
  }

  async completeUpload(userId: bigint, uploadId: string, ctx: RequestContext): Promise<MeView> {
    const { plane, storage, links } = this.deps;
    const { image } = await this.deps.uploads.complete('avatar', userId.toString(), uploadId, 'avatar');
    const db = await plane.user(userId);
    const previous = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { avatarStorageKey: true },
    });
    if (!previous) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);

    const key = `users/${userId}/avatar/${uuidv7()}.webp`;
    await storage.put(links.privateBucket, key, image.data, image.contentType, PRIVATE_PICTURE_CACHE);
    try {
      const user = await db.$transaction(async (tx) => {
        const user = await tx.user.update({ where: { id: userId }, data: { avatarStorageKey: key } });
        await recordShardAudit(tx, plane.id(), {
          userId,
          action: 'user.avatar_uploaded',
          resourceType: 'user',
          resourceId: userId,
          ...auditCtx(ctx),
        });
        return user;
      });
      if (previous.avatarStorageKey) await storage.delete(links.privateBucket, previous.avatarStorageKey);
      return await this.deps.users.toMe(user);
    } catch (err) {
      await storage.delete(links.privateBucket, key);
      throw err;
    }
  }

  /** Remove my picture — the uploaded one and the one from the sign-in provider. */
  async remove(userId: bigint, ctx: RequestContext): Promise<MeView> {
    const { plane, storage, links } = this.deps;
    const db = await plane.user(userId);
    const current = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { avatarStorageKey: true },
    });
    if (!current) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    if (current.avatarStorageKey) await storage.delete(links.privateBucket, current.avatarStorageKey);
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { avatarStorageKey: null, avatarUrl: null },
      });
      await recordShardAudit(tx, plane.id(), {
        userId,
        action: 'user.avatar_removed',
        resourceType: 'user',
        resourceId: userId,
        ...auditCtx(ctx),
      });
      return user;
    });
    return this.deps.users.toMe(user);
  }
}
