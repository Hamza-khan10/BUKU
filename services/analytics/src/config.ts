import { baseServiceEnv, jwtVerifyEnv, kafkaEnv } from '@buku/common';
import { z } from 'zod';

/**
 * analytics-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  CLICKHOUSE_URL: z.url(),
  CLICKHOUSE_USER: z.string().min(1),
  CLICKHOUSE_PASSWORD: z.string().min(1),
  CLICKHOUSE_DATABASE: z.string().min(1).default('buku_analytics'),
});

export type Env = z.infer<typeof Env>;
