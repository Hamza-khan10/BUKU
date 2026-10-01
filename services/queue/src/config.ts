import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { type z } from 'zod';

/**
 * queue-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
});

export type Env = z.infer<typeof Env>;
