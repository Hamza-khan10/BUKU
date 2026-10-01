import { AppError, ErrorCodes, uuidv7 } from '@buku/common';
import type { Redis } from 'ioredis';
import {
  matchesSignature,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  SIGNATURE_BYTES,
  type PhotoType,
} from './file-types.js';
import { cleanImage, ImageRejectedError, type CleanImage, type ImagePreset } from './images.js';
import type { ObjectStorage } from './object-storage.js';

/**
 * Picture uploads (business photos and logo, employee photos, profile pictures):
 *
 *   1. request   → a presigned PUT link valid 10 minutes for one key, type and
 *                  exact size, in the PRIVATE bucket under `incoming/`. The
 *                  pending upload is remembered in Valkey for 30 minutes,
 *                  tied to its purpose and owner (a business or a user), so an
 *                  upload id can't be completed for anything else.
 *   2. upload    → the client sends the file straight to storage.
 *   3. complete  → exact size and real file signature are checked, then the
 *                  picture is CLEANED (metadata stripped, re-encoded, resized;
 *                  see images.ts). The caller stores the clean copy where it
 *                  belongs. The original is deleted in every case.
 *
 * Originals never sit anywhere public: a photo's GPS position can't leak even
 * for a moment. Abandoned originals are removed by the bucket's expiry rule
 * on `incoming/` (infrastructure/s3/init.sh), so no clean-up job is needed.
 */

export type PicturePurpose = 'business_photo' | 'business_logo' | 'staff_photo' | 'avatar';

export interface PictureUploadSettings {
  /** Private bucket for originals (and other private pictures). */
  privateBucket: string;
  uploadLinkSeconds?: number;
  pendingSeconds?: number;
}

export interface UploadInstructions {
  method: 'PUT';
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

interface Pending<M> {
  incomingKey: string;
  contentType: PhotoType;
  sizeBytes: number;
  meta: M;
}

export class PictureUploads {
  private readonly linkSeconds: number;
  private readonly pendingSeconds: number;

  constructor(
    private readonly storage: ObjectStorage,
    private readonly redis: Redis,
    private readonly settings: PictureUploadSettings,
  ) {
    this.linkSeconds = settings.uploadLinkSeconds ?? 10 * 60;
    this.pendingSeconds = settings.pendingSeconds ?? 30 * 60;
  }

  /**
   * Start an upload. `owner` scopes it (business id or user id); `meta` is
   * whatever the caller needs back on completion (e.g. a staff id).
   */
  async request<M>(
    purpose: PicturePurpose,
    owner: string,
    file: { contentType: PhotoType; sizeBytes: number },
    meta: M,
  ): Promise<{ uploadId: string; upload: UploadInstructions }> {
    if (!(PHOTO_TYPES as readonly string[]).includes(file.contentType)) {
      throw new AppError('Pictures must be JPEG, PNG or WebP', ErrorCodes.FILE_TYPE_NOT_ALLOWED, 400);
    }
    if (file.sizeBytes > MAX_PHOTO_BYTES) {
      throw new AppError(
        `Pictures can be at most ${MAX_PHOTO_BYTES / 1024 / 1024} MB`,
        ErrorCodes.FILE_TOO_LARGE,
        413,
      );
    }
    const uploadId = uuidv7();
    const incomingKey = `incoming/${purpose}/${uploadId}`;
    const pending: Pending<M> = {
      incomingKey,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      meta,
    };
    await this.redis.set(
      pendingKey(purpose, owner, uploadId),
      JSON.stringify(pending),
      'EX',
      this.pendingSeconds,
    );
    const url = await this.storage.presignPut(
      this.settings.privateBucket,
      incomingKey,
      file.contentType,
      file.sizeBytes,
      this.linkSeconds,
    );
    return {
      uploadId,
      upload: {
        method: 'PUT',
        url,
        // The client must send exactly these headers (they are part of the signature).
        headers: { 'Content-Type': file.contentType, 'Content-Length': String(file.sizeBytes) },
        expiresAt: new Date(Date.now() + this.linkSeconds * 1000).toISOString(),
      },
    };
  }

  /**
   * Check and clean an uploaded picture. Single use: a second completion of
   * the same upload is refused. Throws (and deletes the original) when the
   * file isn't what was declared or isn't a readable image.
   */
  async complete<M>(
    purpose: PicturePurpose,
    owner: string,
    uploadId: string,
    preset: ImagePreset,
  ): Promise<{ meta: M; image: CleanImage }> {
    const key = pendingKey(purpose, owner, uploadId);
    const raw = await this.redis.get(key);
    if (!raw) throw AppError.notFound('Upload', ErrorCodes.UPLOAD_NOT_FOUND);
    const pending = JSON.parse(raw) as Pending<M>;
    const bucket = this.settings.privateBucket;

    const head = await this.storage.head(bucket, pending.incomingKey);
    // Not there yet: keep the pending upload so the client can finish and retry.
    if (!head) throw new AppError('The file has not been uploaded yet', ErrorCodes.UPLOAD_NOT_FOUND, 409);
    // Only one completion wins (two parallel calls must not create two pictures).
    if ((await this.redis.del(key)) !== 1) {
      throw AppError.conflict('This upload has already been completed', ErrorCodes.UPLOAD_NOT_FOUND);
    }

    try {
      if (head.sizeBytes !== pending.sizeBytes) {
        throw reject('The uploaded file does not match the declared size');
      }
      const prefix = await this.storage.readPrefix(bucket, pending.incomingKey, SIGNATURE_BYTES);
      if (!matchesSignature(pending.contentType, prefix)) {
        throw reject(`The file is not a valid ${pending.contentType}`);
      }
      const original = await this.storage.read(bucket, pending.incomingKey);
      const image = await cleanImage(original, preset);
      return { meta: pending.meta, image };
    } catch (err) {
      if (err instanceof ImageRejectedError) throw reject(err.message);
      throw err;
    } finally {
      await this.storage.delete(bucket, pending.incomingKey);
    }
  }
}

const pendingKey = (purpose: PicturePurpose, owner: string, uploadId: string) =>
  `media:upload:${purpose}:${owner}:${uploadId}`;

const reject = (message: string) => new AppError(message, ErrorCodes.FILE_TYPE_NOT_ALLOWED, 400);
