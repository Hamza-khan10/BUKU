import { baseServiceEnv, databaseEnv, envBool, envPem, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

/**
 * auth-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv
  .extend({
    ...jwtVerifyEnv.shape,
    ...kafkaEnv.shape,
    ...databaseEnv.shape,
    ...redisEnv.shape,
    /** Signing key — auth-service is the ONLY service that receives it. */
    JWT_PRIVATE_KEY: envPem('PRIVATE KEY'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),

    /**
     * Sessions last "until the user logs out" (D-029): the refresh token slides
     * forward on every use and only expires after this much INACTIVITY.
     */
    SESSION_IDLE_TIMEOUT_DAYS: z.coerce.number().int().min(1).max(730).default(180),
    /** Platform admins get short sessions: their accounts are the most valuable to steal. */
    ADMIN_SESSION_IDLE_TIMEOUT_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    /**
     * Two refreshes with the same token within this window are treated as a
     * client race (e.g. two tabs), not as token theft.
     */
    REFRESH_REUSE_GRACE_SECONDS: z.coerce.number().int().min(0).max(120).default(15),

    /** Google OAuth client ids (web, iOS, Android), comma-separated. Empty → Google sign-in off. */
    GOOGLE_CLIENT_IDS: csv,
    /** Locked until the Apple Developer account exists (D-028). */
    APPLE_SIGN_IN_ENABLED: envBool.default(false),
    APPLE_CLIENT_IDS: csv,

    /** Days between "delete my account" and irreversible anonymization (restorable meanwhile). */
    ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    /** Sensitive actions (account deletion) require signing in within this many minutes. */
    REAUTH_WINDOW_MINUTES: z.coerce.number().int().min(1).max(60).default(10),

    /** Version of the Terms/Privacy Policy new users must accept. */
    TERMS_VERSION: z.string().min(1).max(20).default('1.0'),

    /**
     * Development-only sign-in without Google (for building the rest of the
     * platform). Refused in production by the check below.
     */
    AUTH_DEV_LOGIN_ENABLED: envBool.default(false),

    PII_ENCRYPTION_KEYS: z.string().min(1),
    PII_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    PII_BLIND_INDEX_KEY: z
      .base64()
      .refine((v) => Buffer.from(v, 'base64').length >= 32, 'must decode to >= 32 bytes'),
  })
  .refine((env) => !(env.NODE_ENV === 'production' && env.AUTH_DEV_LOGIN_ENABLED), {
    message: 'must never be enabled in production',
    path: ['AUTH_DEV_LOGIN_ENABLED'],
  })
  .refine((env) => !env.APPLE_SIGN_IN_ENABLED || env.APPLE_CLIENT_IDS.length > 0, {
    message: 'APPLE_CLIENT_IDS is required when APPLE_SIGN_IN_ENABLED=true',
    path: ['APPLE_CLIENT_IDS'],
  });

export type Env = z.infer<typeof Env>;
