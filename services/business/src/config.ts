import { baseServiceEnv, databaseEnv, envBool, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * business-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  /** Version of the Business Terms an owner must accept to register a business. */
  BUSINESS_TERMS_VERSION: z.string().min(1).max(20).default('1.0'),
  /** Anti-abuse cap until business plans exist. */
  MAX_BUSINESSES_PER_OWNER: z.coerce.number().int().min(1).max(100).default(5),

  // Encryption of legal identifiers (same keyring as user PII).
  PII_ENCRYPTION_KEYS: z.string().min(1),
  PII_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  PII_BLIND_INDEX_KEY: z
    .base64()
    .refine((v) => Buffer.from(v, 'base64').length >= 32, 'must decode to >= 32 bytes'),

  // Object storage (RustFS locally, DigitalOcean Spaces in production).
  S3_ENDPOINT: z.url(),
  /** Endpoint BROWSERS use for presigned links (differs from the internal one in dev). */
  S3_PUBLIC_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: envBool.default(true),
  S3_BUCKET_DOCUMENTS: z.string().min(3),
  S3_BUCKET_MEDIA: z.string().min(3),
  /** CDN / public base URL for photos in production. Empty → presigned links. */
  MEDIA_PUBLIC_BASE_URL: z.url().optional(),
});

export type Env = z.infer<typeof Env>;
