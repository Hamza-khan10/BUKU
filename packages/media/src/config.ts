import { envBool } from '@buku/common';
import { z } from 'zod';
import { MediaLinks } from './media-links.js';
import { createS3Storage, type ObjectStorage } from './object-storage.js';

/** Object-storage settings shared by every service that stores files. */
export const s3Env = z.object({
  // RustFS locally, DigitalOcean Spaces in production.
  S3_ENDPOINT: z.url(),
  /** Endpoint BROWSERS use for presigned links (differs from the internal one in dev). */
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: envBool.default(true),
  /** Public pictures (cleaned copies only). */
  S3_BUCKET_MEDIA: z.string().min(3),
  /** Private: original uploads (`incoming/`, expire after a day) and private pictures. Never behind a CDN. */
  S3_BUCKET_PRIVATE: z.string().min(3),
  /** CDN / public base URL for the media bucket in production. Empty → presigned links. */
  MEDIA_PUBLIC_BASE_URL: z.url().optional(),
});

export type S3Env = z.infer<typeof s3Env>;

export function storageFromEnv(env: S3Env): { storage: ObjectStorage; links: MediaLinks } {
  const storage = createS3Storage({
    endpoint: env.S3_ENDPOINT,
    publicEndpoint: env.S3_PUBLIC_ENDPOINT,
    region: env.S3_REGION,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
  const links = new MediaLinks(storage, {
    mediaBucket: env.S3_BUCKET_MEDIA,
    privateBucket: env.S3_BUCKET_PRIVATE,
    publicBaseUrl: env.MEDIA_PUBLIC_BASE_URL,
  });
  return { storage, links };
}
