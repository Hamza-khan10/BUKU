import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { s3Env } from '@buku/media';
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
  ...s3Env.shape,
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

  /** Verification documents (private, kept as uploaded). Other storage settings: s3Env. */
  S3_BUCKET_DOCUMENTS: z.string().min(3),
});

export type Env = z.infer<typeof Env>;
