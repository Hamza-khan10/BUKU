import { baseServiceEnv, databaseEnv, envPem, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * auth-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  /** Signing key — auth-service is the ONLY service that receives it. */
  JWT_PRIVATE_KEY: envPem('PRIVATE KEY'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  PII_ENCRYPTION_KEYS: z.string().min(1),
  PII_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  PII_BLIND_INDEX_KEY: z
    .base64()
    .refine((v) => Buffer.from(v, 'base64').length >= 32, 'must decode to >= 32 bytes'),
});

export type Env = z.infer<typeof Env>;
