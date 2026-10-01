import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { s3Env } from '@buku/media';
import { type z } from 'zod';

/**
 * booking-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  /** Only to link staff photos (stored by business-service); booking-service stores no files. */
  ...s3Env.shape,
});

export type Env = z.infer<typeof Env>;
