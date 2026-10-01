import { AppError, ErrorCodes, uuidv7 } from '@buku/common';
import { recordAudit, type Database } from '@buku/database';
import {
  PRIVATE_PICTURE_CACHE,
  type MediaLinks,
  type ObjectStorage,
  type PhotoType,
  type PictureUploads,
} from '@buku/media';
import type { RequestContext } from '../http/context.js';
import { auditCtx } from '../sessions/session-service.js';
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
      db: Database;
      storage: ObjectStorage;
      uploads: PictureUploads;
      links: MediaLinks;
      users: UserService;
    },
  ) {}

  requestUpload(userId: string, file: { contentType: PhotoType; sizeBytes: number }) {
    return this.deps.uploads.request('avatar', userId, file, {});
  }

  async completeUpload(userId: string, uploadId: string, ctx: RequestContext): Promise<MeView> {
    const { db, storage, links } = this.deps;
    const { image } = await this.deps.uploads.complete('avatar', userId, uploadId, 'avatar');
    const previous = await db.user.findUnique({ where: { id: userId }, select: { avatarStorageKey: true } });
    if (!previous) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);

    const key = `users/${userId}/avatar/${uuidv7()}.webp`;
    await storage.put(links.privateBucket, key, image.data, image.contentType, PRIVATE_PICTURE_CACHE);
    try {
      const user = await db.$transaction(async (tx) => {
        const user = await tx.user.update({ where: { id: userId }, data: { avatarStorageKey: key } });
        await recordAudit(tx, {
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
  async remove(userId: string, ctx: RequestContext): Promise<MeView> {
    const { db, storage, links } = this.deps;
    const current = await db.user.findUnique({ where: { id: userId }, select: { avatarStorageKey: true } });
    if (!current) throw AppError.notFound('User', ErrorCodes.USER_NOT_FOUND);
    if (current.avatarStorageKey) await storage.delete(links.privateBucket, current.avatarStorageKey);
    const user = await db.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { avatarStorageKey: null, avatarUrl: null },
      });
      await recordAudit(tx, {
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
