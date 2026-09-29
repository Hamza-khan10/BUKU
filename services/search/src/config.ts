import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv } from '@buku/common';
import { z } from 'zod';

/**
 * search-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ELASTICSEARCH_URL: z.url(),
  ELASTICSEARCH_INDEX_BUSINESSES: z.string().min(1).default('businesses'),
});

export type Env = z.infer<typeof Env>;
