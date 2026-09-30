import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv } from '@buku/common';
import { z } from 'zod';

/**
 * search-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 *
 * SEARCH_ENGINE selects the backend:
 *   postgres       (MVP default) full-text search + PostGIS, no extra infrastructure
 *   elasticsearch  richer relevance/autocomplete; requires ELASTICSEARCH_URL
 */
export const Env = baseServiceEnv
  .extend({
    ...jwtVerifyEnv.shape,
    ...kafkaEnv.shape,
    ...databaseEnv.shape,
    SEARCH_ENGINE: z.enum(['postgres', 'elasticsearch']).default('postgres'),
    ELASTICSEARCH_URL: z.url().optional(),
    ELASTICSEARCH_INDEX_BUSINESSES: z.string().min(1).default('businesses'),
  })
  .refine((env) => env.SEARCH_ENGINE !== 'elasticsearch' || env.ELASTICSEARCH_URL, {
    message: 'ELASTICSEARCH_URL is required when SEARCH_ENGINE=elasticsearch',
    path: ['ELASTICSEARCH_URL'],
  });

export type Env = z.infer<typeof Env>;
