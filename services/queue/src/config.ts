import { baseServiceEnv, databaseEnv, databaseV2Env, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { type z } from 'zod';

/**
 * queue-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  // DATABASE_URL: queue-service's own role, and the default server of the directory (D3).
  ...databaseEnv.shape,
  ...databaseV2Env.shape,
  ...redisEnv.shape,
});

export type Env = z.infer<typeof Env>;
