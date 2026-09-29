import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * queue-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  WS_PORT: z.coerce.number().int().min(1).max(65535).default(3013),
  QUEUE_GRACE_PERIOD_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
});

export type Env = z.infer<typeof Env>;
