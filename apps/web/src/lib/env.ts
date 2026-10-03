import 'server-only';
import { z } from 'zod';

/**
 * The web server's settings (server-only: none of these reach the browser).
 * Checked once, on first use; a wrong value stops the server with a message
 * that names it, instead of failing in some page later.
 */

// Blank (KEY=) means "not set".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const schema = z
  .object({
    /** This site's own origin, e.g. https://buku.app (http://localhost:3000 in development). */
    APP_URL: z.url().transform((u) => new URL(u).origin),
    /** The API gateway, e.g. https://api.buku.app (http://localhost:8000 in development). */
    API_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
    /** Shared with the gateway: lets this server pass on its visitors' addresses (D-084). */
    WEB_GATEWAY_KEY: optional(z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters')),
    /** The header the hosting platform puts the visitor's address in ("x-real-ip" on Vercel). */
    WEB_CLIENT_IP_HEADER: optional(z.string().regex(/^[a-z0-9-]{1,64}$/)),
    /** Where pictures are served from (allowed by the Content-Security-Policy). */
    MEDIA_ORIGIN: optional(z.url().transform((u) => new URL(u).origin)),
    /** Development sign-in (any email, no Google). Refused in production. */
    DEV_SIGN_IN: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    // ── Who runs BUKU (legal pages, contact page). Until set, those pages say the
    //    details are published before launch — never made-up placeholders.
    LEGAL_NAME: optional(z.string().min(2).max(200)),
    LEGAL_ADDRESS: optional(z.string().min(5).max(500)),
    /** The law that governs the terms, e.g. "Pakistan". */
    LEGAL_JURISDICTION: optional(z.string().min(2).max(100)),
    SUPPORT_EMAIL: optional(z.email()),
    PRIVACY_EMAIL: optional(z.email()),
    SECURITY_EMAIL: optional(z.email()),
    /** "true" once a lawyer has reviewed the legal pages; until then they are marked as drafts. */
    LEGAL_REVIEWED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    VERCEL_ENV: optional(z.enum(['production', 'preview', 'development'])),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .superRefine((env, ctx) => {
    const live = env.VERCEL_ENV === 'production';
    if (live && env.DEV_SIGN_IN) {
      ctx.addIssue({ code: 'custom', path: ['DEV_SIGN_IN'], message: 'must be false in production' });
    }
    if (live && !env.APP_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https in production' });
    }
    if (live && !env.WEB_GATEWAY_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_GATEWAY_KEY'],
        message: 'is required in production (D-084)',
      });
    }
  });

export type WebEnv = z.infer<typeof schema>;

let cached: WebEnv | undefined;

export function env(): WebEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`The web server's settings are not valid:\n${problems}\nSee apps/web/.env.example.`);
  }
  cached = parsed.data;
  return cached;
}

/** Cookies get the Secure flag and the __Host-/__Secure- prefixes over HTTPS. */
export const secureCookies = () => env().APP_URL.startsWith('https://');
