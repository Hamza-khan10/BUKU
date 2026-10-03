import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv } from '@buku/common';
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
    ...databaseEnv.shape,
    ...s3Env.shape,
    SEARCH_ENGINE: z.enum(['postgres', 'elasticsearch']).default('postgres'),
  })
  .refine((env) => env.SEARCH_ENGINE === 'postgres', {
    message: 'only `postgres` is available (the Elasticsearch engine is not built yet; see D-076)',
    path: ['SEARCH_ENGINE'],
  });

export type Env = z.infer<typeof Env>;
