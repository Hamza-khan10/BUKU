/**
 * The site's own address, for links search engines and emails use: APP_URL where it's set; on
 * Vercel without it, the project's production address (Vercel provides it); locally, localhost.
 *
 * Every page's metadata is built on this, so a mistyped setting must not take the site down:
 * a bare host ("buku.example", as dashboards often take it) is read as https, and anything that
 * still isn't an http(s) address is set aside (and logged), as if it weren't set.
 */
export function siteUrl(): string {
  const app = origin(process.env.APP_URL);
  if (app) return app;
  const vercel = origin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercel) return vercel;
  return 'http://localhost:3000';
}

let reported = false;

function origin(value: string | undefined): string | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) return url.origin;
  } catch {
    // reported below
  }
  if (!reported) {
    reported = true;
    // eslint-disable-next-line no-console -- the host's log: a setting to fix (its value isn't a secret, but isn't echoed).
    console.error('site address: APP_URL (or Vercel’s address) is not a web address; using the fallback.');
  }
  return undefined;
}
