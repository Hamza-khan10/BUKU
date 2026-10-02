import { baseServiceEnv, databaseEnv, jwtVerifyEnv, redisEnv } from '@buku/common';
import type { z } from 'zod';

/**
 * billing-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration. Prices, plans and limits
 * are NOT configuration — they are data, changed through the admin API (D-065).
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
});

export type Env = z.infer<typeof Env>;
