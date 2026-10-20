import { baseServiceEnv, databaseEnv, databaseV2Env, jwtVerifyEnv, kafkaEnv } from '@buku/common';
import { s3Env } from '@buku/media';
import { z } from 'zod';

/**
 * search-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 *
 * SEARCH_ENGINE: `postgres` (full text + PostGIS, always current; D-076).
 * `elasticsearch` is reserved for when volume needs it and is refused until built.
 */
export const Env = baseServiceEnv
  .extend({
    ...jwtVerifyEnv.shape,
    ...kafkaEnv.shape,
    // DATABASE_URL: search-service's own role, and the default server of the directory and the
    // catalog (D3).
    ...databaseEnv.shape,
    ...databaseV2Env.shape,
    ...s3Env.shape,
    /** How often every catalog row is checked against its shard (the repair; minutes). */
    CATALOG_SWEEP_MINUTES: z.coerce
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(60),
    SEARCH_ENGINE: z.enum(['postgres', 'elasticsearch']).default('postgres'),
  })
  .refine((env) => env.SEARCH_ENGINE === 'postgres', {
    message: 'only `postgres` is available (the Elasticsearch engine is not built yet; see D-076)',
    path: ['SEARCH_ENGINE'],
  });

export type Env = z.infer<typeof Env>;
