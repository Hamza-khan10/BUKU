import { baseServiceEnv, databaseEnv, jwtVerifyEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * billing-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration. Prices, plans and limits
 * are NOT configuration — they are data, changed through the admin API (D-065).
 */
export const Env = baseServiceEnv
  .extend({
    ...jwtVerifyEnv.shape,
    ...databaseEnv.shape,
    ...redisEnv.shape,

    // Paddle (web payments). Leave the keys empty to run without online checkout.
    PADDLE_ENVIRONMENT: z.enum(['sandbox', 'production']).default('sandbox'),
    /** Server-side API key (secret). */
    PADDLE_API_KEY: z.string().optional(),
    /** Client-side token for Paddle.js (public by design). */
    PADDLE_CLIENT_TOKEN: z.string().optional(),
    /** The notification destination's secret, to verify webhook signatures. */
    PADDLE_WEBHOOK_SECRET: z.string().optional(),
    /** Override the API base URL (tests); default follows PADDLE_ENVIRONMENT. */
    PADDLE_API_URL: z.url().optional(),
    PADDLE_WEBHOOK_TOLERANCE_SECONDS: z.coerce.number().int().min(5).max(3600).default(300),
    /** Paddle product tax category for BUKU's plans. */
    PADDLE_TAX_CATEGORY: z.string().min(1).default('standard'),
  })
  .refine(
    (env) =>
      [env.PADDLE_API_KEY, env.PADDLE_CLIENT_TOKEN, env.PADDLE_WEBHOOK_SECRET].filter(Boolean).length % 3 ===
      0,
    {
      message: 'set PADDLE_API_KEY, PADDLE_CLIENT_TOKEN and PADDLE_WEBHOOK_SECRET together (or none)',
      path: ['PADDLE_API_KEY'],
    },
  );

export type Env = z.infer<typeof Env>;
