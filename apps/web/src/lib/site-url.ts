/**
 * The site's own address, for links search engines and emails use: APP_URL where it's set; on
 * Vercel without it, the project's production address (Vercel provides it); locally, localhost.
 */
export function siteUrl(): string {
  const app = process.env.APP_URL?.trim();
  if (app) return app.replace(/\/+$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;
  return 'http://localhost:3000';
}
