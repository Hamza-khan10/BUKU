import { baseServiceEnv, databaseEnv, envBool, jwtVerifyEnv, kafkaEnv, redisEnv } from '@buku/common';
import { z } from 'zod';

/** Docker Compose passes an unset `${X:-}` as "": treat blank as not set. */
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === '' ? undefined : v), schema.optional());

/**
 * notification-service environment. Validated once at startup: the process refuses
 * to start with missing or malformed configuration.
 */
export const Env = baseServiceEnv
  .extend({
    ...jwtVerifyEnv.shape,
    ...kafkaEnv.shape,
    ...databaseEnv.shape,
    ...redisEnv.shape,
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: optional(z.string()),
    SMTP_PASSWORD: optional(z.string()),
    /** Production: true (SES upgrades to TLS); Mailpit in development has no TLS. */
    SMTP_REQUIRE_TLS: envBool.default(false),
    EMAIL_FROM: z.string().min(3).default('BUKU <noreply@buku.app>'),
    PII_ENCRYPTION_KEYS: z.string().min(1),
    PII_ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
    PII_BLIND_INDEX_KEY: z
      .base64()
      .refine((v) => Buffer.from(v, 'base64').length >= 32, 'must decode to >= 32 bytes'),

    /** Where links in emails point: the web app, and the API (unsubscribe links). */
    WEB_APP_URL: z.url().default('http://localhost:3000'),
    PUBLIC_API_URL: z.url().default('http://localhost:8000'),

    /** Free times for suggestions come from booking-service (internal network). */
    BOOKING_SERVICE_URL: z.url().default('http://booking-service:3002'),

    /** Push notifications: `log` (development: written to the log) or `expo` (the Expo app). */
    PUSH_PROVIDER: z.enum(['log', 'expo']).default('log'),
    /** Optional; required once "push security" is enabled in the Expo project (recommended in production). */
    EXPO_ACCESS_TOKEN: optional(z.string()),

    /**
     * WhatsApp: `log` (development) or `meta` (WhatsApp Cloud API). Whether anything is
     * actually sent is the admin switch in notification settings (off by default).
     */
    WHATSAPP_PROVIDER: z.enum(['log', 'meta']).default('log'),
    /** The business number people message (E.164), for "connect WhatsApp" links. */
    WHATSAPP_BUSINESS_NUMBER: optional(z.string().regex(/^\+[1-9]\d{6,14}$/, 'E.164, e.g. +923001234567')),
    WHATSAPP_PHONE_NUMBER_ID: optional(z.string()),
    WHATSAPP_ACCESS_TOKEN: optional(z.string()),
    /** Meta app secret: checks the X-Hub-Signature-256 of incoming webhooks. */
    WHATSAPP_APP_SECRET: optional(z.string().min(16)),
    /** Chosen by us, typed into Meta's webhook setup page. */
    WHATSAPP_VERIFY_TOKEN: optional(z.string().min(16)),
    WHATSAPP_GRAPH_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default('v23.0'),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().min(2).max(10).default('en'),
  })
  .refine((e) => e.NODE_ENV !== 'production' || e.SMTP_REQUIRE_TLS, {
    message: 'must be true in production (email must never travel unencrypted)',
    path: ['SMTP_REQUIRE_TLS'],
  })
  .refine(
    (e) =>
      e.WHATSAPP_PROVIDER !== 'meta' ||
      Boolean(
        e.WHATSAPP_BUSINESS_NUMBER &&
        e.WHATSAPP_PHONE_NUMBER_ID &&
        e.WHATSAPP_ACCESS_TOKEN &&
        e.WHATSAPP_APP_SECRET &&
        e.WHATSAPP_VERIFY_TOKEN,
      ),
    {
      message:
        'WHATSAPP_PROVIDER=meta needs WHATSAPP_BUSINESS_NUMBER, _PHONE_NUMBER_ID, _ACCESS_TOKEN, _APP_SECRET and _VERIFY_TOKEN',
      path: ['WHATSAPP_PROVIDER'],
    },
  );

export type Env = z.infer<typeof Env>;
