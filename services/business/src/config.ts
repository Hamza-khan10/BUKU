import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
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
});

export type Env = z.infer<typeof Env>;
