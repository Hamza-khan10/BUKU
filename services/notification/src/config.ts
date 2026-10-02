import { baseServiceEnv, databaseEnv, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/**
 * notification-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv.extend({
  ...jwtVerifyEnv.shape,
  ...kafkaEnv.shape,
  ...databaseEnv.shape,
  ...redisEnv.shape,
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  EMAIL_FROM: z.string().min(3).default('BUKU <noreply@buku.app>'),
  PII_ENCRYPTION_KEYS: z.string().min(1),
  PII_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),

  /** Push notifications: `log` (development: written to the log) or `expo` (the Expo app). */
  PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
  /** Optional; required once "push security" is enabled in the Expo project (recommended in production). */
  EXPO_ACCESS_TOKEN: z.string().optional(),
});

export type Env = z.infer<typeof Env>;
