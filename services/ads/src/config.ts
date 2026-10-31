import { baseServiceEnv, databaseEnv, databaseV2Env, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * ads-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  // DATABASE_URL: ads-service's own role, and the default server of the directory and catalog (D3).
  ...databaseEnv.shape,
  ...databaseV2Env.shape,
  ...redisEnv.shape,
  AD_ATTRIBUTION_WINDOW_DAYS: z.coerce.number().int().min(1).max(30).default(7),
});

export type Env = z.infer<typeof Env>;
