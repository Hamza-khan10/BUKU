import 'server-only';
import { z } from 'zod';

/**
 * The admin app's settings (server-only: none reach the browser). Checked once,
 * on first use; a wrong value stops the server with a message naming it.
 */

const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), schema.optional());

const schema = z
  .object({
    /** This app's own origin, e.g. https://admin.buku.app (http://localhost:3200 in development). */
    APP_URL: z.url().transform((u) => new URL(u).origin),
    /** The API gateway. */
    API_URL: z.url().transform((u) => u.replace(/\/+$/, '')),
    /** Shared with the gateway only (D-091): the one way to reach admin routes. */
    ADMIN_GATEWAY_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'must be 64 lowercase hex characters'),
    /** The header the hosting platform puts the visitor's address in ("x-real-ip" on Vercel). */
    ADMIN_CLIENT_IP_HEADER: optional(z.string().regex(/^[a-z0-9-]{1,64}$/)),
    /**
     * Sign in with Google for admins: the admin app's OWN OAuth client (type "Web application",
     * redirect URI <APP_URL>/api/auth/google/callback) — never the website's, so neither app holds
     * the other's secret. Both or neither. The API's GOOGLE_CLIENT_IDS must include this id.
     */
    ADMIN_GOOGLE_CLIENT_ID: optional(
      z
        .string()
        .regex(
          /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/,
          'must look like 123-abc.apps.googleusercontent.com',
        ),
    ),
    ADMIN_GOOGLE_CLIENT_SECRET: optional(z.string().min(10).max(200)),
    DEV_SIGN_IN: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    VERCEL_ENV: optional(z.enum(['production', 'preview', 'development'])),
  })
  .superRefine((e, ctx) => {
    const live = e.VERCEL_ENV === 'production';
    if (live && e.DEV_SIGN_IN)
      ctx.addIssue({ code: 'custom', path: ['DEV_SIGN_IN'], message: 'must be false in production' });
    if (Boolean(e.ADMIN_GOOGLE_CLIENT_ID) !== Boolean(e.ADMIN_GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: ['ADMIN_GOOGLE_CLIENT_SECRET'],
        message: 'set both Google settings, or neither',
      });
    }
    if (live && !e.APP_URL.startsWith('https://'))
      ctx.addIssue({ code: 'custom', path: ['APP_URL'], message: 'must be https in production' });
  });

let cached: z.infer<typeof schema> | undefined;

export function env() {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new Error(`Admin app settings: ${problems}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Over HTTPS the cookies get their browser-enforced __Host-/__Secure- names. */
export const secureCookies = () => env().APP_URL.startsWith('https://');

/** Development sign-in: never on the live site, whatever the settings say. */
export const devSignInEnabled = () =>
  process.env.DEV_SIGN_IN === 'true' && process.env.VERCEL_ENV !== 'production';

/** Sign in with Google: offered only where this app has its own Google client (id and secret). */
export const googleSignInEnabled = () =>
  Boolean(process.env.ADMIN_GOOGLE_CLIENT_ID?.trim() && process.env.ADMIN_GOOGLE_CLIENT_SECRET?.trim());
