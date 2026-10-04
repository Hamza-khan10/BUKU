import 'server-only';

/**
 * Which ways of signing in this site offers. Read on their own (not through
 * env()), so the sign-in page works on a site without the API settings.
 */

/**
 * Development sign-in: any email, no password — for building and testing.
 * Never on the live site: refused when VERCEL_ENV is production (and the API
 * refuses it in production too).
 */
export function devSignInEnabled(): boolean {
  return process.env.DEV_SIGN_IN === 'true' && process.env.VERCEL_ENV !== 'production';
}
